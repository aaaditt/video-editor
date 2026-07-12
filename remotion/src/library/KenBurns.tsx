import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { KenBurns as KenBurnsType } from "../EditPlan";

/**
 * Slow drift zoom over a time range (classic Ken Burns). Wraps the video
 * layer; multiple ranges supported, first active one wins.
 */
export const KenBurnsWrapper: React.FC<{
  kenBurns: KenBurnsType[];
  concatToFinal: (roughcutSeconds: number) => number;
  children: React.ReactNode;
}> = ({ kenBurns, concatToFinal, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  let transform: string | undefined;
  for (const kb of kenBurns) {
    const start = concatToFinal(kb.from);
    const end = concatToFinal(kb.to);
    if (t < start || t > end || end <= start) continue;

    const progress = interpolate(t, [start, end], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const zoom =
      kb.direction === "in"
        ? 1 + kb.strength * progress
        : 1 + kb.strength * (1 - progress);
    // Gentle sideways drift makes it feel hand-held rather than digital
    const driftX = (progress - 0.5) * kb.strength * 30;
    transform = `scale(${zoom}) translateX(${driftX}px)`;
    break;
  }

  return <AbsoluteFill style={{ transform }}>{children}</AbsoluteFill>;
};
