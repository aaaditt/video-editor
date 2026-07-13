/**
 * Analyze raw footage and write analysis.json into the job folder:
 *   - probe metadata
 *   - silence map (adaptive threshold: loudnorm gating threshold → silencedetect)
 *   - loudness envelope (ebur128 momentary loudness, ~10 samples/s)
 *   - scene changes (frame-difference detection)
 *   - transcript with word timestamps (whisper.cpp), in SOURCE seconds
 *
 * Usage: npx tsx scripts/analyze.ts <source> <job-name> [--no-transcript] [--model base.en]
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
import type { Caption } from "@remotion/captions";
import { ffmpegPath, probeFile, runFfCapture, type ProbeResult } from "./ffbin";

const WHISPER_VERSION = "1.5.5";
const WHISPER_DIR = path.join(__dirname, "..", "whisper.cpp");

export type Silence = { start: number; end: number };
export type LoudnessSample = { t: number; m: number };

export type Analysis = {
  source: string;
  probe: ProbeResult;
  loudness: {
    integrated: number | null;
    gatingThreshold: number | null;
  };
  silences: Silence[];
  envelope: LoudnessSample[];
  sceneChanges: number[];
  transcript: Caption[];
};

const extractWav = (source: string, wavPath: string) => {
  execFileSync(
    ffmpegPath,
    ["-y", "-hide_banner", "-loglevel", "warning", "-i", source, "-vn", "-ar", "16000", "-ac", "1", wavPath],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
};

const measureLoudness = (
  wavPath: string,
): { integrated: number | null; gatingThreshold: number | null } => {
  const out = runFfCapture(ffmpegPath, [
    "-hide_banner", "-i", wavPath,
    "-af", "loudnorm=print_format=json",
    "-f", "null", "-",
  ]);
  const jsonMatch = out.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!jsonMatch) return { integrated: null, gatingThreshold: null };
  try {
    const data = JSON.parse(jsonMatch[0]);
    return {
      integrated: Number(data.input_i),
      gatingThreshold: Number(data.input_thresh),
    };
  } catch {
    return { integrated: null, gatingThreshold: null };
  }
};

const detectSilences = (
  wavPath: string,
  thresholdDb: number,
  totalDuration: number,
): Silence[] => {
  const out = runFfCapture(ffmpegPath, [
    "-hide_banner", "-i", wavPath,
    "-af", `silencedetect=noise=${thresholdDb.toFixed(1)}dB:d=0.6`,
    "-f", "null", "-",
  ]);
  const silences: Silence[] = [];
  let pendingStart: number | null = null;
  for (const line of out.split("\n")) {
    const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (startMatch) pendingStart = Math.max(0, Number(startMatch[1]));
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (endMatch && pendingStart !== null) {
      silences.push({ start: pendingStart, end: Number(endMatch[1]) });
      pendingStart = null;
    }
  }
  // Silence running to the end of the file has no silence_end line
  if (pendingStart !== null) {
    silences.push({ start: pendingStart, end: totalDuration });
  }
  return silences;
};

const loudnessEnvelope = (wavPath: string): LoudnessSample[] => {
  const out = runFfCapture(ffmpegPath, [
    "-hide_banner", "-i", wavPath,
    "-af", "ebur128",
    "-f", "null", "-",
  ]);
  const samples: LoudnessSample[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/t:\s*([\d.]+).*?M:\s*(-?[\d.]+)/);
    if (m) samples.push({ t: Number(m[1]), m: Number(m[2]) });
  }
  return samples;
};

const detectScenes = (source: string): number[] => {
  const out = runFfCapture(ffmpegPath, [
    "-hide_banner", "-i", source,
    "-vf", "select='gt(scene,0.3)',showinfo",
    "-an", "-f", "null", "-",
  ]);
  const scenes: number[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) scenes.push(Number(m[1]));
  }
  return scenes;
};

export const analyzeFootage = async (
  source: string,
  jobDir: string,
  options: { transcript: boolean; model: WhisperModel },
): Promise<Analysis> => {
  const probe = probeFile(source);
  console.log(
    `Source: ${probe.width}x${probe.height} @ ${probe.fps}fps, ` +
      `${probe.durationInSeconds.toFixed(1)}s, audio: ${probe.hasAudio}`,
  );

  let loudness: Analysis["loudness"] = { integrated: null, gatingThreshold: null };
  let silences: Silence[] = [];
  let envelope: LoudnessSample[] = [];
  let transcript: Caption[] = [];

  if (probe.hasAudio) {
    const wav = path.join(jobDir, "source-16k.wav");
    console.log("Extracting audio...");
    extractWav(source, wav);

    console.log("Measuring loudness (loudnorm)...");
    loudness = measureLoudness(wav);
    // Fall back to a sane fixed threshold when measurement fails (e.g. digital silence)
    const threshold = loudness.gatingThreshold ?? -40;
    console.log(`Detecting silences below ${threshold.toFixed(1)} dB...`);
    silences = detectSilences(wav, threshold, probe.durationInSeconds);
    console.log(`  ${silences.length} silence(s) found`);

    console.log("Building loudness envelope (ebur128)...");
    envelope = loudnessEnvelope(wav);

    if (options.transcript) {
      console.log("Installing whisper.cpp (no-op if present)...");
      await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION });
      await downloadWhisperModel({ model: options.model, folder: WHISPER_DIR });
      console.log(`Transcribing with ${options.model}...`);
      const whisperCppOutput = await transcribe({
        model: options.model,
        whisperPath: WHISPER_DIR,
        whisperCppVersion: WHISPER_VERSION,
        inputPath: wav,
        tokenLevelTimestamps: true,
      });
      transcript = toCaptions({ whisperCppOutput }).captions;
      console.log(`  ${transcript.length} caption tokens`);
    }
  }

  console.log("Detecting scene changes...");
  const sceneChanges = detectScenes(source);
  console.log(`  ${sceneChanges.length} scene change(s)`);

  return {
    source,
    probe,
    loudness,
    silences,
    envelope,
    sceneChanges,
    transcript,
  };
};

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const [source, job] = positional;
  if (!source || !job) {
    console.error(
      "Usage: npx tsx scripts/analyze.ts <source> <job-name> [--no-transcript] [--model base.en]",
    );
    process.exit(1);
  }
  const modelFlag = args.indexOf("--model");
  const model = (modelFlag >= 0 ? args[modelFlag + 1] : "base.en") as WhisperModel;
  const jobDir = path.resolve(__dirname, "..", "public", "jobs", job);
  fs.mkdirSync(jobDir, { recursive: true });

  const sourceAbs = path.isAbsolute(source)
    ? source
    : path.resolve(process.cwd(), source);

  analyzeFootage(sourceAbs, jobDir, {
    transcript: !args.includes("--no-transcript"),
    model,
  })
    .then((analysis) => {
      const outPath = path.join(jobDir, "analysis.json");
      fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));
      console.log(`✓ ${outPath}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
