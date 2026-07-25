import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ClickRing as ClickRingOverlay } from "../EditPlan";

/**
 * Ripple marking a click.
 *
 * Drawn here rather than injected into the page so it stays crisp at render
 * resolution, survives a change of mind about styling without re-recording,
 * and never interferes with the app's own hover states.
 */
export const ClickRing: React.FC<{
  ring: ClickRingOverlay;
  durationInFrames: number;
}> = ({ ring, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Ring expands and fades; the dot punches in fast and fades faster, which
  // reads as "pressed here" rather than "something is pulsing here".
  const ringSize = interpolate(t, [0, 1], [height * 0.02, height * 0.14]);
  const ringOpacity = interpolate(t, [0, 0.15, 1], [0, 0.9, 0], {
    extrapolateRight: "clamp",
  });
  const dotOpacity = interpolate(t, [0, 0.1, 0.45], [0, 1, 0], {
    extrapolateRight: "clamp",
  });
  const dotSize = height * 0.018;

  const left = ring.x * width;
  const top = ring.y * height;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: ringSize,
          height: ringSize,
          marginLeft: -ringSize / 2,
          marginTop: -ringSize / 2,
          borderRadius: "50%",
          border: `${Math.max(2, height * 0.005)}px solid ${ring.color}`,
          opacity: ringOpacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: dotSize,
          height: dotSize,
          marginLeft: -dotSize / 2,
          marginTop: -dotSize / 2,
          borderRadius: "50%",
          backgroundColor: ring.color,
          opacity: dotOpacity,
        }}
      />
    </AbsoluteFill>
  );
};
