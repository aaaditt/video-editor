import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CalloutOverlay } from "../EditPlan";

const ACCENT = "#FFD230";

/**
 * A highlight overlay: either a "box" outlining a region of the frame, or a
 * "label" pill anchored at a point. Pops in with a spring, fades out.
 */
export const Callout: React.FC<{
  callout: CalloutOverlay;
  durationInFrames: number;
}> = ({ callout, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - Math.round(fps * 0.3), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = pop * fadeOut;

  if (callout.variant === "box") {
    const w = (callout.width ?? 0.2) * width;
    const h = (callout.height ?? 0.2) * height;
    return (
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: callout.x * width,
            top: callout.y * height,
            width: w,
            height: h,
            border: `${Math.max(3, height * 0.005)}px solid ${ACCENT}`,
            borderRadius: 10,
            boxShadow: "0 0 0 4000px rgba(0,0,0,0.25)",
            opacity,
            transform: `scale(${0.9 + 0.1 * pop})`,
          }}
        />
        {callout.text ? (
          <div
            style={{
              position: "absolute",
              left: callout.x * width,
              top: callout.y * height + h + height * 0.015,
              fontSize: height * 0.032,
              fontWeight: 700,
              color: "#111",
              backgroundColor: ACCENT,
              padding: `${height * 0.008}px ${height * 0.02}px`,
              borderRadius: 8,
              opacity,
            }}
          >
            {callout.text}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  // "label"
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: callout.x * width,
          top: callout.y * height,
          transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * pop})`,
          fontSize: height * 0.036,
          fontWeight: 700,
          color: "#111",
          backgroundColor: ACCENT,
          padding: `${height * 0.01}px ${height * 0.025}px`,
          borderRadius: 999,
          boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          opacity,
          whiteSpace: "nowrap",
        }}
      >
        {callout.text}
      </div>
    </AbsoluteFill>
  );
};
