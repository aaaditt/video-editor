# demotape — demo videos for the feature you just built

Primary job: record a demo by **driving the user's app**, auto-edit it, and
deliver it to the pull request. Secondary job (unchanged): auto-edit footage
the user recorded themselves. No web app — these pipelines ARE the product.

## Architecture

```
demos/<name>.demo.ts ──► record.ts ──► raw.webm + steps.json
                                            │
                          git context ──────┤
                                            ▼
                                      demodraft.ts ──► edit-plan.json
                                            │
   (footage path: analyze.ts → autodraft.ts)┤
                                            ▼
                              roughcut.ts (FFmpeg) ──► roughcut.mp4
                                            ▼
                          Polish composition (Remotion) ──► MP4
                                            ▼
                                        ship.ts ──► GIF + release + PR comment
```

- **edit-plan.json** is the single source of truth per job. Schema and timing
  semantics: `remotion/src/EditPlan.ts` (zod). Segments are in SOURCE seconds;
  overlays are in ROUGHCUT seconds (post-cut timeline).
- **steps.json** is the demo path's ground truth — every action with
  timestamps, click points and focus boxes. It replaces `analysis.json`, which
  the footage path derives by *inferring* structure from audio silence.

## The one-command demo

From `remotion/`:

```
npm run demo -- ../demos/<name>.demo.ts [--code] [--music] [--ship]
```

Runs record → draft → cut → render. Add `--ship` to post it to the PR.

Flags: `--job <name>`, `--url <override>`, `--viewport WxH`, `--headless`,
`--aspect 9:16|1:1`, `--no-render`, `--no-captions`, `--no-zooms`,
`--no-clicks`, `--no-title`.

Output: `remotion/out/<job>.mp4` plus `edit-plan.json`, `steps.json`,
`raw.webm` in `remotion/public/jobs/<job>/`.

## Writing a demo file

Demo files live in `demos/` and import from `../remotion/scripts/driver`:

- `demo({ url, viewport?, outroHold?, resetStorage? })` — once, at the top.
- `step(caption, async (page) => {...})` — one chapter. The caption sets the
  chapter's length (reading time) and is what appears on screen. **Write
  captions as the narration**: "Apply the new status filter", not "click".
- `smoothClick(locator)` / `smoothType(locator, text)` / `smoothHover(locator)`
  — glide the pointer, log the click, record the target for a zoom.
- `pause(ms)` — hold so a result lands before the next step.
- `focusRegion({x,y,width,height})` — mark a zoom target when no single element
  fits.

Prefer role- and text-based locators; they survive refactors better than CSS.
Set `resetStorage: true` when the app persists state that would make a second
run start where the first left off. Raise `outroHold` when using `--code`, so
there is idle footage for the card to sit over.

## The refine loop (after the draft)

Apply changes by EDITING `public/jobs/<job>/edit-plan.json` — never re-record
for a styling change:

1. Overlay/caption/audio change only: edit plan → re-render.
2. Timing/structure change (segments, speeds): edit plan →
   `npm run cut -- <job>` → re-render. Cutting shifts the rough-cut timeline,
   so overlay timestamps after the change shift too — re-run
   `npm run draft -- <job>` to regenerate them consistently.
3. Re-render: `npx remotion render Polish --props='{"job":"<job>"}' out/<job>.mp4`
4. Live preview: `npx remotion studio`, set the `job` prop.
5. Re-record only when the *flow* changes — then edit the demo file and re-run.

## Effects vocabulary (what edit-plan.json can express)

- **Demo-specific**: `clickRing` (ripple at a point), `codeCard` (diff lines,
  +/- coloured), `terminalCard` (command + output; not auto-generated — add it
  by hand when a demo should show a test run).
- **Overlays**: zoom, callout, titleCard, watermark, colorGrade, filmGrain,
  vignette, letterbox, lightLeak, kenBurns, shake, animatedText
  (typewriter/word-pop/slide-in, optional `backdrop` pill), progressBar.
- **Transitions** (`segments[].transitionAfter`): fade, slide, wipe, flip,
  clock-wipe, zoom-punch, whip-pan, glitch. Must stay well under both
  neighbouring segment durations.
- **Audio**: `audio.music` ({file, volume, ducking}) and `audio.sfx` cues.
  On the demo path there is no speech, so **ducking must be off**.
- **Output**: `output.aspect` "9:16"/"1:1" crops via FFmpeg.

## Things that will bite you

- **Sync offset.** Playwright's recorder attaches a few hundred ms after the
  clock starts, and the lag varies per run (-324ms and -535ms on two runs of
  the same demo). record.ts paints a magenta frame before step 1, finds it in
  the encoded video (`syncmarker.ts`), and stores the exact offset in
  steps.json. If `offsetSource` is `"fallback"` the flash was not found and
  cuts may be ~0.5s out — re-record.
- **Injected page scripts must not contain named inner functions.** esbuild's
  keepNames wraps them in a `__name()` helper that does not exist in the page,
  so the script throws silently. `installCursor` is written flat for this
  reason, and record.ts asserts the cursor exists so a regression is loud.
- **Init scripts run before the DOM exists** — `document.documentElement` is
  null at document-start.
- **Chapter text is `animatedText`, not `Captions`.** The Captions component
  pages via createTikTokStyleCaptions, which groups tokens within 1.5s and caps
  a page at 1.5s — correct for speech, wrong for one-sentence-per-chapter, and
  it merges across chapter boundaries.
- **Zoom scales by 1/region**, so small regions magnify hard. demodraft floors
  the region at 0.62 (~1.6x).
- **Click rings render inside the ZoomPan transform**, so they stay anchored
  when a zoom is active.
- **Frame-accurate verification**: seek with `-ss` AFTER `-i` (output seeking).
  Input seeking snaps to keyframes and will lie to you about webm timing.

## Version control

Remote: https://github.com/aaaditt/video-editor.git (branch `main`).
After any meaningful change — pipeline code, a job's edit-plan.json, or
playbook edits — commit and push without being asked. Media stays out of git
(see .gitignore); plans, steps and demo files are committed so every edit is
reproducible.

## Conventions

- Job folders: `remotion/public/jobs/<job>/` (media must live under public/ for
  `staticFile()`). Job names: lowercase letters, digits, dashes.
- Segments are re-encoded (libx264 crf 18) for frame accuracy; concat is
  stream-copy. Never stream-copy cuts from the source.
- Overlay times are rough-cut seconds. `computeTimeline().concatToFinal` in
  `EditPlan.ts` maps rough-cut → final; all components already use it.
- One intro and one outro title card max; zooms must not overlap.
- Recording profile: `.demotape/profile` (gitignored — holds real sessions).

## Footage mode (self-recorded video)

Unchanged: `npm run auto-edit -- ../input/<file>.mp4 --preset tech-demo`.
Presets `tech-demo`, `shorts`, `vlog`, `cinematic` live in `PRESETS` in
`autodraft.ts`, typed as `FootagePreset` — which deliberately excludes `demo`,
since recorded demos are drafted by `demodraft.ts` from ground truth instead.
Toggles: `--silence=cut|speedup|keep`, `--no-captions`, `--no-zooms`,
`--no-music`/`--music`, `--no-sfx`, `--no-transitions`, `--no-grade`,
`--no-transcript`, `--model medium.en`, `--name <job>`, `--no-render`,
`--re-analyze`. This path uses whisper.cpp for captions; the demo path does
not transcribe at all.

## Environment notes (Windows)

- FFmpeg via winget (`Gyan.FFmpeg`); `scripts/ffbin.ts` finds it under
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*\bin\`.
- Playwright uses installed Chrome (`channel: "chrome"`) — no browser download.
- whisper.cpp lives in `remotion/whisper.cpp/` (gitignored), footage path only.
- Long renders: run in the background and report progress.

## Troubleshooting

- **"cursor init script did not run"**: a named inner function crept into
  `installCursor` — see driver.ts.
- **Cuts land early/late**: check `offsetSource` in steps.json.
- **Step failed mid-record**: the selector moved; the error names the step.
- **calculateMetadata "Missing jobs/<job>/..."**: roughcut has not run.
- **Duration mismatch (non-zero exit)**: segment `end` beyond source duration,
  or the plan was edited without re-running the cut.
- **Code card skipped**: last chapter too short — raise `outroHold` and
  re-record.
- **GIF above 10MB**: ship.ts walks a quality ladder and links instead of
  inlining if even the lowest rung is too big; record a shorter demo.
