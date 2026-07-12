import React from "react";
import { AbsoluteFill, random } from "remotion";
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";

type EmptyProps = Record<string, never>;

/**
 * Zoom-punch: outgoing clip scales up and fades; incoming clip lands from a
 * slight over-zoom. Reads as a fast "punch" cut.
 */
const ZoomPunchPresentation: React.FC<
  TransitionPresentationComponentProps<EmptyProps>
> = ({ children, presentationDirection, presentationProgress }) => {
  const isEntering = presentationDirection === "entering";
  const scale = isEntering
    ? 1.25 - 0.25 * presentationProgress
    : 1 + 0.3 * presentationProgress;
  const opacity = isEntering ? presentationProgress : 1 - presentationProgress;

  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, opacity }}>
      {children}
    </AbsoluteFill>
  );
};

export const zoomPunch = (): TransitionPresentation<EmptyProps> => ({
  component: ZoomPunchPresentation,
  props: {},
});

/**
 * Whip-pan: both clips fly horizontally through the cut with a blur that
 * peaks mid-transition, mimicking a fast camera whip.
 */
const WhipPanPresentation: React.FC<
  TransitionPresentationComponentProps<EmptyProps>
> = ({ children, presentationDirection, presentationProgress }) => {
  const isEntering = presentationDirection === "entering";
  const translate = isEntering
    ? (1 - presentationProgress) * 100
    : -presentationProgress * 100;
  // Blur peaks in the middle of the motion
  const blur = Math.sin(presentationProgress * Math.PI) * 24;

  return (
    <AbsoluteFill
      style={{
        transform: `translateX(${translate}%)`,
        filter: `blur(${blur}px)`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const whipPan = (): TransitionPresentation<EmptyProps> => ({
  component: WhipPanPresentation,
  props: {},
});

/**
 * Glitch: the incoming clip appears in horizontal slices that are offset
 * randomly and settle as the transition completes; outgoing clip flickers.
 */
const SLICES = 8;

const GlitchPresentation: React.FC<
  TransitionPresentationComponentProps<EmptyProps>
> = ({ children, presentationDirection, presentationProgress }) => {
  const isEntering = presentationDirection === "entering";

  if (!isEntering) {
    const flicker = random(`glitch-flicker-${Math.round(presentationProgress * 30)}`);
    return (
      <AbsoluteFill
        style={{ opacity: (1 - presentationProgress) * (flicker > 0.2 ? 1 : 0.35) }}
      >
        {children}
      </AbsoluteFill>
    );
  }

  const settle = presentationProgress; // 0 → 1, offsets shrink to zero
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, settle * 2) }}>
      {Array.from({ length: SLICES }).map((_, i) => {
        const seedBucket = Math.round(settle * 20);
        const offset =
          (random(`glitch-${i}-${seedBucket}`) - 0.5) * 2 * (1 - settle) * 12;
        return (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${(i / SLICES) * 100}% 0 ${
                ((SLICES - 1 - i) / SLICES) * 100
              }% 0)`,
              transform: `translateX(${offset}%)`,
            }}
          >
            {children}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

export const glitch = (): TransitionPresentation<EmptyProps> => ({
  component: GlitchPresentation,
  props: {},
});
