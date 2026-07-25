# demotape

Record a demo of the feature you just built, without recording anything.

You describe the flow; Playwright performs it against your real app while
recording; the pipeline cuts it, captions it, marks the clicks, and composes in
your diff; one command posts it to the pull request.

The demo lives next to your feature **as code**, so when the UI changes you
re-run it instead of re-recording it.

```bash
cd remotion
npm install
npm run demo -- ../demos/new-filter.demo.ts --code --ship
```

## A demo file

```ts
import { demo, step, smoothClick, pause } from "../remotion/scripts/driver";

demo({ url: "http://localhost:3000" });

step("Open the projects board", async (p) => {
  await smoothClick(p.getByRole("link", { name: "Projects" }));
});

step("Apply the new status filter", async (p) => {
  await smoothClick(p.getByRole("button", { name: "Filter" }));
  await smoothClick(p.getByText("In review"));
  await pause(600);
});

step("And it survives a reload", async (p) => {
  await p.reload();
});
```

Each `step` caption becomes a chapter: it sets how long that chapter runs and
appears on screen as the caption. `smoothClick` glides the pointer rather than
teleporting it, and records where it clicked so a ring can be drawn there.

## How it works

```
demos/<name>.demo.ts
      │
      ▼
  record      Playwright drives your app and records it
      │       → raw.webm + steps.json
      ▼
  draft       steps.json + git context → edit-plan.json
      │
      ▼
  cut         FFmpeg: chapter cuts, speed ramps, concat
      │
      ▼
  render      Remotion: captions, click rings, zooms, code card
      │
      ▼
  ship        GIF + MP4 → GitHub release → PR comment
```

`steps.json` is the heart of it. Editing raw footage means *inferring*
structure — measuring audio silence to guess where something happened. Driving
the app means we know: every action, its timestamp, what it targeted. So cuts
land on actions, captions are written before they are needed, and click rings
sit exactly where the pointer was.

With no voice track, nothing dictates how long a chapter should run — so each
is sized by how long its caption takes to **read**, and the footage is
speed-ramped to fit. The video bends to the text.

## Commands

| | |
|---|---|
| `npm run demo -- <file>` | the whole pipeline |
| `npm run record -- <file>` | record only |
| `npm run draft -- <job>` | re-draft the plan from an existing recording |
| `npm run cut -- <job>` | re-cut after editing the plan |
| `npm run ship -- <job>` | GIF + release + PR comment |
| `npm run login -- <url>` | sign in once, for demos that need auth |
| `npx remotion studio` | live preview; set the `job` prop |

Options: `--code` (diff card), `--music`, `--aspect 9:16`, `--headless`,
`--viewport WxH`, `--url`, `--job`, `--ship`, `--no-render`, and
`--no-captions` / `--no-zooms` / `--no-clicks` / `--no-title`.

## Refining

The draft is a starting point. `public/jobs/<job>/edit-plan.json` is the single
source of truth — edit it and re-render, no re-recording:

```bash
npx remotion render Polish --props='{"job":"<job>"}' out/<job>.mp4
```

If you change the segments, re-run `npm run cut -- <job>` first: cutting
changes the timeline that every overlay timestamp refers to.

## Signed-in apps

Recordings run in a dedicated Chrome profile at `.demotape/profile`, not your
everyday one — Chrome holds an exclusive lock on a profile while it is running,
so Playwright could never open yours. Sign in once and it persists:

```bash
npm run login -- http://localhost:3000/login
```

## Editing footage you recorded yourself

The original footage pipeline is still here: `npm run auto-edit -- <file>.mp4
--preset tech-demo`, with presets `tech-demo`, `shorts`, `vlog`, `cinematic`.
That path infers structure from audio — silence removal and whisper captions,
all local. See [CLAUDE.md](CLAUDE.md).

## Requirements

Node 18+, FFmpeg on PATH (`winget install Gyan.FFmpeg`), Chrome, and `gh`
authenticated if you want `ship`. Playwright drives your installed Chrome via
`channel: "chrome"`, so there is no browser download.
