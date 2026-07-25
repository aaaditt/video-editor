/**
 * Turn analysis.json + a recipe into a complete edit-plan.json (and a
 * remapped captions.json). Deterministic heuristics — same input, same draft.
 *
 * Usage: npx tsx scripts/autodraft.ts <job> --preset tech-demo
 *          [--silence=cut|speedup|keep] [--no-captions] [--no-zooms]
 *          [--no-music] [--no-sfx] [--no-transitions] [--no-grade]
 */
import fs from "node:fs";
import path from "node:path";
import type { Caption } from "@remotion/captions";
import {
  editPlanSchema,
  recipeSchema,
  type EditPlan,
  type Overlay,
  type Recipe,
  type Segment,
  type SfxCue,
  type Transition,
} from "../src/EditPlan";
import type { Analysis, Silence } from "./analyze";

const SPEECH_PADDING = 0.25; // keep this much of each silence edge
const MIN_GAP_TO_CUT = 1.2; // silences shorter than this stay in
const MIN_SEGMENT = 0.6; // drop kept slivers shorter than this
const SPEEDUP_FACTOR = 4;

type PresetDefaults = {
  recipe: Partial<Recipe>;
  captionStyle: "clean" | "bold-word" | "lower-third";
  transition: Transition["type"] | null;
  transitionSeconds: number;
  look: EditPlan["overlays"];
  aspect: "source" | "9:16" | "1:1";
};

/**
 * Presets that describe how to edit supplied footage. The "demo" preset is
 * deliberately absent: recorded demos carry a step log, so they are drafted by
 * demodraft.ts from ground truth rather than inferred from audio here.
 */
export type FootagePreset = Exclude<Recipe["preset"], "demo">;

export const PRESETS: Record<FootagePreset, PresetDefaults> = {
  "tech-demo": {
    recipe: { music: false, silence: "speedup" },
    captionStyle: "clean",
    transition: null,
    transitionSeconds: 0.4,
    look: [{ type: "progressBar", color: "#FFD230" }],
    aspect: "source",
  },
  shorts: {
    recipe: { silence: "cut" },
    captionStyle: "bold-word",
    transition: "zoom-punch",
    transitionSeconds: 0.35,
    look: [{ type: "progressBar", color: "#FF3B6B" }],
    aspect: "9:16",
  },
  vlog: {
    recipe: { silence: "cut" },
    captionStyle: "clean",
    transition: null,
    transitionSeconds: 0.4,
    look: [{ type: "colorGrade", look: "warm" }],
    aspect: "source",
  },
  cinematic: {
    recipe: { silence: "keep", zooms: false },
    captionStyle: "lower-third",
    transition: "fade",
    transitionSeconds: 0.75,
    look: [
      { type: "colorGrade", look: "warm" },
      { type: "letterbox", size: 0.1 },
      { type: "filmGrain", intensity: 0.18 },
      { type: "vignette", intensity: 0.45 },
    ],
    aspect: "source",
  },
};

/** Kept spans of the source (before speed), from the silence map. */
const buildKeepSpans = (
  silences: Silence[],
  duration: number,
): { start: number; end: number }[] => {
  const meaningful = silences.filter((s) => s.end - s.start >= MIN_GAP_TO_CUT);
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of meaningful) {
    const speechEnd = Math.min(s.start + SPEECH_PADDING, duration);
    if (speechEnd - cursor >= MIN_SEGMENT) {
      spans.push({ start: cursor, end: speechEnd });
    }
    cursor = Math.max(cursor, s.end - SPEECH_PADDING);
  }
  if (duration - cursor >= MIN_SEGMENT) {
    spans.push({ start: cursor, end: duration });
  }
  return spans.length > 0 ? spans : [{ start: 0, end: duration }];
};

export const draftPlan = (
  analysis: Analysis,
  recipe: Recipe,
  job: string,
): { plan: EditPlan; captions: Caption[] } => {
  const preset = PRESETS[recipe.preset as FootagePreset];
  if (!preset) {
    throw new Error(
      `autodraft cannot handle the "${recipe.preset}" preset. Recorded demos ` +
        `are drafted by demodraft.ts, which works from steps.json.`,
    );
  }
  const duration = analysis.probe.durationInSeconds;

  // --- Segments -----------------------------------------------------------
  let segments: Segment[];
  if (recipe.silence === "keep" || !analysis.probe.hasAudio) {
    segments = [{ start: 0, end: duration, speed: 1 }];
  } else if (recipe.silence === "cut") {
    segments = buildKeepSpans(analysis.silences, duration).map((s) => ({
      start: s.start,
      end: s.end,
      speed: 1,
    }));
  } else {
    // speedup: keep everything, but rush through the dead air. Gaps too
    // short to be worth speeding up are absorbed into the speech segment.
    const spans = buildKeepSpans(analysis.silences, duration);
    segments = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start - cursor >= MIN_GAP_TO_CUT) {
        segments.push({ start: cursor, end: span.start, speed: SPEEDUP_FACTOR });
        segments.push({ start: span.start, end: span.end, speed: 1 });
      } else {
        segments.push({ start: cursor, end: span.end, speed: 1 });
      }
      cursor = span.end;
    }
    if (duration - cursor >= MIN_GAP_TO_CUT) {
      segments.push({ start: cursor, end: duration, speed: SPEEDUP_FACTOR });
    } else if (duration - cursor > 0.05 && segments.length > 0) {
      segments[segments.length - 1].end = duration;
    }
    if (segments.length === 0) segments = [{ start: 0, end: duration, speed: 1 }];
  }

  // --- Source-time → rough-cut-time mapping --------------------------------
  const segmentStartsRough: number[] = [];
  let acc = 0;
  for (const seg of segments) {
    segmentStartsRough.push(acc);
    acc += (seg.end - seg.start) / (seg.speed ?? 1);
  }
  const roughcutLength = acc;

  const sourceToRough = (t: number): number | null => {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (t >= seg.start && t <= seg.end) {
        return segmentStartsRough[i] + (t - seg.start) / (seg.speed ?? 1);
      }
    }
    return null; // fell into a cut region
  };

  // --- Transitions ----------------------------------------------------------
  if (recipe.transitions && preset.transition && segments.length > 1) {
    for (let i = 0; i < segments.length - 1; i++) {
      const a = (segments[i].end - segments[i].start) / (segments[i].speed ?? 1);
      const b =
        (segments[i + 1].end - segments[i + 1].start) /
        (segments[i + 1].speed ?? 1);
      // A transition must be shorter than both neighboring segments
      const maxDur = Math.min(a, b) * 0.45;
      if (maxDur < 0.2) continue;
      segments[i].transitionAfter = {
        type: preset.transition,
        durationInSeconds: Math.min(preset.transitionSeconds, maxDur),
      };
    }
  }

  // --- Captions (remap source-time transcript to rough-cut time) -----------
  let captions: Caption[] = [];
  if (recipe.captions && analysis.transcript.length > 0) {
    for (const token of analysis.transcript) {
      const start = sourceToRough(token.startMs / 1000);
      const end = sourceToRough(token.endMs / 1000);
      if (start === null || end === null || end - start <= 0) continue;
      captions.push({
        ...token,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        timestampMs:
          token.timestampMs === null
            ? null
            : Math.round(((start + end) / 2) * 1000),
      });
    }
  }

  // --- Overlays -------------------------------------------------------------
  const overlays: Overlay[] = [...preset.look];

  // Zooms on loudness peaks (rough-cut-time), spaced apart
  if (recipe.zooms && analysis.envelope.length > 0) {
    const targetCount = Math.min(5, Math.max(1, Math.floor(roughcutLength / 45)));
    const MIN_SPACING = 8;
    const candidates = [...analysis.envelope]
      .filter((s) => Number.isFinite(s.m) && s.m > -70)
      .sort((a, b) => b.m - a.m);
    const chosen: number[] = [];
    for (const c of candidates) {
      if (chosen.length >= targetCount) break;
      const rough = sourceToRough(c.t);
      if (rough === null || rough < 1 || rough > roughcutLength - 3.5) continue;
      if (chosen.some((z) => Math.abs(z - rough) < MIN_SPACING)) continue;
      chosen.push(rough);
    }
    for (const at of chosen.sort((a, b) => a - b)) {
      overlays.push({
        type: "zoom",
        from: Math.max(0, at - 0.5),
        to: Math.min(roughcutLength, at + 2),
        region: { x: 0.2, y: 0.15, width: 0.6, height: 0.6 },
        easeInSeconds: 0.5,
      });
    }
  }

  // Shorts hook: first few transcript words as animated text at the top
  if (recipe.preset === "shorts" && captions.length > 0) {
    const hookWords = captions
      .slice(0, 6)
      .map((c) => c.text.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (hookWords.length > 3) {
      overlays.push({
        type: "animatedText",
        from: 0.2,
        to: Math.min(3, roughcutLength - 0.1),
        text: hookWords,
        animation: "word-pop",
        position: "top",
      });
    }
  }

  // Cinematic: slow Ken Burns drift across the longest segments
  if (recipe.preset === "cinematic") {
    const longSegments = segments
      .map((seg, i) => ({
        start: segmentStartsRough[i],
        length: (seg.end - seg.start) / (seg.speed ?? 1),
      }))
      .filter((s) => s.length >= 5)
      .slice(0, 3);
    longSegments.forEach((s, i) => {
      overlays.push({
        type: "kenBurns",
        from: s.start,
        to: s.start + s.length,
        direction: i % 2 === 0 ? "in" : "out",
        strength: 0.08,
      });
    });
  }

  // --- Audio ----------------------------------------------------------------
  const sfx: SfxCue[] = [];
  if (recipe.sfx) {
    let cursor2 = 0;
    segments.forEach((seg, i) => {
      cursor2 += (seg.end - seg.start) / (seg.speed ?? 1);
      if (i < segments.length - 1 && seg.transitionAfter) {
        sfx.push({ preset: "whoosh", at: cursor2, volume: 0.5 });
      }
    });
    for (const o of overlays) {
      if (o.type === "zoom") sfx.push({ preset: "pop", at: o.from, volume: 0.45 });
    }
  }

  let music: EditPlan["audio"]["music"];
  if (recipe.music) {
    const musicDir = path.join(__dirname, "..", "public", "assets", "music");
    const files = fs.existsSync(musicDir)
      ? fs
          .readdirSync(musicDir)
          .filter((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f))
          .sort()
      : [];
    if (files.length > 0) {
      music = { file: `assets/music/${files[0]}`, volume: 0.18, ducking: true };
    } else {
      console.warn(
        "⚠ Music requested but no files in public/assets/music/ — skipping music.",
      );
    }
  }

  const plan = editPlanSchema.parse({
    job,
    source: analysis.source,
    output: { fps: 30, aspect: preset.aspect, cropFocus: 0.5 },
    segments,
    captions:
      recipe.captions && captions.length > 0
        ? { style: preset.captionStyle, transcriptFile: "captions.json" }
        : undefined,
    overlays,
    audio: { music, sfx },
  });

  return { plan, captions };
};

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  const job = args.find((a) => !a.startsWith("--"));
  if (!job) {
    console.error("Usage: npx tsx scripts/autodraft.ts <job> --preset <preset> [toggles]");
    process.exit(1);
  }
  const presetFlag = args.indexOf("--preset");
  const presetName = presetFlag >= 0 ? args[presetFlag + 1] : "tech-demo";
  const silenceFlag = args.find((a) => a.startsWith("--silence="));

  const presetDefaults = PRESETS[presetName as FootagePreset]?.recipe ?? {};

  const recipe = recipeSchema.parse({
    preset: presetName,
    ...presetDefaults,
    ...(silenceFlag ? { silence: silenceFlag.split("=")[1] } : {}),
    ...(args.includes("--no-captions") ? { captions: false } : {}),
    ...(args.includes("--no-zooms") ? { zooms: false } : {}),
    ...(args.includes("--no-music") ? { music: false } : {}),
    ...(args.includes("--music") ? { music: true } : {}),
    ...(args.includes("--no-sfx") ? { sfx: false } : {}),
    ...(args.includes("--no-transitions") ? { transitions: false } : {}),
    ...(args.includes("--no-grade") ? { grade: false } : {}),
  });

  const jobDir = path.resolve(__dirname, "..", "public", "jobs", job);
  const analysisPath = path.join(jobDir, "analysis.json");
  if (!fs.existsSync(analysisPath)) {
    console.error(`No analysis at ${analysisPath} — run analyze.ts first`);
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8")) as Analysis;

  // grade:false strips look overlays after drafting
  const { plan, captions } = draftPlan(analysis, recipe, job);
  if (!recipe.grade) {
    plan.overlays = plan.overlays.filter(
      (o) =>
        !["colorGrade", "filmGrain", "vignette", "letterbox"].includes(o.type),
    );
  }

  fs.writeFileSync(
    path.join(jobDir, "edit-plan.json"),
    JSON.stringify(plan, null, 2),
  );
  fs.writeFileSync(
    path.join(jobDir, "recipe.json"),
    JSON.stringify(recipe, null, 2),
  );
  if (captions.length > 0) {
    fs.writeFileSync(
      path.join(jobDir, "captions.json"),
      JSON.stringify(captions, null, 2),
    );
  }

  const cutSeconds =
    analysis.probe.durationInSeconds -
    plan.segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
  console.log(
    `✓ Draft plan: ${plan.segments.length} segment(s), ` +
      `${cutSeconds.toFixed(1)}s cut, ${captions.length} caption tokens, ` +
      `${plan.overlays.length} overlay(s), ${plan.audio.sfx.length} sfx cue(s)` +
      `${plan.audio.music ? ", music bed" : ""}`,
  );
}
