/**
 * The one-command automatic editor:
 *   analyze → autodraft → roughcut → render draft
 *
 * Usage (from remotion/):
 *   npx tsx scripts/auto-edit.ts <source> --preset tech-demo|shorts|vlog|cinematic
 *     [--name <job>] [--silence=cut|speedup|keep]
 *     [--no-captions] [--no-zooms] [--no-music] [--music] [--no-sfx]
 *     [--no-transitions] [--no-grade] [--no-transcript]
 *     [--model base.en|medium.en] [--no-render]
 *
 * After reviewing the draft, refine by editing
 * public/jobs/<job>/edit-plan.json and re-rendering. Re-run roughcut only if
 * segments changed; analysis never needs to be repeated.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { WhisperModel } from "@remotion/install-whisper-cpp";
import { recipeSchema } from "../src/EditPlan";
import { analyzeFootage, type Analysis } from "./analyze";
import { draftPlan, PRESETS, type FootagePreset } from "./autodraft";
import { runRoughcut } from "./roughcut";

const REMOTION_DIR = path.resolve(__dirname, "..");

const main = async () => {
  const args = process.argv.slice(2);
  const flagValue = (flag: string): string | null => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  const valueFlagPositions = ["--preset", "--name", "--model"]
    .map((f) => args.indexOf(f) + 1)
    .filter((i) => i > 0);
  const source = args.find(
    (a, i) => !a.startsWith("--") && !valueFlagPositions.includes(i),
  );

  if (!source) {
    console.error(
      "Usage: npx tsx scripts/auto-edit.ts <source> --preset <preset> [options]",
    );
    process.exit(1);
  }

  const sourceAbs = path.isAbsolute(source)
    ? source
    : path.resolve(process.cwd(), source);
  if (!fs.existsSync(sourceAbs)) {
    console.error(`Source not found: ${sourceAbs}`);
    process.exit(1);
  }

  const presetName = (flagValue("--preset") ?? "tech-demo") as FootagePreset;
  if (!PRESETS[presetName]) {
    console.error(
      `Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(", ")}`,
    );
    process.exit(1);
  }

  const defaultName = path
    .basename(sourceAbs)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const job = flagValue("--name") ?? `${defaultName}-${presetName}`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(job)) {
    console.error(
      `Invalid job name "${job}" — use lowercase letters, digits, and dashes.`,
    );
    process.exit(1);
  }
  const jobDir = path.resolve(REMOTION_DIR, "public", "jobs", job);
  fs.mkdirSync(jobDir, { recursive: true });

  console.log(
    `\n=== Auto-edit: ${path.basename(sourceAbs)} → job "${job}" (${presetName}) ===\n`,
  );

  // 1. Analyze (or reuse a previous run's analysis)
  const analysisPath = path.join(jobDir, "analysis.json");
  let analysis: Analysis;
  if (fs.existsSync(analysisPath) && !args.includes("--re-analyze")) {
    console.log("Reusing existing analysis.json (pass --re-analyze to redo)");
    analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  } else {
    analysis = await analyzeFootage(sourceAbs, jobDir, {
      transcript: !args.includes("--no-transcript"),
      model: (flagValue("--model") ?? "base.en") as WhisperModel,
    });
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
  }

  // 2. Draft the edit plan
  const silenceFlag = args.find((a) => a.startsWith("--silence="));
  const recipe = recipeSchema.parse({
    preset: presetName,
    ...PRESETS[presetName].recipe,
    ...(silenceFlag ? { silence: silenceFlag.split("=")[1] } : {}),
    ...(args.includes("--no-captions") ? { captions: false } : {}),
    ...(args.includes("--no-zooms") ? { zooms: false } : {}),
    ...(args.includes("--no-music") ? { music: false } : {}),
    ...(args.includes("--music") ? { music: true } : {}),
    ...(args.includes("--no-sfx") ? { sfx: false } : {}),
    ...(args.includes("--no-transitions") ? { transitions: false } : {}),
    ...(args.includes("--no-grade") ? { grade: false } : {}),
  });

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
    `\nDraft plan: ${plan.segments.length} segment(s), ${cutSeconds.toFixed(1)}s cut, ` +
      `${captions.length} caption tokens, ${plan.overlays.length} overlay(s), ` +
      `${plan.audio.sfx.length} sfx cue(s)${plan.audio.music ? ", music bed" : ""}`,
  );

  // 3. Rough cut
  console.log("");
  runRoughcut(job);

  // 4. Render
  if (args.includes("--no-render")) {
    console.log(
      `\n✓ Draft plan ready (render skipped): public/jobs/${job}/edit-plan.json`,
    );
    return;
  }
  const out = `out/${job}-draft.mp4`;
  const remotionCli = path.join(
    REMOTION_DIR,
    "node_modules",
    "@remotion",
    "cli",
    "remotion-cli.js",
  );
  console.log(`\nRendering draft → remotion/${out} ...`);
  const render = spawnSync(
    process.execPath,
    [remotionCli, "render", "Polish", `--props={"job":"${job}"}`, out],
    { cwd: REMOTION_DIR, stdio: "inherit" },
  );
  if (render.status !== 0) {
    console.error("Render failed");
    process.exit(render.status ?? 1);
  }

  console.log(`\n✓ Draft ready: remotion/${out}`);
  console.log(
    `  Refine: edit public/jobs/${job}/edit-plan.json, then re-render\n` +
      `  (re-run roughcut first only if segments changed).\n` +
      `  Preview live: npx remotion studio (set props job to "${job}")`,
  );
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
