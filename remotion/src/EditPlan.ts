import { z } from "zod";

/**
 * The edit-plan.json contract. One file per job at public/jobs/<job>/edit-plan.json.
 *
 * Timing semantics:
 * - `segments[].start/end` are in SOURCE video seconds (the original footage).
 * - Everything else (`overlays`, captions) is in ROUGHCUT seconds — the timeline
 *   that exists after cuts and speed changes have been applied by roughcut.ts.
 *   This is the timeline of public/jobs/<job>/roughcut.mp4, which is also the
 *   file that gets transcribed, so caption timestamps line up automatically.
 * - Title cards are prepended/appended around the rough cut; components shift
 *   all rough-cut-relative timings by the intro duration internally.
 */

export const regionSchema = z.object({
  // Normalized 0..1 coordinates relative to the frame (x,y = top-left corner)
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export const transitionSchema = z.object({
  type: z.enum(["fade", "slide", "wipe"]),
  durationInSeconds: z.number().positive().max(3).default(0.5),
});

export const segmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  speed: z.number().positive().max(10).default(1),
  // Transition into the NEXT segment. Ignored on the last segment.
  transitionAfter: transitionSchema.optional(),
});

export const zoomOverlaySchema = z.object({
  type: z.literal("zoom"),
  from: z.number().min(0),
  to: z.number().positive(),
  region: regionSchema,
  easeInSeconds: z.number().positive().max(2).default(0.5),
});

export const calloutOverlaySchema = z.object({
  type: z.literal("callout"),
  from: z.number().min(0),
  to: z.number().positive(),
  variant: z.enum(["box", "label"]).default("label"),
  // Anchor point (label) or top-left corner (box), normalized 0..1
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  // Only used by "box": size of the highlighted rectangle
  width: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
  text: z.string().default(""),
});

export const titleCardSchema = z.object({
  type: z.literal("titleCard"),
  position: z.enum(["intro", "outro"]),
  durationInSeconds: z.number().positive().max(15).default(3),
  title: z.string(),
  subtitle: z.string().optional(),
});

export const watermarkSchema = z.object({
  type: z.literal("watermark"),
  text: z.string(),
  corner: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
    .default("bottom-right"),
  opacity: z.number().min(0).max(1).default(0.5),
});

export const overlaySchema = z.discriminatedUnion("type", [
  zoomOverlaySchema,
  calloutOverlaySchema,
  titleCardSchema,
  watermarkSchema,
]);

export const captionsSchema = z.object({
  style: z.enum(["clean", "bold-word", "lower-third"]).default("clean"),
  // Relative to the job folder; produced by transcribe.ts
  transcriptFile: z.string().default("captions.json"),
});

export const editPlanSchema = z.object({
  job: z.string().min(1),
  // Path to the original footage (absolute, or relative to the repo root).
  // Informational for Remotion; roughcut.ts reads it to do the cutting.
  source: z.string().min(1),
  output: z
    .object({
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().positive().default(30),
    })
    .default({ fps: 30 }),
  segments: z.array(segmentSchema).min(1),
  captions: captionsSchema.optional(),
  overlays: z.array(overlaySchema).default([]),
});

export type Region = z.infer<typeof regionSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type ZoomOverlay = z.infer<typeof zoomOverlaySchema>;
export type CalloutOverlay = z.infer<typeof calloutOverlaySchema>;
export type TitleCard = z.infer<typeof titleCardSchema>;
export type Watermark = z.infer<typeof watermarkSchema>;
export type Overlay = z.infer<typeof overlaySchema>;
export type EditPlan = z.infer<typeof editPlanSchema>;

/** Duration of one segment on the rough-cut timeline, in seconds. */
export const segmentDuration = (seg: Segment): number =>
  (seg.end - seg.start) / seg.speed;

/** Total rough-cut duration (concatenated segments), in seconds. */
export const roughcutDuration = (plan: EditPlan): number =>
  plan.segments.reduce((sum, seg) => sum + segmentDuration(seg), 0);

/**
 * Derived frame layout of the final composition.
 *
 * When transitions are used, adjacent segments overlap, so the main video
 * part is shorter than the rough cut. `concatToFinal` maps a rough-cut
 * timestamp to the final main-video timeline (both in seconds) so captions
 * and overlays stay aligned.
 */
export type Timeline = {
  fps: number;
  introFrames: number;
  mainFrames: number;
  outroFrames: number;
  totalFrames: number;
  concatToFinal: (roughcutSeconds: number) => number;
};

export const computeTimeline = (plan: EditPlan): Timeline => {
  const fps = plan.output.fps;

  const intro = plan.overlays.find(
    (o): o is TitleCard => o.type === "titleCard" && o.position === "intro",
  );
  const outro = plan.overlays.find(
    (o): o is TitleCard => o.type === "titleCard" && o.position === "outro",
  );
  const introFrames = intro ? Math.round(intro.durationInSeconds * fps) : 0;
  const outroFrames = outro ? Math.round(outro.durationInSeconds * fps) : 0;

  // Rough-cut second at which each segment ends, and the transition applied there
  const boundaries: { atSeconds: number; overlapSeconds: number }[] = [];
  let cursor = 0;
  plan.segments.forEach((seg, i) => {
    cursor += segmentDuration(seg);
    const isLast = i === plan.segments.length - 1;
    if (!isLast && seg.transitionAfter) {
      boundaries.push({
        atSeconds: cursor,
        overlapSeconds: seg.transitionAfter.durationInSeconds,
      });
    }
  });

  const totalOverlap = boundaries.reduce((s, b) => s + b.overlapSeconds, 0);
  const mainFrames = Math.round((cursor - totalOverlap) * fps);

  const concatToFinal = (t: number): number => {
    let shift = 0;
    for (const b of boundaries) {
      if (t >= b.atSeconds) shift += b.overlapSeconds;
    }
    return t - shift;
  };

  return {
    fps,
    introFrames,
    mainFrames,
    outroFrames,
    totalFrames: introFrames + mainFrames + outroFrames,
    concatToFinal,
  };
};
