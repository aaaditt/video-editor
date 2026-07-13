# video-editor — an automatic AI editing bay

Drop in raw footage, get back an edited video: silences removed, word-timed
captions, smart zooms, transitions, color grades, music with auto-ducking,
sound effects — all driven by one declarative `edit-plan.json` per job.

Built as a **Claude-as-editor** workspace: an AI session (or a human) writes
the edit plan; deterministic tools execute it. FFmpeg handles structure
(frame-accurate cuts, speed ramps, aspect crops), [Remotion](https://remotion.dev)
renders the polish (captions, effects, animations) as React components.

## Quick start

Requirements: Node 18+, FFmpeg on PATH (Windows: `winget install Gyan.FFmpeg`).

```bash
cd remotion
npm install

# One-command automatic edit
npm run auto-edit -- path/to/footage.mp4 --preset tech-demo
```

Presets: `tech-demo` · `shorts` (9:16) · `vlog` · `cinematic` — every
behavior toggleable (`--no-music`, `--silence=cut|speedup|keep`, `--no-zooms`,
`--no-captions`, `--no-sfx`, `--no-transitions`, `--no-grade`).

The draft lands in `remotion/out/<job>-draft.mp4`. Refine by editing
`remotion/public/jobs/<job>/edit-plan.json` and re-rendering, or preview live
with `npx remotion studio`.

## How it works

```
footage → analyze (silence map · loudness · scenes · whisper transcript)
        → autodraft (analysis + preset recipe → edit-plan.json)
        → roughcut (FFmpeg: cuts, speed ramps, crop, concat)
        → Polish composition (Remotion: captions, zooms, transitions,
          grades, grain, light leaks, animated text, music ducking, SFX)
        → final MP4
```

Everything the editor can do is expressed in the zod schema at
`remotion/src/EditPlan.ts`. Transcription is local via whisper.cpp — no API
keys, no cloud. The full operating playbook is in [CLAUDE.md](CLAUDE.md).
