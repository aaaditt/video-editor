/**
 * Deliver a finished demo to the pull request.
 *
 * Usage (from remotion/):
 *   npx tsx scripts/ship.ts <job> [--dry-run] [--no-release] [--file <mp4>]
 *
 * You cannot attach a video to a PR comment through the API — but an image URL
 * renders inline, and release assets are image URLs. So the comment carries a
 * GIF preview plus a link to the full-quality MP4, both hosted as assets of a
 * prerelease tagged demo-<job>.
 *
 *   --dry-run     print the comment body and stop; nothing is uploaded
 *   --no-release  build the GIF only, leave distribution alone
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { computeTimeline, editPlanSchema } from "../src/EditPlan";
import { ffmpegPath, probeFile } from "./ffbin";
import { readGitContext } from "./gitctx";
import type { StepsFile } from "./record";

const REMOTION_DIR = path.resolve(__dirname, "..");

/** GitHub refuses images over 10MB in a comment; stay clear of the edge. */
const GIF_BYTE_LIMIT = 9.5 * 1024 * 1024;

/**
 * Tried in order until one fits. Quality first — a demo that reads clearly at
 * 12fps is worth more than a smaller file nobody can follow.
 */
const GIF_LADDER = [
  { fps: 12, width: 720 },
  { fps: 10, width: 640 },
  { fps: 8, width: 560 },
  { fps: 6, width: 480 },
];

const formatTime = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * Two-pass palette GIF. A single pass quantises to a generic 256-colour
 * palette and turns UI gradients into mud; generating a palette from the
 * actual frames first is what keeps text legible.
 */
export const buildGif = (
  source: string,
  target: string,
): { bytes: number; fps: number; width: number } => {
  const palette = path.join(path.dirname(target), "_palette.png");

  for (const [i, rung] of GIF_LADDER.entries()) {
    const filters = `fps=${rung.fps},scale=${rung.width}:-1:flags=lanczos`;

    execFileSync(
      ffmpegPath,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", source,
        "-vf", `${filters},palettegen=stats_mode=diff`,
        palette,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    execFileSync(
      ffmpegPath,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", source,
        "-i", palette,
        "-lavfi",
        `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
        target,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );

    const bytes = fs.statSync(target).size;
    if (bytes <= GIF_BYTE_LIMIT || i === GIF_LADDER.length - 1) {
      fs.rmSync(palette, { force: true });
      if (bytes > GIF_BYTE_LIMIT) {
        console.warn(
          `! GIF is ${formatBytes(bytes)}, above GitHub's 10MB comment limit ` +
            `even at the lowest setting.\n  The comment will link it instead ` +
            `of showing it inline. Record a shorter demo for an inline preview.`,
        );
      }
      return { bytes, fps: rung.fps, width: rung.width };
    }
    console.log(
      `  GIF at ${rung.fps}fps/${rung.width}px was ${formatBytes(bytes)} — retrying smaller`,
    );
  }

  throw new Error("unreachable");
};

/** Chapter list, in final-video time, from the plan and the step log. */
export const buildChapterList = (job: string): string[] => {
  const jobDir = path.join(REMOTION_DIR, "public", "jobs", job);
  const planPath = path.join(jobDir, "edit-plan.json");
  const stepsPath = path.join(jobDir, "steps.json");
  if (!fs.existsSync(planPath) || !fs.existsSync(stepsPath)) return [];

  const plan = editPlanSchema.parse(
    JSON.parse(fs.readFileSync(planPath, "utf8")),
  );
  const steps: StepsFile = JSON.parse(fs.readFileSync(stepsPath, "utf8"));
  const timeline = computeTimeline(plan);
  const introSeconds = timeline.introFrames / timeline.fps;

  const lines: string[] = [];
  let rough = 0;
  plan.segments.forEach((seg, i) => {
    const caption = steps.steps[i]?.caption;
    if (caption) {
      lines.push(
        `- \`${formatTime(introSeconds + timeline.concatToFinal(rough))}\` ${caption}`,
      );
    }
    rough += (seg.end - seg.start) / seg.speed;
  });
  return lines;
};

const gh = (args: string[]): string | null => {
  const res = spawnSync("gh", args, { encoding: "utf8", windowsHide: true });
  if (res.status !== 0) {
    const err = (res.stderr ?? "").trim();
    if (err) console.error(`  gh ${args[0]} ${args[1] ?? ""}: ${err}`);
    return null;
  }
  return (res.stdout ?? "").trim();
};

const main = () => {
  const args = process.argv.slice(2);
  const job = args.find((a) => !a.startsWith("--"));
  if (!job) {
    console.error("Usage: npx tsx scripts/ship.ts <job> [--dry-run] [--no-release]");
    process.exit(1);
  }

  // indexOf returns -1 when the flag is absent, and args[-1 + 1] is args[0] —
  // which is the job name. Guard the index, not just the value.
  const fileIndex = args.indexOf("--file");
  const fileFlag = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  const mp4 =
    fileFlag && !fileFlag.startsWith("--")
      ? path.resolve(process.cwd(), fileFlag)
      : path.join(REMOTION_DIR, "out", `${job}.mp4`);

  if (!fs.existsSync(mp4)) {
    console.error(
      `No rendered video at ${mp4}\n` +
        `  Render it first: npx remotion render Polish --props='{"job":"${job}"}' out/${job}.mp4`,
    );
    process.exit(1);
  }

  const probe = probeFile(mp4);
  const gifPath = path.join(REMOTION_DIR, "out", `${job}.gif`);

  console.log(`\n=== demotape ship: ${job} ===\n`);
  console.log(`Building GIF preview from ${path.basename(mp4)} ...`);
  const gif = buildGif(mp4, gifPath);
  console.log(
    `  ${formatBytes(gif.bytes)} at ${gif.fps}fps/${gif.width}px → out/${job}.gif`,
  );

  const git = readGitContext();
  const chapters = buildChapterList(job);
  const tag = `demo-${job}`;
  const assetBase = git.repo
    ? `https://github.com/${git.repo}/releases/download/${tag}`
    : null;
  const gifUrl = assetBase ? `${assetBase}/${job}.gif` : null;
  const mp4Url = assetBase ? `${assetBase}/${path.basename(mp4)}` : null;

  const title = git.pr?.title ?? git.subject ?? git.branch ?? job;
  const body = [
    `### 🎬 ${title}`,
    "",
    gif.bytes <= GIF_BYTE_LIMIT && gifUrl
      ? `![${job}](${gifUrl})`
      : gifUrl
        ? `[Animated preview](${gifUrl}) (too large to inline)`
        : "_(preview not uploaded)_",
    "",
    ...(chapters.length > 0 ? ["**Chapters**", ...chapters, ""] : []),
    mp4Url
      ? `[Full quality MP4](${mp4Url}) · ${probe.durationInSeconds.toFixed(0)}s · ${probe.width}×${probe.height}`
      : `Local file: \`remotion/out/${job}.mp4\``,
    "",
    "<sub>Recorded and edited with demotape — re-run the demo file to refresh.</sub>",
  ].join("\n");

  if (args.includes("--dry-run")) {
    console.log("\n--- comment body (dry run, nothing uploaded) ---\n");
    console.log(body);
    console.log("\n--- end ---");
    return;
  }

  if (args.includes("--no-release")) {
    console.log(`\n✓ GIF ready: remotion/out/${job}.gif (distribution skipped)`);
    return;
  }

  // Prerelease on purpose: a demo should not take over the repo's "Latest
  // release" badge just because it needed somewhere to host two files.
  console.log(`\nUploading assets to release ${tag} ...`);
  const created = gh([
    "release", "create", tag,
    "--title", `Demo: ${title}`,
    "--notes", `Demo recording for \`${git.branch ?? job}\`.`,
    "--prerelease",
    mp4, gifPath,
  ]);
  if (created === null) {
    console.log("  Release exists — replacing its assets.");
    if (gh(["release", "upload", tag, mp4, gifPath, "--clobber"]) === null) {
      console.error("✗ Could not upload assets. Is `gh` authenticated?");
      process.exit(1);
    }
  }

  if (!git.pr) {
    console.log(
      `\n✓ Uploaded. No open PR for this branch, so nothing was posted.\n` +
        `  GIF: ${gifUrl}\n  MP4: ${mp4Url}`,
    );
    return;
  }

  const commented = gh(["pr", "comment", String(git.pr.number), "--body", body]);
  if (commented === null) {
    console.error("✗ Assets uploaded but the comment failed to post.");
    process.exit(1);
  }

  console.log(`\n✓ Posted to PR #${git.pr.number}\n  ${git.pr.url}`);
};

if (require.main === module) {
  main();
}
