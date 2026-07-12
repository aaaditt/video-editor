import React from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  ColorGrade as ColorGradeType,
  FilmGrain as FilmGrainType,
  Letterbox as LetterboxType,
  Shake as ShakeType,
  Vignette as VignetteType,
} from "../EditPlan";

/** CSS filter chains approximating classic grading looks. */
const LOOKS: Record<ColorGradeType["look"], string> = {
  warm: "sepia(0.25) saturate(1.25) brightness(1.04) contrast(1.05)",
  cold: "hue-rotate(-12deg) saturate(0.9) brightness(0.98) contrast(1.08)",
  noir: "grayscale(1) contrast(1.25) brightness(0.95)",
  vibrant: "saturate(1.6) contrast(1.1)",
};

/**
 * Wraps the video layer and applies whichever grade is active at the current
 * frame. Grades without from/to cover the whole video.
 */
export const ColorGradeWrapper: React.FC<{
  grades: ColorGradeType[];
  concatToFinal: (roughcutSeconds: number) => number;
  children: React.ReactNode;
}> = ({ grades, concatToFinal, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  let look: ColorGradeType["look"] | null = null;
  for (const grade of grades) {
    if (grade.from === undefined || grade.to === undefined) {
      look = grade.look;
      break;
    }
    if (t >= concatToFinal(grade.from) && t <= concatToFinal(grade.to)) {
      look = grade.look;
      break;
    }
  }

  return (
    <AbsoluteFill style={look ? { filter: LOOKS[look] } : undefined}>
      {children}
    </AbsoluteFill>
  );
};

export const FilmGrainLayer: React.FC<{ grain: FilmGrainType }> = ({
  grain,
}) => {
  const frame = useCurrentFrame();
  // Re-seed the noise every frame so the grain "boils" like film
  const seed = Math.floor(frame / 2);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: grain.intensity }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed={seed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect
          width="100%"
          height="100%"
          filter={`url(#grain-${seed})`}
          style={{ mixBlendMode: "overlay" }}
        />
      </svg>
    </AbsoluteFill>
  );
};

export const VignetteLayer: React.FC<{ vignette: VignetteType }> = ({
  vignette,
}) => {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${
          0.75 * vignette.intensity
        }) 100%)`,
      }}
    />
  );
};

export const LetterboxLayer: React.FC<{ letterbox: LetterboxType }> = ({
  letterbox,
}) => {
  const { height } = useVideoConfig();
  const bar = height * letterbox.size;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 0, width: "100%", height: bar, background: "black" }} />
      <div style={{ position: "absolute", bottom: 0, width: "100%", height: bar, background: "black" }} />
    </AbsoluteFill>
  );
};

/** Decaying camera shake applied as a wrapper around the video layer. */
export const ShakeWrapper: React.FC<{
  shakes: ShakeType[];
  concatToFinal: (roughcutSeconds: number) => number;
  children: React.ReactNode;
}> = ({ shakes, concatToFinal, children }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  let transform: string | undefined;
  for (const shake of shakes) {
    const start = concatToFinal(shake.at);
    const end = start + shake.durationInSeconds;
    if (t < start || t > end) continue;

    // Decays from 1 (impact) to 0 over the shake window
    const decay = 1 - (t - start) / shake.durationInSeconds;
    const amplitude = width * 0.012 * shake.intensity * decay;
    const dx = (random(`shake-x-${frame}`) - 0.5) * 2 * amplitude;
    const dy = (random(`shake-y-${frame}`) - 0.5) * 2 * amplitude;
    const rot =
      (random(`shake-r-${frame}`) - 0.5) * 1.2 * shake.intensity * decay;
    transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${
      1 + 0.015 * decay
    })`;
    break;
  }

  return <AbsoluteFill style={{ transform }}>{children}</AbsoluteFill>;
};
