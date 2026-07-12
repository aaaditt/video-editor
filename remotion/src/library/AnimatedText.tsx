import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { AnimatedText as AnimatedTextType } from "../EditPlan";

export const AnimatedText: React.FC<{
  overlay: AnimatedTextType;
  durationInFrames: number;
}> = ({ overlay, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const fadeOut = interpolate(
    frame,
    [durationInFrames - Math.round(fps * 0.3), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const justify = {
    top: "flex-start",
    center: "center",
    bottom: "flex-end",
  }[overlay.position];

  const baseStyle: React.CSSProperties = {
    fontSize: height * 0.07,
    fontWeight: 800,
    color: "white",
    textAlign: "center",
    maxWidth: "85%",
    textShadow: "0 4px 24px rgba(0,0,0,0.85)",
    opacity: fadeOut,
  };

  let content: React.ReactNode;

  if (overlay.animation === "typewriter") {
    // String slicing (never per-character opacity)
    const typeDuration = Math.min(durationInFrames * 0.6, fps * 1.5);
    const chars = Math.round(
      interpolate(frame, [0, typeDuration], [0, overlay.text.length], {
        extrapolateRight: "clamp",
      }),
    );
    const showCursor = Math.floor(frame / (fps * 0.4)) % 2 === 0;
    content = (
      <div style={{ ...baseStyle, fontFamily: "Consolas, monospace" }}>
        {overlay.text.slice(0, chars)}
        <span style={{ opacity: showCursor ? 1 : 0 }}>|</span>
      </div>
    );
  } else if (overlay.animation === "word-pop") {
    const words = overlay.text.split(" ");
    const staggerFrames = Math.max(2, Math.round((fps * 0.12)));
    content = (
      <div style={baseStyle}>
        {words.map((word, i) => {
          const pop = spring({
            frame: frame - i * staggerFrames,
            fps,
            config: { damping: 12, mass: 0.5 },
          });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.28em",
                opacity: pop,
                transform: `scale(${0.4 + 0.6 * pop}) translateY(${(1 - pop) * 20}px)`,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    );
  } else {
    // slide-in
    const enter = spring({ frame, fps, config: { damping: 200 } });
    content = (
      <div
        style={{
          ...baseStyle,
          opacity: enter * fadeOut,
          transform: `translateX(${(1 - enter) * -60}px)`,
        }}
      >
        {overlay.text}
      </div>
    );
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: justify,
        alignItems: "center",
        padding: height * 0.08,
      }}
    >
      {content}
    </AbsoluteFill>
  );
};
