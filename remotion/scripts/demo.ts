/**
 * The one-command demo: record → draft → cut → render (→ ship).
 *
 * Usage (from remotion/):
 *   npm run demo -- ../demos/<name>.demo.ts [options]
 *
 *   --job <name>      job folder name (default: derived from the demo file)
 *   --url <url>       override the demo file's url
 *   --viewport WxH    default 1280x720
 *   --headless        record without showing the browser
 *   --code            add a card showing the diff for the branch
 *   --music           add a bed from public/assets/music/
 *   --aspect 9:16     crop for vertical
 *   --no-captions --no-zooms --no-clicks --no-title
 *   --ship            post to the PR when the render finishes
 *   --no-render       stop after the rough cut
 *
 * Re-run the same command after a UI change and the demo re-records itself.
 * That is the point of keeping demos as code rather than as video files.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REMOTION_DIR = path.resolve(__dirname, "..");

const RECORD_FLAGS = ["--url", "--viewport", "--headless"];
const DRAFT_FLAGS = [
  "--no-captions",
  "--no-zooms",
  "--no-clicks",
  "--no-title",
  "--code",
  "--music",
  "--aspect",
];

/** Pass through only the flags a given stage understands, with their values. */
const flagsFor = (args: string[], accepted: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!accepted.includes(arg)) continue;
    out.push(arg);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) out.push(next);
  }
  return out;
};

const step = (label: string, script: string, scriptArgs: string[]) => {
  console.log(`\n──── ${label} ────`);
  const res = spawnSync(
    process.execPath,
    [
      path.join(REMOTION_DIR, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(REMOTION_DIR, "scripts", script),
      ...scriptArgs,
    ],
    { cwd: REMOTION_DIR, stdio: "inherit" },
  );
  if (res.status !== 0) {
    console.error(`\n✗ ${label} failed.`);
    process.exit(res.status ?? 1);
  }
};

const main = () => {
  const args = process.argv.slice(2);
  const valuePositions = ["--job", "--url", "--viewport", "--aspect"]
    .map((f) => args.indexOf(f) + 1)
    .filter((i) => i > 0);
  const demoFile = args.find(
    (a, i) => !a.startsWith("--") && !valuePositions.includes(i),
  );

  if (!demoFile) {
    console.error(
      "Usage: npm run demo -- <demo-file> [options]\n" +
        "  e.g. npm run demo -- ../demos/new-filter.demo.ts --code",
    );
    process.exit(1);
  }

  const jobIndex = args.indexOf("--job");
  const explicitJob = jobIndex >= 0 ? args[jobIndex + 1] : null;
  const job =
    explicitJob ??
    path
      .basename(demoFile)
      .replace(/\.demo\.tsx?$/, "")
      .replace(/\.tsx?$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  step("1/4  record", "record.ts", [
    demoFile,
    "--job",
    job,
    ...flagsFor(args, RECORD_FLAGS),
  ]);

  step("2/4  draft", "demodraft.ts", [job, ...flagsFor(args, DRAFT_FLAGS)]);

  step("3/4  cut", "roughcut.ts", [job]);

  if (args.includes("--no-render")) {
    console.log(
      `\n✓ Rough cut ready: public/jobs/${job}/roughcut.mp4 (render skipped)`,
    );
    return;
  }

  console.log(`\n──── 4/4  render ────`);
  const out = `out/${job}.mp4`;
  const render = spawnSync(
    process.execPath,
    [
      path.join(REMOTION_DIR, "node_modules", "@remotion", "cli", "remotion-cli.js"),
      "render",
      "Polish",
      `--props={"job":"${job}"}`,
      out,
    ],
    { cwd: REMOTION_DIR, stdio: "inherit" },
  );
  if (render.status !== 0) {
    console.error("\n✗ Render failed.");
    process.exit(render.status ?? 1);
  }

  const bytes = fs.existsSync(path.join(REMOTION_DIR, out))
    ? fs.statSync(path.join(REMOTION_DIR, out)).size
    : 0;
  console.log(
    `\n✓ Demo ready: remotion/${out} (${(bytes / (1024 * 1024)).toFixed(1)} MB)`,
  );

  if (args.includes("--ship")) {
    step("ship", "ship.ts", [job]);
    return;
  }

  console.log(
    `\n  Refine: edit public/jobs/${job}/edit-plan.json, then re-render\n` +
      `  Preview: npx remotion studio (set the job prop to "${job}")\n` +
      `  Share:   npx tsx scripts/ship.ts ${job}`,
  );
};

if (require.main === module) {
  main();
}
