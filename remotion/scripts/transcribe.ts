/**
 * Transcribe a job's rough cut with whisper.cpp (local, word-level timestamps)
 * and write captions in the @remotion/captions format.
 *
 * Produces in the job folder:
 *   audio-16k.wav   (intermediate, 16kHz mono — what whisper needs)
 *   captions.json   (Caption[] — consumed by the Captions component)
 *
 * Usage: npx tsx scripts/transcribe.ts <job-name> [model]
 *   model defaults to "base.en" (~150MB). Use "medium.en" for higher accuracy.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
  type WhisperModel,
} from "@remotion/install-whisper-cpp";
import { ffmpegPath, probeFile } from "./ffbin";

const WHISPER_VERSION = "1.5.5";
const WHISPER_DIR = path.join(__dirname, "..", "whisper.cpp");

const job = process.argv[2];
const model = (process.argv[3] ?? "base.en") as WhisperModel;
if (!job) {
  console.error("Usage: npx tsx scripts/transcribe.ts <job-name> [model]");
  process.exit(1);
}

const jobDir = path.resolve(__dirname, "..", "public", "jobs", job);
const roughcut = path.join(jobDir, "roughcut.mp4");
if (!fs.existsSync(roughcut)) {
  console.error(`No rough cut at ${roughcut} — run roughcut.ts first`);
  process.exit(1);
}

if (!probeFile(roughcut).hasAudio) {
  console.error("Rough cut has no audio stream — nothing to transcribe");
  process.exit(1);
}

const run = async () => {
  console.log(`Installing whisper.cpp ${WHISPER_VERSION} (no-op if present)...`);
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION });
  await downloadWhisperModel({ model, folder: WHISPER_DIR });

  const wav = path.join(jobDir, "audio-16k.wav");
  console.log("Extracting 16kHz mono audio...");
  execFileSync(
    ffmpegPath,
    ["-y", "-hide_banner", "-loglevel", "warning", "-i", roughcut, "-ar", "16000", "-ac", "1", wav],
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  console.log(`Transcribing with ${model}...`);
  const whisperCppOutput = await transcribe({
    model,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    inputPath: wav,
    tokenLevelTimestamps: true,
  });

  const { captions } = toCaptions({ whisperCppOutput });
  const outPath = path.join(jobDir, "captions.json");
  fs.writeFileSync(outPath, JSON.stringify(captions, null, 2));
  console.log(`✓ ${captions.length} caption tokens → ${outPath}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
