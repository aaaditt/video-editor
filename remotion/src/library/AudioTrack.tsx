import React from "react";
import { Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import type { AudioBlock, SfxCue } from "../EditPlan";

/** Seconds of speech (final timeline) used for music ducking. */
export type SpeechWindow = { start: number; end: number };

const DUCK_RATIO = 0.35;
const DUCK_RAMP_SECONDS = 0.25;

/**
 * Background music bed. Loops for the whole composition and, when ducking is
 * enabled, dips under speech using the caption-derived windows.
 */
export const MusicTrack: React.FC<{
  music: NonNullable<AudioBlock["music"]>;
  speechWindows: SpeechWindow[];
}> = ({ music, speechWindows }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const base = music.volume;

  const volumeAt = (f: number): number => {
    if (!music.ducking || speechWindows.length === 0) return base;
    const t = f / fps;
    // Duck fully inside a window; ramp in/out near its edges
    let gain = 1;
    for (const w of speechWindows) {
      if (t >= w.start - DUCK_RAMP_SECONDS && t <= w.end + DUCK_RAMP_SECONDS) {
        const inRamp = interpolate(
          t,
          [w.start - DUCK_RAMP_SECONDS, w.start, w.end, w.end + DUCK_RAMP_SECONDS],
          [1, DUCK_RATIO, DUCK_RATIO, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        gain = Math.min(gain, inRamp);
      }
    }
    // Fade the bed out over the last second of the video
    const fadeOut = interpolate(
      f,
      [durationInFrames - fps, durationInFrames],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return base * gain * fadeOut;
  };

  return (
    <Audio
      src={staticFile(music.file)}
      loop
      loopVolumeCurveBehavior="extend"
      volume={volumeAt}
    />
  );
};

/** Short one-shot sound effects at mapped timestamps. */
export const SfxLayer: React.FC<{
  cues: SfxCue[];
  concatToFinal: (roughcutSeconds: number) => number;
  offsetFrames: number;
}> = ({ cues, concatToFinal, offsetFrames }) => {
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <>
      {cues.map((cue, i) => {
        const file = cue.file ?? `assets/sfx/${cue.preset ?? "pop"}.wav`;
        const from = offsetFrames + Math.round(concatToFinal(cue.at) * fps);
        if (from < 0 || from >= durationInFrames - 1) return null;
        return (
          <Sequence key={i} from={from}>
            <Audio src={staticFile(file)} volume={cue.volume} />
          </Sequence>
        );
      })}
    </>
  );
};
