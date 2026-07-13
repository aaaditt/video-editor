# Video Editing Bay — Auto-Edit Machine

This workspace turns raw footage into edited videos. The user drops a video
and describes what they want (or just picks a preset); Claude runs the
pipeline and refines the result conversationally. No web app — this pipeline
IS the product.

## Architecture

```
                    ┌─ auto path ──────────────────────────────┐
raw footage → analyze.ts → autodraft.ts ─→ edit-plan.json
                    └──────────────────────────┘        │
              (manual path: Claude writes the plan) ────┤
                                                        ▼
                              roughcut.ts (FFmpeg) → Polish composition (Remotion) → MP4
```

- **edit-plan.json** is the single source of truth for a job. Schema + timing
  semantics: `remotion/src/EditPlan.ts` (zod). Segments are in SOURCE seconds;
  captions/overlays/sfx are in ROUGHCUT seconds (post-cut timeline).
- **FFmpeg** does cuts, trims, speed changes, aspect crops, concat.
- **Remotion** layers captions, zooms, callouts, title cards, transitions,
  color grades, film grain, light leaks, animated text, music, SFX.

## The one-command auto edit

From `remotion/`:

```
npm run auto-edit -- ../input/<file>.mp4 --preset tech-demo
```

Presets: `tech-demo` (speed-ramps dead air, clean captions, smart zooms,
progress bar), `shorts` (9:16 crop, bold-word captions, zoom-punch cuts, hook
text), `vlog` (jump-cuts silences, warm grade, music bed), `cinematic` (keeps
pacing, fades, warm grade + letterbox + grain + vignette, Ken Burns).

Every behavior is toggleable: `--silence=cut|speedup|keep`, `--no-captions`,
`--no-zooms`, `--no-music` / `--music`, `--no-sfx`, `--no-transitions`,
`--no-grade`, `--no-transcript`, `--model medium.en`, `--name <job>`,
`--no-render`, `--re-analyze`. Preset defaults live in `PRESETS` in
`remotion/scripts/autodraft.ts`.

Output: `remotion/out/<job>-draft.mp4` plus `edit-plan.json`, `recipe.json`,
`captions.json`, `analysis.json` in `remotion/public/jobs/<job>/`.

## The refine loop (after the draft)

The user watches the draft and asks for changes. Apply them by EDITING
`public/jobs/<job>/edit-plan.json` — never re-run analysis:

1. Timing/structure change (segments, speeds, transitions between segments):
   edit plan → `npx tsx scripts/roughcut.ts <job>` → re-render.
   NOTE: cutting segments changes the rough-cut timeline — caption/overlay
   timestamps after the change shift too. Regenerate captions by re-running
   `npx tsx scripts/autodraft.ts <job> --preset <preset>` (reuses
   analysis.json) if segments changed, or adjust overlay times manually.
2. Overlay/caption-style/audio change only: edit plan → re-render directly.
3. Re-render: `npx remotion render Polish --props="{\"job\":\"<job>\"}" out/<job>-draft.mp4`
4. Live preview: `npx remotion studio`, set the `job` prop to the job name.

## Manual mode (no auto-draft)

Claude can still hand-write a plan for precise requests: probe with
`npx tsx scripts/probe.ts <file>`, write `edit-plan.json`, run roughcut,
(optionally `npx tsx scripts/transcribe.ts <job>` for captions), render.

## Effects vocabulary (what edit-plan.json can express)

- **Transitions** (`segments[].transitionAfter`): fade, slide, wipe, flip,
  clock-wipe, zoom-punch, whip-pan, glitch. Duration must stay well under
  both neighboring segment durations (autodraft enforces ≤ 45%).
- **Overlays**: zoom (punch-in on a region), callout (box/label), titleCard
  (intro/outro), watermark, colorGrade (warm/cold/noir/vibrant), filmGrain,
  vignette, letterbox, lightLeak, kenBurns, shake, animatedText
  (typewriter/word-pop/slide-in), progressBar.
- **Audio**: `audio.music` ({file, volume, ducking}) — ducks under speech
  automatically using caption timings; `audio.sfx` cues (whoosh/whip/pop/
  click/ding presets in `public/assets/sfx/`, or any file under public/).
- **Output**: `output.aspect` "9:16"/"1:1" crops via FFmpeg (cropFocus 0..1
  steers the window horizontally); width/height/fps overrides.

## Version control

Remote: https://github.com/aaaditt/video-editor.git (branch `main`).
After any meaningful change — a new job's edit-plan.json, pipeline code, or
playbook edits — commit and push without being asked. Media files stay out
of git (see .gitignore); edit plans, recipes, and captions are committed so
every edit is reproducible.

## Conventions

- Job folders: `remotion/public/jobs/<job>/` (media must be under public/
  for `staticFile()`). Job names: lowercase letters, digits, dashes.
- Segments are re-encoded (libx264 crf 18) for frame accuracy; the concat
  step is stream-copy. Never stream-copy cuts from the source.
- Overlay/caption/sfx times are rough-cut seconds. Transitions shorten the
  final timeline; `computeTimeline().concatToFinal` in `EditPlan.ts` maps
  rough-cut → final time and all components already use it.
- One intro and one outro title card max; zooms must not overlap each other.
- Music: user drops files into `remotion/public/assets/music/` (gitignored).
  Autodraft picks the first file alphabetically when music is on.

## Environment notes (Windows)

- FFmpeg installed via winget (`Gyan.FFmpeg`). Shells inherited from an older
  process may not have it on PATH — `scripts/ffbin.ts` finds it inside
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin\`
  automatically.
- whisper.cpp + models live in `remotion/whisper.cpp/` (gitignored),
  installed on first use. Default model `base.en`; `medium.en` for accuracy.
- Long renders: run in the background and report progress.

## Troubleshooting

- **calculateMetadata "Missing jobs/<job>/..."**: roughcut hasn't run, or
  plan.captions points at a missing captions.json.
- **Duration mismatch (script exits non-zero)**: segment `end` beyond source
  duration, or plan edited without re-running roughcut.
- **Transition error from Remotion**: transition longer than a neighboring
  segment — shorten it or remove it.
- **Empty transcript / no captions in draft**: footage has no speech, or
  audio too quiet; check `analysis.json` silences/loudness.
- **Studio shows stale plan**: bump any prop or restart Studio.
