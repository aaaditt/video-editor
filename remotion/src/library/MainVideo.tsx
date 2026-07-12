import React from "react";
import { staticFile, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import {
  linearTiming,
  TransitionSeries,
  type TransitionPresentation,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { segmentDuration, type EditPlan } from "../EditPlan";

const presentationFor = (
  type: "fade" | "slide" | "wipe",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): TransitionPresentation<any> => {
  if (type === "slide") return slide({ direction: "from-right" });
  if (type === "wipe") return wipe();
  return fade();
};

/**
 * The base video layer. Without transitions this is simply the rough cut.
 * With transitions, the individual segment files are stitched with a
 * TransitionSeries (adjacent segments overlap during the transition).
 */
export const MainVideo: React.FC<{ plan: EditPlan }> = ({ plan }) => {
  const { fps } = useVideoConfig();

  const hasTransitions = plan.segments.some(
    (seg, i) => i < plan.segments.length - 1 && seg.transitionAfter,
  );

  if (!hasTransitions) {
    return <Video src={staticFile(`jobs/${plan.job}/roughcut.mp4`)} />;
  }

  return (
    <TransitionSeries>
      {plan.segments.flatMap((seg, i) => {
        const isLast = i === plan.segments.length - 1;
        const segFile = `jobs/${plan.job}/seg-${String(i).padStart(3, "0")}.mp4`;
        const nodes = [
          <TransitionSeries.Sequence
            key={`seg-${i}`}
            durationInFrames={Math.round(segmentDuration(seg) * fps)}
          >
            <Video src={staticFile(segFile)} />
          </TransitionSeries.Sequence>,
        ];
        if (!isLast && seg.transitionAfter) {
          nodes.push(
            <TransitionSeries.Transition
              key={`transition-${i}`}
              presentation={presentationFor(seg.transitionAfter.type)}
              timing={linearTiming({
                durationInFrames: Math.round(
                  seg.transitionAfter.durationInSeconds * fps,
                ),
              })}
            />,
          );
        }
        return nodes;
      })}
    </TransitionSeries>
  );
};
