import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { TitleCard as TitleCardType } from "../EditPlan";

export const TitleCard: React.FC<{
  card: TitleCardType;
  durationInFrames: number;
}> = ({ card, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 } });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - Math.round(fps * 0.4), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const subtitleEnter = spring({
    frame: frame - Math.round(fps * 0.25),
    fps,
    config: { damping: 200 },
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0f0f1a 0%, #1c1c30 100%)",
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          fontSize: height * 0.09,
          fontWeight: 800,
          color: "white",
          textAlign: "center",
          maxWidth: "85%",
          opacity: enter,
          transform: `translateY(${(1 - enter) * height * 0.04}px)`,
        }}
      >
        {card.title}
      </div>
      {card.subtitle ? (
        <div
          style={{
            marginTop: height * 0.025,
            fontSize: height * 0.04,
            fontWeight: 500,
            color: "rgba(255,255,255,0.65)",
            textAlign: "center",
            maxWidth: "80%",
            opacity: subtitleEnter,
            transform: `translateY(${(1 - subtitleEnter) * height * 0.03}px)`,
          }}
        >
          {card.subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
