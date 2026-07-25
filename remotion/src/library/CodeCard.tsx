import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CodeCard as CodeCardOverlay } from "../EditPlan";

const MONO =
  'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "Liberation Mono", monospace';

const ADDED = "#56d364";
const REMOVED = "#f85149";
const HUNK = "#79c0ff";
const CONTEXT = "#c9d1d9";

/**
 * The diff, as a card.
 *
 * Composed from `git diff` rather than filmed off an editor: it stays sharp,
 * sizes itself to the frame, and cannot drift out of date the way a recording
 * of your screen does.
 *
 * Only +/- colouring, no syntax highlighting — for a diff that carries almost
 * all of the meaning, and it keeps a highlighter off the render path.
 */
export const CodeCard: React.FC<{
  card: CodeCardOverlay;
  durationInFrames: number;
}> = ({ card, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 18, mass: 0.7 } });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - Math.round(fps * 0.35), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = pop * fadeOut;

  const fontSize = Math.min(height * 0.028, (width * 0.62) / 46);
  const lineHeight = fontSize * 1.5;
  const pad = height * 0.03;

  const colorFor = (line: string): string => {
    if (line.startsWith("@@")) return HUNK;
    if (line.startsWith("+")) return ADDED;
    if (line.startsWith("-")) return REMOVED;
    return CONTEXT;
  };

  const backgroundFor = (line: string): string => {
    if (line.startsWith("+")) return "rgba(46,160,67,0.15)";
    if (line.startsWith("-")) return "rgba(248,81,73,0.12)";
    return "transparent";
  };

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: `rgba(0,0,0,${0.55 * opacity})`,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - pop) * height * 0.04}px)`,
          maxWidth: "84%",
          backgroundColor: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: height * 0.018,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: `${pad * 0.5}px ${pad}px`,
            borderBottom: "1px solid #21262d",
            backgroundColor: "#161b22",
            color: "#8b949e",
            fontFamily: MONO,
            fontSize: fontSize * 0.95,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {card.title}
        </div>

        <div style={{ padding: `${pad * 0.6}px 0` }}>
          {card.lines.map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: MONO,
                fontSize,
                lineHeight: `${lineHeight}px`,
                color: colorFor(line),
                backgroundColor: backgroundFor(line),
                padding: `0 ${pad}px`,
                whiteSpace: "pre",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {line.length > 0 ? line : " "}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
