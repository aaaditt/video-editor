import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import type { Caption } from "@remotion/captions";
import {
  computeTimeline,
  editPlanSchema,
  type CalloutOverlay,
  type EditPlan,
  type TitleCard as TitleCardType,
  type Watermark as WatermarkType,
  type ZoomOverlay,
} from "./EditPlan";
import { Captions } from "./library/Captions";
import { Callout } from "./library/Callout";
import { MainVideo } from "./library/MainVideo";
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

export const Polish: React.FC<PolishProps> = ({ plan, captions }) => {
  if (!plan) {
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

  const timeline = computeTimeline(plan);
  const { fps, introFrames, mainFrames, outroFrames, concatToFinal } = timeline;

  const intro = plan.overlays.find(
    (o): o is TitleCardType => o.type === "titleCard" && o.position === "intro",
  );
  const outro = plan.overlays.find(
    (o): o is TitleCardType => o.type === "titleCard" && o.position === "outro",
  );
  const zooms = plan.overlays.filter(
    (o): o is ZoomOverlay => o.type === "zoom",
  );
  const callouts = plan.overlays.filter(
    (o): o is CalloutOverlay => o.type === "callout",
  );
  const watermark = plan.overlays.find(
    (o): o is WatermarkType => o.type === "watermark",
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black", fontFamily: FONT_STACK }}>
      {intro ? (
        <Sequence durationInFrames={introFrames}>
          <TitleCard card={intro} durationInFrames={introFrames} />
        </Sequence>
      ) : null}

      <Sequence from={introFrames} durationInFrames={mainFrames}>
        <ZoomPan zooms={zooms} concatToFinal={concatToFinal}>
          <MainVideo plan={plan} />
        </ZoomPan>

        {plan.captions && captions ? (
          <Captions
            captions={captions}
            style={plan.captions.style}
            concatToFinal={concatToFinal}
          />
        ) : null}

        {callouts.map((callout, i) => {
          const startFrame = Math.round(concatToFinal(callout.from) * fps);
          const durationInFrames = Math.round(
            (concatToFinal(callout.to) - concatToFinal(callout.from)) * fps,
          );
          if (durationInFrames <= 0) return null;
          return (
            <Sequence key={i} from={startFrame} durationInFrames={durationInFrames}>
              <Callout callout={callout} durationInFrames={durationInFrames} />
            </Sequence>
          );
        })}
      </Sequence>

      {outro ? (
        <Sequence from={introFrames + mainFrames} durationInFrames={outroFrames}>
          <TitleCard card={outro} durationInFrames={outroFrames} />
        </Sequence>
      ) : null}

      {watermark ? <Watermark watermark={watermark} /> : null}
    </AbsoluteFill>
  );
};
