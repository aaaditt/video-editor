import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { ProgressBar as ProgressBarType } from "../EditPlan";

export const ProgressBar: React.FC<{ bar: ProgressBarType }> = ({ bar }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, height } = useVideoConfig();
  const progress = frame / Math.max(1, durationInFrames - 1);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: Math.max(4, height * 0.008),
          width: `${progress * 100}%`,
          background: bar.color,
          boxShadow: `0 0 12px ${bar.color}`,
        }}
      />
    </AbsoluteFill>
  );
};
