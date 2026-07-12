import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Watermark as WatermarkType } from "../EditPlan";

export const Watermark: React.FC<{ watermark: WatermarkType }> = ({
  watermark,
}) => {
  const { height } = useVideoConfig();
  const margin = height * 0.03;

  const position: React.CSSProperties = {
    "top-left": { top: margin, left: margin },
    "top-right": { top: margin, right: margin },
    "bottom-left": { bottom: margin, left: margin },
    "bottom-right": { bottom: margin, right: margin },
  }[watermark.corner];

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...position,
          fontSize: height * 0.028,
          fontWeight: 600,
          color: "white",
          opacity: watermark.opacity,
          textShadow: "0 1px 4px rgba(0,0,0,0.6)",
        }}
      >
        {watermark.text}
      </div>
    </AbsoluteFill>
  );
};
