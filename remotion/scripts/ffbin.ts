import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Resolve ffmpeg/ffprobe binaries. Order:
 * 1. FFMPEG_PATH / FFPROBE_PATH env vars
 * 2. Plain name on PATH
 * 3. WinGet package folder (fresh installs aren't on inherited PATH)
 */
const findInWingetPackages = (name: string): string | null => {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return null;
  const packagesDir = path.join(
    process.env.LOCALAPPDATA,
    "Microsoft",
    "WinGet",
    "Packages",
  );
  if (!existsSync(packagesDir)) return null;
  const pkg = readdirSync(packagesDir).find((d) =>
    d.toLowerCase().startsWith("gyan.ffmpeg"),
  );
  if (!pkg) return null;
  const pkgDir = path.join(packagesDir, pkg);
  const build = readdirSync(pkgDir).find((d) => d.startsWith("ffmpeg-"));
  if (!build) return null;
  const bin = path.join(pkgDir, build, "bin", `${name}.exe`);
  return existsSync(bin) ? bin : null;
};

const resolveBin = (name: "ffmpeg" | "ffprobe"): string => {
  const envOverride = process.env[`${name.toUpperCase()}_PATH`];
  if (envOverride && existsSync(envOverride)) return envOverride;

  try {
    execFileSync(name, ["-version"], { stdio: "ignore" });
    return name;
  } catch {
    // not on PATH — fall through
  }

  const wingetBin = findInWingetPackages(name);
  if (wingetBin) return wingetBin;

  throw new Error(
    `${name} not found. Install with: winget install Gyan.FFmpeg (or set ${name.toUpperCase()}_PATH)`,
  );
};

export const ffmpegPath = resolveBin("ffmpeg");
export const ffprobePath = resolveBin("ffprobe");

export const runFf = (bin: string, args: string[]): string => {
  return execFileSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
};

/**
 * Run ffmpeg and return combined stdout+stderr. Analysis filters
 * (loudnorm, silencedetect, ebur128, showinfo) report on stderr.
 */
export const runFfCapture = (bin: string, args: string[]): string => {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
};

export type ProbeResult = {
  durationInSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  sizeInBytes: number;
};

export const probeFile = (file: string): ProbeResult => {
  const raw = runFf(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const data = JSON.parse(raw);
  const video = data.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const audio = data.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );
  if (!video) throw new Error(`No video stream found in ${file}`);

  const [num, den] = (video.avg_frame_rate ?? "30/1").split("/").map(Number);
  const fps = den ? num / den : 30;

  return {
    durationInSeconds: Number(data.format?.duration ?? video.duration ?? 0),
    width: Number(video.width),
    height: Number(video.height),
    fps: Math.round(fps * 1000) / 1000,
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name ?? null,
    sizeInBytes: Number(data.format?.size ?? 0),
  };
};
