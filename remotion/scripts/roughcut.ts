/**
 * Execute the structural part of an edit plan with FFmpeg:
 * cut segments out of the source, apply speed changes, aspect crop,
 * concatenate.
 *
 * Produces in the job folder:
 *   seg-000.mp4, seg-001.mp4, ...  (re-encoded, frame-accurate segments)
 *   roughcut.mp4                   (all segments concatenated)
 *   roughcut-probe.json            (ffprobe metadata of the rough cut)
 *
 * Usage: npx tsx scripts/roughcut.ts <job-name>
 *   (run from the remotion/ folder; job lives at public/jobs/<job-name>/)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  editPlanSchema,
  roughcutDuration,
  segmentDuration,
  type EditPlan,
  type Segment,
} from "../src/EditPlan";
import { ffmpegPath, probeFile } from "./ffbin";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// atempo only accepts 0.5..2.0 per instance; chain to reach any speed
const atempoChain = (speed: number): string => {
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors.map((f) => `atempo=${f.toFixed(6)}`).join(",");
};

// Aspect crop (e.g. 9:16 for Shorts): crop a window out of the source, with
// cropFocus (0..1) steering the horizontal center. Runs before scaling.
const buildCropFilter = (plan: EditPlan): string | null => {
  const { aspect, cropFocus } = plan.output;
  if (aspect === "source") return null;
  const [aw, ah] = aspect === "9:16" ? [9, 16] : [1, 1];
  return (
    `crop='min(iw,ih*${aw}/${ah})':'min(ih,iw*${ah}/${aw})'` +
    `:'(iw-ow)*${cropFocus}':'(ih-oh)/2'`
  );
};

export const runRoughcut = (job: string): void => {
  const jobDir = path.resolve(__dirname, "..", "public", "jobs", job);
  const planPath = path.join(jobDir, "edit-plan.json");
  if (!fs.existsSync(planPath)) {
    throw new Error(`No edit plan at ${planPath}`);
  }

  const plan = editPlanSchema.parse(
    JSON.parse(fs.readFileSync(planPath, "utf8")),
  );

  const source = path.isAbsolute(plan.source)
    ? plan.source
    : path.resolve(REPO_ROOT, plan.source);
  if (!fs.existsSync(source)) {
    throw new Error(`Source footage not found: ${source}`);
  }

  const sourceProbe = probeFile(source);
  console.log(
    `Source: ${sourceProbe.width}x${sourceProbe.height} @ ${sourceProbe.fps}fps, ` +
      `${sourceProbe.durationInSeconds.toFixed(2)}s, audio: ${sourceProbe.hasAudio}`,
  );

  for (const seg of plan.segments) {
    if (seg.end <= seg.start) {
      throw new Error(`Invalid segment: end (${seg.end}) <= start (${seg.start})`);
    }
    if (seg.end > sourceProbe.durationInSeconds + 0.1) {
      throw new Error(
        `Segment end ${seg.end}s exceeds source duration ${sourceProbe.durationInSeconds}s`,
      );
    }
  }

  const fps = plan.output.fps;
  const cropFilter = buildCropFilter(plan);
  const scaleFilter =
    plan.output.width && plan.output.height
      ? `scale=${plan.output.width}:${plan.output.height}`
      : `scale=trunc(iw/2)*2:trunc(ih/2)*2`; // ensure even dimensions for yuv420p

  const cutSegment = (seg: Segment, index: number): string => {
    const outFile = path.join(
      jobDir,
      `seg-${String(index).padStart(3, "0")}.mp4`,
    );
    const vf = [cropFilter, scaleFilter, `setpts=PTS/${seg.speed}`, `fps=${fps}`]
      .filter(Boolean)
      .join(",");

    const args = [
      "-y", "-hide_banner", "-loglevel", "warning",
      "-ss", String(seg.start), "-to", String(seg.end), "-i", source,
      "-vf", vf,
    ];
    if (sourceProbe.hasAudio) {
      args.push("-af", atempoChain(seg.speed), "-c:a", "aac", "-b:a", "192k");
    } else {
      args.push("-an");
    }
    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outFile,
    );

    console.log(
      `Cutting segment ${index}: ${seg.start}s → ${seg.end}s` +
        (seg.speed !== 1 ? ` at ${seg.speed}x` : ""),
    );
    execFileSync(ffmpegPath, args, { stdio: ["ignore", "ignore", "inherit"] });

    const expected = segmentDuration(seg);
    const actual = probeFile(outFile).durationInSeconds;
    if (Math.abs(actual - expected) > 0.5) {
      throw new Error(
        `Segment ${index} duration mismatch: expected ${expected.toFixed(2)}s, got ${actual.toFixed(2)}s`,
      );
    }
    return outFile;
  };

  const segmentFiles = plan.segments.map(cutSegment);

  // Concatenate — segments share identical encoding, so stream copy is safe
  const concatList = path.join(jobDir, "concat.txt");
  fs.writeFileSync(
    concatList,
    segmentFiles.map((f) => `file '${path.basename(f)}'`).join("\n"),
  );
  const roughcut = path.join(jobDir, "roughcut.mp4");
  console.log(`Concatenating ${segmentFiles.length} segment(s) → roughcut.mp4`);
  execFileSync(
    ffmpegPath,
    [
      "-y", "-hide_banner", "-loglevel", "warning",
      "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy",
      "roughcut.mp4",
    ],
    { cwd: jobDir, stdio: ["ignore", "ignore", "inherit"] },
  );

  const roughcutProbe = probeFile(roughcut);
  const expectedTotal = roughcutDuration(plan);
  if (Math.abs(roughcutProbe.durationInSeconds - expectedTotal) > 0.75) {
    throw new Error(
      `Rough cut duration mismatch: expected ${expectedTotal.toFixed(2)}s, got ` +
        `${roughcutProbe.durationInSeconds.toFixed(2)}s`,
    );
  }

  fs.writeFileSync(
    path.join(jobDir, "roughcut-probe.json"),
    JSON.stringify(roughcutProbe, null, 2),
  );

  console.log(
    `✓ roughcut.mp4: ${roughcutProbe.durationInSeconds.toFixed(2)}s ` +
      `(expected ${expectedTotal.toFixed(2)}s), ${roughcutProbe.width}x${roughcutProbe.height}`,
  );
};

// CLI entry
if (require.main === module) {
  const job = process.argv[2];
  if (!job) {
    console.error("Usage: npx tsx scripts/roughcut.ts <job-name>");
    process.exit(1);
  }
  try {
    runRoughcut(job);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
