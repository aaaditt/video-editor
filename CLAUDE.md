# Video Editing Bay

This workspace turns raw footage into edited videos. The user drops an MP4 and
describes edits in plain English; Claude executes them with FFmpeg (structure)
and Remotion (polish). No web app — the pipeline below IS the product.

## Architecture

```
raw footage → edit-plan.json → roughcut.ts (FFmpeg) → Polish composition (Remotion) → final.mp4
```

- **edit-plan.json** is the single source of truth for a job. Schema + timing
  semantics: `remotion/src/EditPlan.ts` (zod). Segments are in SOURCE seconds;
  captions/overlays are in ROUGHCUT seconds (post-cut timeline).
- **FFmpeg** does cuts, trims, speed changes, concat (fast, frame-accurate).
- **Remotion** layers captions, zooms, callouts, title cards, watermarks,
  transitions on top of the rough cut.

## Per-job procedure

All commands run from `remotion/`. `<job>` is a short kebab-case name.

1. **Probe the footage** (user usually drops it in `input/`):
   `npx tsx scripts/probe.ts ../input/<file>.mp4`
   Report duration/resolution/fps/audio to the user before planning.

2. **Write the edit plan** at `remotion/public/jobs/<job>/edit-plan.json`.
   Translate the user's request into segments + overlays. Validate mentally
   against `EditPlan.ts`. `source` is relative to the repo root (e.g.
   `input/demo.mp4`). Media MUST live under `remotion/public/` so Remotion can
   load it via `staticFile()`.

3. **Rough cut**: `npx tsx scripts/roughcut.ts <job>`
   Produces `seg-*.mp4`, `roughcut.mp4`, `roughcut-probe.json` in the job
   folder. The script self-validates durations with ffprobe and exits non-zero
   on mismatch.

4. **Transcribe** (only if the plan uses captions):
   `npx tsx scripts/transcribe.ts <job>` (add `medium.en` as 2nd arg for
   higher accuracy; default `base.en`). First run downloads whisper.cpp +
   model into `remotion/whisper.cpp/` (~150MB for base.en).

5. **If FFmpeg-only job** (no captions/overlays/transitions): `roughcut.mp4`
   IS the deliverable — copy it to `final` naming and skip Remotion entirely.

6. **Preview** (when the user wants to review before rendering):
   `npx remotion studio` — select the `Polish` composition. Its props default
   to `job: "test-clip"`; change the `job` prop in the right panel (or edit
   `Root.tsx` defaultProps) to point at the current job.
   Quick sanity check without Studio:
   `npx remotion still Polish --props="{\"job\":\"<job>\"}" --frame=30 --scale=0.25 out/check.png`

7. **Render**:
   `npx remotion render Polish --props="{\"job\":\"<job>\"}" ../jobs-out/<job>-final.mp4`
   (or omit the output path — `defaultOutName` is `<job>-final`).
   Verify the result with `scripts/probe.ts` (duration/resolution as expected)
   before telling the user it's done.

## Version control

Remote: https://github.com/aaaditt/video-editor.git (branch `main`).
After any meaningful change — a new job's edit-plan.json, transcript, pipeline
code, or playbook edits — commit and push without being asked. Media files
stay out of git (see .gitignore); edit plans and captions are committed so
every edit is reproducible.

## Conventions

- Job folders: `remotion/public/jobs/<job>/`. Keep `edit-plan.json` and
  `captions.json` (committed); media files in job folders are gitignored.
- Never stream-copy cuts from the source — segments are re-encoded
  (libx264 crf 18) for frame accuracy; the concat step IS stream-copy.
- Overlay/caption times refer to the rough-cut timeline. When transitions are
  used the final timeline is shorter; `computeTimeline().concatToFinal` in
  `EditPlan.ts` handles the mapping — components already use it.
- One intro and one outro title card max; zooms must not overlap each other.

## Environment notes (Windows)

- FFmpeg was installed via winget (`Gyan.FFmpeg`). Shells inherited from an
  older process may not have it on PATH — `scripts/ffbin.ts` finds it inside
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin\`
  automatically. In PowerShell, refresh PATH from the registry if needed:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- Long renders: run `npx remotion render` in the background and report
  progress; a 10-min 1080p30 video renders in very roughly 5–15 min.

## Troubleshooting

- **calculateMetadata error "Missing jobs/<job>/..."**: the rough cut or probe
  file doesn't exist yet — run `roughcut.ts` first.
- **Segment/rough-cut duration mismatch (script exits 1)**: usually a segment
  `end` beyond source duration, or overlapping `-ss/-to` typos in the plan.
- **Whisper output empty**: check the rough cut actually has speech;
  `audio-16k.wav` in the job folder is what whisper heard.
- **Studio shows stale plan**: it caches fetches per props change — bump any
  prop or restart Studio after editing edit-plan.json.
