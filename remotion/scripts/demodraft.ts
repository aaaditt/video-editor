/**
 * Turn steps.json (+ git context) into edit-plan.json and captions.json.
 *
 * The step-driven counterpart to autodraft.ts. autodraft infers structure from
 * audio silence, which is the only signal raw footage offers; here the driver
 * logged exactly what happened and when, so nothing has to be guessed.
 *
 * Usage (from remotion/):
 *   npx tsx scripts/demodraft.ts <job>
 *     [--no-captions] [--no-zooms] [--no-clicks] [--no-title]
 *     [--code] [--music] [--aspect 9:16|1:1]
 *
 * The one thing that genuinely differs from editing footage: without a voice
 * track, nothing dictates how long a chapter should last. So each step's
 * length comes from how long its caption takes to READ, and the footage is
 * speed-ramped to fit that budget. The video bends to the text.
 */
import fs from "node:fs";
import path from "node:path";
import type { Caption } from "@remotion/captions";
import {
  editPlanSchema,
  type EditPlan,
  type Overlay,
  type Segment,
} from "../src/EditPlan";
import { probeFile } from "./ffbin";
import { readDiffLines, readGitContext } from "./gitctx";
import type { StepsFile } from "./record";
import type { StepLog } from "./driver";

const REMOTION_DIR = path.resolve(__dirname, "..");

/** Reading budget per word. Roughly 175 wpm, a comfortable on-screen pace. */
const WORD_SECONDS = 0.34;
/** No chapter should flash by, however terse its caption. */
const MIN_STEP_SECONDS = 1.8;
/** Interaction sped past ~2x becomes hard to follow. */
const MAX_SPEED = 2;
/** Below this it reads as slow-motion rather than deliberate. */
const MIN_SPEED = 0.6;

/** Pulled in before step 1. Must stay inside the settle gap after the sync flash. */
const LEAD_SECONDS = 0.15;
/** Held after the last step, trimmed clear of the browser-shutdown tail. */
const TAIL_SECONDS = 0.9;
const SHUTDOWN_MARGIN = 0.35;

const CLICK_RING_SECONDS = 0.7;
/** Only zoom when the target is genuinely small, or it looks arbitrary. */
const ZOOM_MAX_AREA = 0.05;
const ZOOM_MIN_SEGMENT = 1.6;
const MAX_ZOOMS = 3;
const ZOOM_PADDING = 2.6;

const CODE_CARD_MAX_SECONDS = 3.2;
const CODE_CARD_MIN_SECONDS = 1.5;
const CODE_CARD_MAX_LINES = 14;

const INTRO_SECONDS = 2.4;

type Chapter = {
  step: StepLog;
  /** Source (video) seconds */
  srcStart: number;
  srcEnd: number;
  speed: number;
  /** Rough-cut seconds */
  roughStart: number;
  roughDuration: number;
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const wordsOf = (text: string): string[] =>
  text.trim().split(/\s+/).filter(Boolean);

/**
 * Lay the steps out on both timelines at once: where each chapter sits in the
 * source video, and where it lands in the rough cut after speed changes.
 */
export const buildChapters = (
  stepsFile: StepsFile,
  videoDuration: number,
): Chapter[] => {
  const { steps, offsetMs } = stepsFile;
  const toVideo = (ms: number) => (ms + offsetMs) / 1000;
  const lastIndex = steps.length - 1;
  const hardEnd = Math.max(0, videoDuration - SHUTDOWN_MARGIN);

  const chapters: Chapter[] = [];
  let roughCursor = 0;

  steps.forEach((step, i) => {
    const isFirst = i === 0;
    const isLast = i === lastIndex;

    let srcStart = toVideo(step.tStart);
    let srcEnd = toVideo(step.tEnd);

    if (isFirst) srcStart -= LEAD_SECONDS;
    if (isLast) srcEnd += TAIL_SECONDS;

    srcStart = clamp(srcStart, 0, hardEnd);
    srcEnd = clamp(srcEnd, srcStart + 0.1, hardEnd);

    const raw = srcEnd - srcStart;
    const desired = Math.max(
      MIN_STEP_SECONDS,
      wordsOf(step.caption).length * WORD_SECONDS,
    );
    const speed = clamp(raw / desired, MIN_SPEED, MAX_SPEED);
    const roughDuration = raw / speed;

    chapters.push({
      step,
      srcStart,
      srcEnd,
      speed,
      roughStart: roughCursor,
      roughDuration,
    });
    roughCursor += roughDuration;
  });

  return chapters;
};

/** Map a source-video timestamp to its rough-cut position within a chapter. */
const toRough = (chapter: Chapter, srcSeconds: number): number =>
  chapter.roughStart +
  clamp(srcSeconds - chapter.srcStart, 0, chapter.srcEnd - chapter.srcStart) /
    chapter.speed;

/**
 * Captions, straight from the step text — no transcription involved. Words are
 * spread evenly across the chapter, which is what gives the existing
 * word-highlighting caption component something to highlight.
 */
export const buildCaptions = (chapters: Chapter[]): Caption[] => {
  const captions: Caption[] = [];

  chapters.forEach((chapter) => {
    const words = wordsOf(chapter.step.caption);
    if (words.length === 0) return;

    // Leave a beat at each end so text doesn't butt against the cut.
    const pad = Math.min(0.18, chapter.roughDuration * 0.08);
    const start = chapter.roughStart + pad;
    const span = Math.max(0.3, chapter.roughDuration - pad * 2);
    const per = span / words.length;

    words.forEach((word, i) => {
      const fromMs = Math.round((start + i * per) * 1000);
      const toMs = Math.round((start + (i + 1) * per) * 1000);
      captions.push({
        // Leading space on all but the first token of a chapter, matching the
        // whisper convention the caption component was built against.
        text: i === 0 ? word : ` ${word}`,
        startMs: fromMs,
        endMs: toMs,
        timestampMs: fromMs,
        confidence: 1,
      });
    });
  });

  return captions;
};

const buildClickRings = (chapters: Chapter[], offsetMs: number): Overlay[] =>
  chapters.flatMap((chapter) =>
    chapter.step.clicks.map(
      (click): Overlay => ({
        type: "clickRing",
        // click.t is step time, like tStart/tEnd — same offset applies.
        at: toRough(chapter, (click.t + offsetMs) / 1000),
        x: click.x,
        y: click.y,
        durationInSeconds: CLICK_RING_SECONDS,
        color: "#FFD230",
      }),
    ),
  );

/**
 * Zoom into the element a step acted on — but only where it helps. A zoom on
 * something already large just wobbles the frame, so small targets in
 * long-enough chapters only, and never more than a few per demo.
 */
const buildZooms = (chapters: Chapter[]): Overlay[] => {
  const candidates = chapters
    .filter((c) => {
      const f = c.step.focus;
      if (!f) return false;
      if (c.roughDuration < ZOOM_MIN_SEGMENT) return false;
      return f.width * f.height <= ZOOM_MAX_AREA;
    })
    .sort((a, b) => {
      const fa = a.step.focus!;
      const fb = b.step.focus!;
      return fa.width * fa.height - (fb.width * fb.height);
    })
    .slice(0, MAX_ZOOMS)
    .sort((a, b) => a.roughStart - b.roughStart);

  return candidates.map((c): Overlay => {
    const f = c.step.focus!;
    const cx = f.x + f.width / 2;
    const cy = f.y + f.height / 2;
    const w = clamp(f.width * ZOOM_PADDING, 0.25, 1);
    const h = clamp(f.height * ZOOM_PADDING, 0.25, 1);
    return {
      type: "zoom",
      from: c.roughStart + 0.25,
      to: c.roughStart + c.roughDuration - 0.15,
      region: {
        x: clamp(cx - w / 2, 0, 1 - w),
        y: clamp(cy - h / 2, 0, 1 - h),
        width: w,
        height: h,
      },
      easeInSeconds: 0.5,
    };
  });
};

export const draftDemoPlan = (
  job: string,
  stepsFile: StepsFile,
  videoDuration: number,
  opts: {
    captions: boolean;
    zooms: boolean;
    clicks: boolean;
    title: boolean;
    code: boolean;
    music: string | null;
    aspect: "source" | "9:16" | "1:1";
  },
): { plan: EditPlan; captions: Caption[]; notes: string[] } => {
  const notes: string[] = [];
  const chapters = buildChapters(stepsFile, videoDuration);
  const git = readGitContext();

  const segments: Segment[] = chapters.map((c) => ({
    start: Number(c.srcStart.toFixed(3)),
    end: Number(c.srcEnd.toFixed(3)),
    speed: Number(c.speed.toFixed(4)),
  }));

  const overlays: Overlay[] = [{ type: "progressBar", color: "#FFD230" }];

  if (opts.title) {
    const title = git.pr?.title ?? git.subject ?? git.branch ?? job;
    const subtitleParts = [git.repo, git.branch].filter(Boolean) as string[];
    overlays.push({
      type: "titleCard",
      position: "intro",
      durationInSeconds: INTRO_SECONDS,
      title,
      ...(subtitleParts.length > 0
        ? { subtitle: subtitleParts.join(" · ") }
        : {}),
    });
  }

  if (opts.clicks) {
    overlays.push(...buildClickRings(chapters, stepsFile.offsetMs));
  }
  if (opts.zooms) overlays.push(...buildZooms(chapters));

  if (opts.code) {
    const total = chapters.reduce((s, c) => s + c.roughDuration, 0);
    const last = chapters[chapters.length - 1];
    const available = Math.min(CODE_CARD_MAX_SECONDS, last.roughDuration * 0.7);
    const file = git.files[0];

    if (!file) {
      notes.push("No changed files found, so no code card was added.");
    } else if (available < CODE_CARD_MIN_SECONDS) {
      notes.push(
        `Last chapter is too short (${last.roughDuration.toFixed(1)}s) to hold a ` +
          `code card. Raise outroHold in the demo file and re-record.`,
      );
    } else {
      const lines = readDiffLines(
        file.path,
        git.baseBranch,
        CODE_CARD_MAX_LINES,
      );
      if (lines.length === 0) {
        notes.push(`No diff hunks available for ${file.path}.`);
      } else {
        overlays.push({
          type: "codeCard",
          from: total - available,
          to: total,
          title: file.path,
          lines,
        });
      }
    }
  }

  const probe = probeFile(
    path.join(REMOTION_DIR, "public", "jobs", job, "raw.webm"),
  );

  const plan: EditPlan = editPlanSchema.parse({
    job,
    source: `remotion/public/jobs/${job}/raw.webm`,
    output: {
      fps: 30,
      aspect: opts.aspect,
      cropFocus: 0.5,
      width: probe.width,
      height: probe.height,
    },
    segments,
    ...(opts.captions
      ? { captions: { style: "clean", transcriptFile: "captions.json" } }
      : {}),
    overlays,
    audio: {
      ...(opts.music
        ? // Nothing is spoken, so there is nothing for ducking to duck under.
          { music: { file: opts.music, volume: 0.16, ducking: false } }
        : {}),
      sfx: [],
    },
  });

  return {
    plan,
    captions: opts.captions ? buildCaptions(chapters) : [],
    notes,
  };
};

const firstMusicFile = (): string | null => {
  const dir = path.join(REMOTION_DIR, "public", "assets", "music");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f))
    .sort();
  return files.length > 0 ? `assets/music/${files[0]}` : null;
};

const main = () => {
  const args = process.argv.slice(2);
  const job = args.find((a) => !a.startsWith("--"));
  if (!job) {
    console.error("Usage: npx tsx scripts/demodraft.ts <job> [options]");
    process.exit(1);
  }

  const jobDir = path.join(REMOTION_DIR, "public", "jobs", job);
  const stepsPath = path.join(jobDir, "steps.json");
  if (!fs.existsSync(stepsPath)) {
    console.error(
      `No steps.json in public/jobs/${job}/ — run scripts/record.ts first.`,
    );
    process.exit(1);
  }

  const stepsFile: StepsFile = JSON.parse(fs.readFileSync(stepsPath, "utf8"));
  if (stepsFile.offsetSource === "fallback") {
    console.warn(
      "! steps.json has no measured sync offset, so cuts may be up to ~0.5s\n" +
        "  out. Re-record to fix, or set offsetMs by hand.",
    );
  }

  const aspectFlag = args[args.indexOf("--aspect") + 1];
  const music = args.includes("--music") ? firstMusicFile() : null;
  if (args.includes("--music") && !music) {
    console.warn("! --music given but public/assets/music/ is empty.");
  }

  const { plan, captions, notes } = draftDemoPlan(
    job,
    stepsFile,
    stepsFile.videoDurationSeconds,
    {
      captions: !args.includes("--no-captions"),
      zooms: !args.includes("--no-zooms"),
      clicks: !args.includes("--no-clicks"),
      title: !args.includes("--no-title"),
      code: args.includes("--code"),
      music,
      aspect:
        aspectFlag === "9:16" || aspectFlag === "1:1" ? aspectFlag : "source",
    },
  );

  fs.writeFileSync(
    path.join(jobDir, "edit-plan.json"),
    JSON.stringify(plan, null, 2),
  );
  if (captions.length > 0) {
    fs.writeFileSync(
      path.join(jobDir, "captions.json"),
      JSON.stringify(captions, null, 2),
    );
  }

  const roughSeconds = plan.segments.reduce(
    (s, seg) => s + (seg.end - seg.start) / seg.speed,
    0,
  );
  const counts = plan.overlays.reduce<Record<string, number>>((acc, o) => {
    acc[o.type] = (acc[o.type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `\n✓ Draft plan for "${job}"\n` +
      `  ${plan.segments.length} chapter(s), ` +
      `${stepsFile.videoDurationSeconds.toFixed(1)}s raw → ${roughSeconds.toFixed(1)}s cut\n` +
      `  ${captions.length} caption token(s), overlays: ` +
      `${Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ")}`,
  );
  for (const note of notes) console.log(`  · ${note}`);
  console.log(
    `\n  Next: npx tsx scripts/roughcut.ts ${job}\n` +
      `        npx remotion render Polish --props='{"job":"${job}"}' out/${job}.mp4`,
  );
};

if (require.main === module) {
  main();
}
