/**
 * Smoke demo — records against a local fixture page, no network or server.
 * Doubles as the worked example of what a demo file looks like.
 *
 *   cd remotion && npx tsx scripts/record.ts ../demos/smoke.demo.ts
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  demo,
  step,
  smoothClick,
  pause,
} from "../remotion/scripts/driver";

demo({
  url: pathToFileURL(path.join(__dirname, "smoke-app.html")).href,
  viewport: { width: 1280, height: 720 },
  outroHold: 1.5,
  // The fixture persists the filter to localStorage, and recordings share one
  // Chrome profile — without this, run 2 starts where run 1 left off.
  resetStorage: true,
});

step("Open the projects board", async () => {
  await pause(600);
});

step("Apply the new status filter", async (p) => {
  await smoothClick(p.locator("#filter"));
  await pause(400);
  await smoothClick(p.locator('#menu button[data-status="review"]'));
  await pause(700);
});

step("Only in-review work is listed now", async (p) => {
  await smoothClick(p.locator("#pill"));
  await pause(700);
});

step("And the filter survives a reload", async (p) => {
  await p.reload({ waitUntil: "domcontentloaded" });
  await pause(1200);
});
