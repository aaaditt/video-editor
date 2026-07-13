import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  createTikTokStyleCaptions,
  type Caption,
  type TikTokPage,
} from "@remotion/captions";

export type CaptionStyle = "clean" | "bold-word" | "lower-third";

const HIGHLIGHT_COLOR = "#FFD230";

const CaptionPage: React.FC<{ page: TikTokPage; style: CaptionStyle }> = ({
  page,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps, height: rawHeight, width } = useVideoConfig();
  // On narrow (vertical) frames, scale type by width so long words fit
  const height = Math.min(rawHeight, width * 1.35);

  // Elapsed time within this page ≈ elapsed rough-cut time (pages don't
  // straddle transition boundaries in practice)
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;

  const tokens = page.tokens.map((token) => {
    const isActive =
      token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
    return { ...token, isActive };
  });

  if (style === "bold-word") {
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center" }}>
        <div
          style={{
            marginBottom: height * 0.12,
            fontSize: height * 0.06,
            fontWeight: 900,
            textTransform: "uppercase",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            textAlign: "center",
            maxWidth: "85%",
            color: "white",
            textShadow: "0 4px 24px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.9)",
          }}
        >
          {tokens.map((token) => (
            <span
              key={token.fromMs}
              style={{
                color: token.isActive ? HIGHLIGHT_COLOR : "white",
                display: "inline-block",
                transform: token.isActive ? "scale(1.08)" : "scale(1)",
              }}
            >
              {token.text}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  if (style === "lower-third") {
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start" }}>
        <div
          style={{
            marginBottom: height * 0.08,
            marginLeft: height * 0.06,
            fontSize: height * 0.038,
            fontWeight: 600,
            whiteSpace: "pre-wrap",
            maxWidth: "70%",
            color: "white",
            backgroundColor: "rgba(10, 10, 20, 0.75)",
            borderLeft: `${height * 0.008}px solid ${HIGHLIGHT_COLOR}`,
            padding: `${height * 0.015}px ${height * 0.03}px`,
            borderRadius: 8,
          }}
        >
          {tokens.map((token) => (
            <span key={token.fromMs}>{token.text}</span>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  // "clean" (default)
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center" }}>
      <div
        style={{
          marginBottom: height * 0.07,
          fontSize: height * 0.042,
          fontWeight: 600,
          whiteSpace: "pre-wrap",
          textAlign: "center",
          maxWidth: "80%",
          color: "white",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          padding: `${height * 0.012}px ${height * 0.028}px`,
          borderRadius: 12,
        }}
      >
        {tokens.map((token) => (
          <span key={token.fromMs}>{token.text}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const Captions: React.FC<{
  captions: Caption[];
  style: CaptionStyle;
  concatToFinal: (roughcutSeconds: number) => number;
}> = ({ captions, style, concatToFinal }) => {
  const { fps } = useVideoConfig();

  const switchEveryMs = style === "bold-word" ? 800 : 1500;

  const { pages } = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions,
        combineTokensWithinMilliseconds: switchEveryMs,
      }),
    [captions, switchEveryMs],
  );

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = concatToFinal(page.startMs / 1000) * fps;
        const endFrame = Math.min(
          nextPage ? concatToFinal(nextPage.startMs / 1000) * fps : Infinity,
          startFrame + (switchEveryMs / 1000) * fps,
        );
        const durationInFrames = Math.round(endFrame - startFrame);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={index}
            from={Math.round(startFrame)}
            durationInFrames={durationInFrames}
          >
            <CaptionPage page={page} style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
