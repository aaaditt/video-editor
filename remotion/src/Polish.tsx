import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import type { Caption } from "@remotion/captions";
import { LightLeak } from "@remotion/light-leaks";
import {
  computeTimeline,
  editPlanSchema,
  type EditPlan,
  type Overlay,
} from "./EditPlan";
import { AnimatedText } from "./library/AnimatedText";
import { MusicTrack, SfxLayer, type SpeechWindow } from "./library/AudioTrack";
import { Captions } from "./library/Captions";
import { Callout } from "./library/Callout";
import {
  ColorGradeWrapper,
  FilmGrainLayer,
  LetterboxLayer,
  ShakeWrapper,
  VignetteLayer,
} from "./library/Effects";
import { KenBurnsWrapper } from "./library/KenBurns";
import { MainVideo } from "./library/MainVideo";
import { ProgressBar } from "./library/ProgressBar";
import { TitleCard } from "./library/TitleCard";
import { Watermark } from "./library/Watermark";
import { ZoomPan } from "./library/ZoomPan";

export type PolishProps = {
  job: string;
  plan: EditPlan | null;
  captions: Caption[] | null;
};

const FONT_STACK =
  "'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif";

/**
 * Loads the job's edit plan, rough-cut probe, and captions before rendering,
 * and derives composition duration/dimensions from them.
 */
export const calculatePolishMetadata: CalculateMetadataFunction<
  PolishProps
> = async ({ props, abortSignal }) => {
  const { job } = props;

  const fetchJson = async (file: string, required: boolean) => {
    const res = await fetch(staticFile(`jobs/${job}/${file}`), {
      signal: abortSignal,
    });
    if (!res.ok) {
      if (!required) return null;
      throw new Error(
        `Missing jobs/${job}/${file}. Create the job folder under remotion/public/jobs/` +
          ` and run: npx tsx scripts/roughcut.ts ${job}`,
      );
    }
    return res.json();
  };

  const plan = editPlanSchema.parse(await fetchJson("edit-plan.json", true));
  const probe = await fetchJson("roughcut-probe.json", true);
  const captions: Caption[] | null = plan.captions
    ? await fetchJson(plan.captions.transcriptFile, true)
    : null;

  const timeline = computeTimeline(plan);

  return {
    durationInFrames: Math.max(1, timeline.totalFrames),
    fps: plan.output.fps,
    width: plan.output.width ?? probe.width,
    height: plan.output.height ?? probe.height,
    props: { job, plan, captions },
    defaultOutName: `${job}-final`,
  };
};

/** Merge caption word timings into contiguous speech windows (roughcut s). */
const speechWindowsFromCaptions = (
  captions: Caption[],
  concatToFinal: (s: number) => number,
  introSeconds: number,
): SpeechWindow[] => {
  const MERGE_GAP = 0.6;
  const windows: { start: number; end: number }[] = [];
  for (const c of captions) {
    const start = c.startMs / 1000;
    const end = c.endMs / 1000;
    const last = windows[windows.length - 1];
    if (last && start - last.end < MERGE_GAP) {
      last.end = Math.max(last.end, end);
    } else {
      windows.push({ start, end });
    }
  }
  return windows.map((w) => ({
    start: introSeconds + concatToFinal(w.start),
    end: introSeconds + concatToFinal(w.end),
  }));
};

export const Polish: React.FC<PolishProps> = ({ plan, captions }) => {
  const timeline = useMemo(
    () => (plan ? computeTimeline(plan) : null),
    [plan],
  );

  const speechWindows = useMemo(() => {
    if (!plan || !captions || !timeline) return [];
    return speechWindowsFromCaptions(
      captions,
      timeline.concatToFinal,
      timeline.introFrames / timeline.fps,
    );
  }, [plan, captions, timeline]);

  if (!plan || !timeline) {
    // calculateMetadata always provides the plan; this only renders if it failed
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#111",
          color: "white",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: FONT_STACK,
          fontSize: 40,
        }}
      >
        No edit plan loaded
      </AbsoluteFill>
    );
  }

  const { fps, introFrames, mainFrames, outroFrames, concatToFinal } = timeline;

  const byType = <K extends Overlay["type"]>(type: K) =>
    plan.overlays.filter(
      (o): o is Extract<Overlay, { type: K }> => o.type === type,
    );

  const titleCards = byType("titleCard");
  const intro = titleCards.find((c) => c.position === "intro");
  const outro = titleCards.find((c) => c.position === "outro");
  const zooms = byType("zoom");
  const callouts = byType("callout");
  const kenBurns = byType("kenBurns");
  const shakes = byType("shake");
  const grades = byType("colorGrade");
  const animatedTexts = byType("animatedText");
  const lightLeaks = byType("lightLeak");
  const watermark = byType("watermark")[0];
  const filmGrain = byType("filmGrain")[0];
  const vignette = byType("vignette")[0];
  const letterbox = byType("letterbox")[0];
  const progressBar = byType("progressBar")[0];

  // Helper: place a rough-cut-timed range as a Sequence inside the main part
  const rangeToSequence = (from: number, to: number) => {
    const startFrame = Math.round(concatToFinal(from) * fps);
    const durationInFrames = Math.round(
      (concatToFinal(to) - concatToFinal(from)) * fps,
    );
    return { startFrame, durationInFrames };
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "black", fontFamily: FONT_STACK }}>
      {intro ? (
        <Sequence durationInFrames={introFrames}>
          <TitleCard card={intro} durationInFrames={introFrames} />
        </Sequence>
      ) : null}

      <Sequence from={introFrames} durationInFrames={mainFrames}>
        {/* Video stack: shake > zoom > ken burns > grade > video */}
        <ShakeWrapper shakes={shakes} concatToFinal={concatToFinal}>
          <ZoomPan zooms={zooms} concatToFinal={concatToFinal}>
            <KenBurnsWrapper kenBurns={kenBurns} concatToFinal={concatToFinal}>
              <ColorGradeWrapper grades={grades} concatToFinal={concatToFinal}>
                <MainVideo plan={plan} />
              </ColorGradeWrapper>
            </KenBurnsWrapper>
          </ZoomPan>
        </ShakeWrapper>

        {/* Look layers */}
        {filmGrain ? <FilmGrainLayer grain={filmGrain} /> : null}
        {vignette ? <VignetteLayer vignette={vignette} /> : null}
        {letterbox ? <LetterboxLayer letterbox={letterbox} /> : null}

        {/* Light leaks */}
        {lightLeaks.map((leak, i) => {
          const { startFrame, durationInFrames } = rangeToSequence(
            leak.from,
            leak.to,
          );
          if (durationInFrames <= 0) return null;
          return (
            <Sequence key={`leak-${i}`} from={startFrame} durationInFrames={durationInFrames}>
              <LightLeak
                durationInFrames={durationInFrames}
                seed={leak.seed}
                hueShift={leak.hueShift}
              />
            </Sequence>
          );
        })}

        {/* Text layers */}
        {plan.captions && captions ? (
          <Captions
            captions={captions}
            style={plan.captions.style}
            concatToFinal={concatToFinal}
          />
        ) : null}

        {callouts.map((callout, i) => {
          const { startFrame, durationInFrames } = rangeToSequence(
            callout.from,
            callout.to,
          );
          if (durationInFrames <= 0) return null;
          return (
            <Sequence key={`callout-${i}`} from={startFrame} durationInFrames={durationInFrames}>
              <Callout callout={callout} durationInFrames={durationInFrames} />
            </Sequence>
          );
        })}

        {animatedTexts.map((text, i) => {
          const { startFrame, durationInFrames } = rangeToSequence(
            text.from,
            text.to,
          );
          if (durationInFrames <= 0) return null;
          return (
            <Sequence key={`text-${i}`} from={startFrame} durationInFrames={durationInFrames}>
              <AnimatedText overlay={text} durationInFrames={durationInFrames} />
            </Sequence>
          );
        })}
      </Sequence>

      {outro ? (
        <Sequence from={introFrames + mainFrames} durationInFrames={outroFrames}>
          <TitleCard card={outro} durationInFrames={outroFrames} />
        </Sequence>
      ) : null}

      {/* Full-composition layers */}
      {watermark ? <Watermark watermark={watermark} /> : null}
      {progressBar ? <ProgressBar bar={progressBar} /> : null}

      {/* Audio */}
      {plan.audio.music ? (
        <MusicTrack music={plan.audio.music} speechWindows={speechWindows} />
      ) : null}
      {plan.audio.sfx.length > 0 ? (
        <SfxLayer
          cues={plan.audio.sfx}
          concatToFinal={concatToFinal}
          offsetFrames={introFrames}
        />
      ) : null}
    </AbsoluteFill>
  );
};
