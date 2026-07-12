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
  type: z.enum([
    "fade",
    "slide",
    "wipe",
    "flip",
    "clock-wipe",
    "zoom-punch",
    "whip-pan",
    "glitch",
  ]),
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

export const colorGradeSchema = z.object({
  type: z.literal("colorGrade"),
  look: z.enum(["warm", "cold", "noir", "vibrant"]),
  // Omit from/to to grade the entire main video
  from: z.number().min(0).optional(),
  to: z.number().positive().optional(),
});

export const filmGrainSchema = z.object({
  type: z.literal("filmGrain"),
  intensity: z.number().min(0).max(1).default(0.25),
});

export const vignetteSchema = z.object({
  type: z.literal("vignette"),
  intensity: z.number().min(0).max(1).default(0.5),
});

export const letterboxSchema = z.object({
  type: z.literal("letterbox"),
  // Height of each bar as a fraction of frame height
  size: z.number().min(0).max(0.25).default(0.12),
});

export const lightLeakSchema = z.object({
  type: z.literal("lightLeak"),
  from: z.number().min(0),
  to: z.number().positive(),
  seed: z.number().int().default(0),
  hueShift: z.number().min(0).max(360).default(0),
});

export const kenBurnsSchema = z.object({
  type: z.literal("kenBurns"),
  from: z.number().min(0),
  to: z.number().positive(),
  // Slow drift: zoom in or out over the range
  direction: z.enum(["in", "out"]).default("in"),
  strength: z.number().min(0.02).max(0.3).default(0.08),
});

export const shakeSchema = z.object({
  type: z.literal("shake"),
  at: z.number().min(0),
  durationInSeconds: z.number().positive().max(2).default(0.5),
  intensity: z.number().min(0).max(1).default(0.5),
});

export const animatedTextSchema = z.object({
  type: z.literal("animatedText"),
  from: z.number().min(0),
  to: z.number().positive(),
  text: z.string().min(1),
  animation: z.enum(["typewriter", "word-pop", "slide-in"]).default("word-pop"),
  position: z.enum(["top", "center", "bottom"]).default("center"),
});

export const progressBarSchema = z.object({
  type: z.literal("progressBar"),
  color: z.string().default("#FFD230"),
});

export const overlaySchema = z.discriminatedUnion("type", [
  zoomOverlaySchema,
  calloutOverlaySchema,
  titleCardSchema,
  watermarkSchema,
  colorGradeSchema,
  filmGrainSchema,
  vignetteSchema,
  letterboxSchema,
  lightLeakSchema,
  kenBurnsSchema,
  shakeSchema,
  animatedTextSchema,
  progressBarSchema,
]);

export const sfxPresets = [
  "whoosh",
  "whip",
  "pop",
  "click",
  "ding",
] as const;

export const sfxCueSchema = z.object({
  // Either a bundled preset (public/assets/sfx/<preset>.wav) or a file
  // relative to public/
  preset: z.enum(sfxPresets).optional(),
  file: z.string().optional(),
  // Rough-cut seconds
  at: z.number().min(0),
  volume: z.number().min(0).max(1).default(0.7),
});

export const audioSchema = z.object({
  music: z
    .object({
      // Relative to public/ (e.g. "assets/music/track.mp3")
      file: z.string().min(1),
      volume: z.number().min(0).max(1).default(0.18),
      // Dip under speech (uses caption word timings)
      ducking: z.boolean().default(true),
    })
    .optional(),
  sfx: z.array(sfxCueSchema).default([]),
});

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
      // Crop applied by roughcut.ts. "source" keeps original dimensions.
      aspect: z.enum(["source", "9:16", "1:1"]).default("source"),
      // Horizontal center of the crop window, 0..1 (0.5 = center crop)
      cropFocus: z.number().min(0).max(1).default(0.5),
    })
    .default({ fps: 30, aspect: "source", cropFocus: 0.5 }),
  segments: z.array(segmentSchema).min(1),
  captions: captionsSchema.optional(),
  overlays: z.array(overlaySchema).default([]),
  audio: audioSchema.default({ sfx: [] }),
});

/**
 * A recipe drives autodraft.ts: preset defaults + individual toggles.
 * Stored as recipe.json next to the generated edit-plan.json.
 */
export const recipeSchema = z.object({
  preset: z.enum(["tech-demo", "shorts", "vlog", "cinematic"]),
  // How to treat detected dead air
  silence: z.enum(["cut", "speedup", "keep"]).default("cut"),
  captions: z.boolean().default(true),
  zooms: z.boolean().default(true),
  music: z.boolean().default(true),
  sfx: z.boolean().default(true),
  transitions: z.boolean().default(true),
  grade: z.boolean().default(true),
});

export type Region = z.infer<typeof regionSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type Transition = z.infer<typeof transitionSchema>;
export type ZoomOverlay = z.infer<typeof zoomOverlaySchema>;
export type CalloutOverlay = z.infer<typeof calloutOverlaySchema>;
export type TitleCard = z.infer<typeof titleCardSchema>;
export type Watermark = z.infer<typeof watermarkSchema>;
export type ColorGrade = z.infer<typeof colorGradeSchema>;
export type FilmGrain = z.infer<typeof filmGrainSchema>;
export type Vignette = z.infer<typeof vignetteSchema>;
export type Letterbox = z.infer<typeof letterboxSchema>;
export type LightLeakOverlay = z.infer<typeof lightLeakSchema>;
export type KenBurns = z.infer<typeof kenBurnsSchema>;
export type Shake = z.infer<typeof shakeSchema>;
export type AnimatedText = z.infer<typeof animatedTextSchema>;
export type ProgressBar = z.infer<typeof progressBarSchema>;
export type SfxCue = z.infer<typeof sfxCueSchema>;
export type AudioBlock = z.infer<typeof audioSchema>;
export type Overlay = z.infer<typeof overlaySchema>;
export type EditPlan = z.infer<typeof editPlanSchema>;
export type Recipe = z.infer<typeof recipeSchema>;

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
