# demos/

One file per demo. Each describes a flow; `demotape` performs it against your
running app and records the result.

```bash
cd remotion
npm run demo -- ../demos/<name>.demo.ts
```

## Writing one

```ts
import { demo, step, smoothClick, pause } from "../remotion/scripts/driver";

demo({ url: "http://localhost:3000" });

step("Apply the new status filter", async (p) => {
  await smoothClick(p.getByRole("button", { name: "Filter" }));
  await smoothClick(p.getByText("In review"));
  await pause(600);
});
```

**Captions are narration, not instructions.** "Apply the new status filter"
reads well on screen; "click the filter button" describes the mechanics the
viewer can already see. The caption also sets the chapter's length — it runs
for as long as the text takes to read — so a fuller sentence buys more time on
screen than `pause()` does.

**Prefer role and text locators.** `getByRole("button", { name: "Filter" })`
survives a refactor that `#filter-btn-2` will not. A demo that breaks when the
UI changes is the point — it fails loudly the way a test does — but it should
break because the *flow* changed, not because a class name did.

## Options

`demo({ url, viewport?, outroHold?, resetStorage? })`

- `resetStorage: true` — clears cookies and storage before step 1. Recordings
  share one Chrome profile, so without it a second run starts where the first
  left off. Leave it off for a signed-in app, where that state is the login.
- `outroHold` — seconds to keep recording after the last step. Raise it when
  using `--code`, so the diff card has idle footage to sit over.

## Helpers

| | |
|---|---|
| `smoothClick(locator)` | glide the pointer, click, log it for a ring |
| `smoothType(locator, text)` | click, then type at a human cadence |
| `smoothHover(locator)` | glide without clicking; marks a zoom target |
| `pause(ms)` | hold so a result lands before the next step |
| `focusRegion({x,y,w,h})` | mark a zoom target when no single element fits |

Anything else on the Playwright `page` works too — the callback receives the
real page object.

## Files here

- `smoke.demo.ts` / `smoke-app.html` — a self-contained fixture that runs off
  `file://` with no server. Used to verify the pipeline end to end.
