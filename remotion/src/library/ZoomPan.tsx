import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ZoomOverlay } from "../EditPlan";

/**
 * Wraps the video layer and applies animated zoom-ins defined in the edit
 * plan. The zoom scales so the target region fits the frame ("fit" behavior)
 * and pans so the region center lands in the frame center.
 */
export const ZoomPan: React.FC<{
  zooms: ZoomOverlay[];
  concatToFinal: (roughcutSeconds: number) => number;
  children: React.ReactNode;
}> = ({ zooms, concatToFinal, children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentSeconds = frame / fps;

  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  for (const zoom of zooms) {
    const start = concatToFinal(zoom.from);
    const end = concatToFinal(zoom.to);
    if (currentSeconds < start || currentSeconds > end) continue;

    const ease = Math.min(zoom.easeInSeconds, (end - start) / 2);
    const progress = interpolate(
      currentSeconds,
      [start, start + ease, end - ease, end],
      [0, 1, 1, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.cubic),
      },
    );

    const { region } = zoom;
    const targetScale = Math.min(1 / region.width, 1 / region.height);
    // Shift the region center to the frame center (applied pre-scale)
    const targetX = (0.5 - (region.x + region.width / 2)) * width;
    const targetY = (0.5 - (region.y + region.height / 2)) * height;

    scale = 1 + (targetScale - 1) * progress;
    translateX = targetX * progress;
    translateY = targetY * progress;
    break; // zooms are expected not to overlap; first active one wins
  }

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
