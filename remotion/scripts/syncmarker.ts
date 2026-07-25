/**
 * Find the sync flash in a recording, so step timestamps can be mapped onto
 * video timestamps exactly.
 *
 * record.ts paints a full-viewport magenta frame before the first step and
 * notes the step-time it did so. This locates the same moment in the encoded
 * video; the difference between the two is the offset for that run.
 *
 * Detection is done by decoding the opening seconds down to 2x2 raw RGB and
 * scanning the bytes — 12 bytes per frame, no image library, and immune to the
 * keyframe-snapping that makes naive frame seeking unreliable on webm.
 */
import { spawnSync } from "node:child_process";
import { ffmpegPath } from "./ffbin";
import { SYNC_COLOR } from "./driver";

/** How far into the recording to look for the flash. */
const SEARCH_SECONDS = 8;
/** Sampling rate of the scan; also the precision of the result. */
const SAMPLE_FPS = 60;
/** Per-channel tolerance — encoding shifts the colour slightly. */
const TOLERANCE = 60;

const isSyncPixel = (r: number, g: number, b: number): boolean =>
  Math.abs(r - SYNC_COLOR.r) <= TOLERANCE &&
  Math.abs(g - SYNC_COLOR.g) <= TOLERANCE &&
  Math.abs(b - SYNC_COLOR.b) <= TOLERANCE;

/**
 * Video-time (seconds) of the first frame showing the sync flash, or null if
 * it never appears.
 */
export const findSyncFlash = (videoPath: string): number | null => {
  const res = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel", "error",
      "-i", videoPath,
      "-t", String(SEARCH_SECONDS),
      "-vf", `fps=${SAMPLE_FPS},scale=2:2`,
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  if (res.status !== 0 || !res.stdout) return null;

  const buf = res.stdout;
  const FRAME_BYTES = 2 * 2 * 3;
  const frames = Math.floor(buf.length / FRAME_BYTES);

  for (let f = 0; f < frames; f++) {
    const base = f * FRAME_BYTES;
    let allMatch = true;
    for (let p = 0; p < 4; p++) {
      const i = base + p * 3;
      if (!isSyncPixel(buf[i], buf[i + 1], buf[i + 2])) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return f / SAMPLE_FPS;
  }
  return null;
};
