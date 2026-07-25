/**
 * Record a demo by driving the app with Playwright.
 *
 * Usage (from remotion/):
 *   npx tsx scripts/record.ts ../demos/<name>.demo.ts
 *     [--job <name>] [--url <override>] [--viewport 1280x720] [--headless]
 *
 * Produces in public/jobs/<job>/:
 *   raw.webm    the recording (silent, viewport-sized)
 *   steps.json  every action with timestamps, click points and focus boxes
 *
 * steps.json is what demodraft.ts turns into an edit plan. Because the driver
 * logs ground truth, nothing downstream has to guess where the interesting
 * moments are.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  beginRun,
  beginStep,
  endStep,
  elapsed,
  getConfig,
  getSteps,
  installCursor,
  flashSyncMarker,
  CURSOR_ELEMENT_ID,
  SYNC_FLASH_MS,
  type StepLog,
} from "./driver";
import { probeFile } from "./ffbin";
import { findSyncFlash } from "./syncmarker";

const REMOTION_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(REMOTION_DIR, "..");
export const PROFILE_DIR = path.join(REPO_ROOT, ".demotape", "profile");

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
/**
 * Held before the sync flash. Also covers the recorder's attach lag, so the
 * flash is guaranteed to land inside the video.
 */
const LEAD_IN_MS = 1200;
/** Gap between the flash and the first step, so neither bleeds into the other. */
const SETTLE_AFTER_SYNC_MS = 400;
const DEFAULT_OUTRO_HOLD_S = 1.2;

export type StepsFile = {
  job: string;
  url: string;
  viewport: { width: number; height: number };
  recordedAt: string;
  /** Wall-clock length of the run, for cross-checking against the video. */
  wallClockMs: number;
  /** Actual probed duration of raw.webm, in seconds. */
  videoDurationSeconds: number;
  /**
   * Added to every step time to convert it to video time. Measured from the
   * sync flash; falls back to 0 if the flash could not be found.
   */
  offsetMs: number;
  /** How offsetMs was arrived at, so a bad cut is diagnosable. */
  offsetSource: "sync-marker" | "fallback";
  steps: StepLog[];
};

const parseViewport = (raw: string | null) => {
  if (!raw) return DEFAULT_VIEWPORT;
  const m = raw.match(/^(\d+)x(\d+)$/);
  if (!m) throw new Error(`Bad --viewport "${raw}" — expected WIDTHxHEIGHT.`);
  return { width: Number(m[1]), height: Number(m[2]) };
};

const jobNameFromDemoFile = (file: string): string =>
  path
    .basename(file)
    .replace(/\.demo\.tsx?$/, "")
    .replace(/\.tsx?$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const openContext = async (opts: {
  viewport: { width: number; height: number };
  headless: boolean;
  videoDir?: string;
}): Promise<{ context: BrowserContext; page: Page }> => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: opts.headless,
    viewport: opts.viewport,
    args: [
      `--window-size=${opts.viewport.width},${opts.viewport.height + 120}`,
      "--hide-crash-restore-bubble",
      "--disable-features=Translate,MediaRouter",
    ],
    ...(opts.videoDir
      ? { recordVideo: { dir: opts.videoDir, size: opts.viewport } }
      : {}),
  });

  await context.addInitScript(installCursor);
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
};

const main = async () => {
  const args = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };

  const valuePositions = ["--job", "--url", "--viewport"]
    .map((f) => args.indexOf(f) + 1)
    .filter((i) => i > 0);
  const demoFile = args.find(
    (a, i) => !a.startsWith("--") && !valuePositions.includes(i),
  );
  if (!demoFile) {
    console.error(
      "Usage: npx tsx scripts/record.ts <demo-file> [--job <name>] " +
        "[--url <override>] [--viewport 1280x720] [--headless]",
    );
    process.exit(1);
  }

  const demoAbs = path.isAbsolute(demoFile)
    ? demoFile
    : path.resolve(process.cwd(), demoFile);
  if (!fs.existsSync(demoAbs)) {
    console.error(`Demo file not found: ${demoAbs}`);
    process.exit(1);
  }

  // Importing the demo file runs its demo()/step() calls, which only register.
  await import(pathToFileURL(demoAbs).href);
  const config = getConfig();
  const steps = getSteps();
  if (steps.length === 0) {
    console.error(`${path.basename(demoAbs)} registered no step() calls.`);
    process.exit(1);
  }

  const job = flag("--job") ?? jobNameFromDemoFile(demoAbs);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(job)) {
    console.error(`Invalid job name "${job}" — lowercase, digits, dashes.`);
    process.exit(1);
  }

  const url = flag("--url") ?? config.url;
  const viewport = parseViewport(flag("--viewport")) ?? config.viewport;
  const headless = args.includes("--headless");

  const jobDir = path.join(REMOTION_DIR, "public", "jobs", job);
  const videoDir = path.join(jobDir, "_video");
  fs.mkdirSync(videoDir, { recursive: true });

  console.log(
    `\n=== demotape record: ${path.basename(demoAbs)} → job "${job}" ===\n` +
      `    ${url} at ${viewport.width}x${viewport.height}, ` +
      `${steps.length} step(s)\n`,
  );

  const { context, page } = await openContext({
    viewport,
    headless,
    videoDir,
  });

  // Video capture begins with the page, so this is frame zero.
  const videoStartedAt = Date.now();
  beginRun(page, videoStartedAt, viewport);

  const logs: StepLog[] = [];
  let failure: { step: string; error: unknown } | null = null;
  let syncStepMs: number | null = null;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    if (config.resetStorage) {
      await context.clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    // Park the pointer somewhere neutral for the opening frame. This also
    // materialises the injected cursor, which is created on first move.
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.72, {
      steps: 4,
    });

    // That cursor is serialized into the page, where a transpiler helper
    // leaking into the source (or a DOM call running too early) makes it throw
    // silently — yielding a recording with no visible pointer and no error.
    // Fail loudly instead.
    const cursorInstalled = await page.evaluate(
      (id) => Boolean(document.getElementById(id)),
      CURSOR_ELEMENT_ID,
    );
    if (!cursorInstalled) {
      throw new Error(
        "The cursor init script did not run in the page, so the recording " +
          "would show clicks with no pointer. This usually means a named " +
          "inner function crept into installCursor() — see the note in " +
          "driver.ts.",
      );
    }

    // Calibration flash — see syncmarker.ts. It has to come *after* the
    // lead-in: the recorder attaches a few hundred ms late, so a flash fired
    // straight after goto lands before the first video frame and is never
    // seen. Still ahead of step 1, so it is always outside the cut.
    await page.waitForTimeout(LEAD_IN_MS);
    syncStepMs = elapsed();
    await page.evaluate(flashSyncMarker, SYNC_FLASH_MS);
    await page.waitForTimeout(SETTLE_AFTER_SYNC_MS);

    for (const [index, s] of steps.entries()) {
      console.log(`  ${index + 1}. ${s.caption}`);
      const log = beginStep(index, s.caption);
      try {
        await s.fn(page);
      } finally {
        endStep(log);
        logs.push(log);
      }
    }

    const hold = (config.outroHold ?? DEFAULT_OUTRO_HOLD_S) * 1000;
    await page.waitForTimeout(hold);
  } catch (err) {
    const failed = steps[logs.length - 1] ?? steps[0];
    failure = { step: failed?.caption ?? "(before first step)", error: err };
  }

  const wallClockMs = Date.now() - videoStartedAt;

  // Resolve the on-disk path while the browser is still up. saveAs() would go
  // over the same connection that closing a *persistent* context tears down,
  // so copy the file ourselves once close() has finalized it.
  const video = page.video();
  const tempPath = video ? await video.path() : null;
  await context.close(); // flushes and finalizes the webm

  const rawPath = path.join(jobDir, "raw.webm");
  if (tempPath && fs.existsSync(tempPath)) {
    fs.copyFileSync(tempPath, rawPath);
  }
  fs.rmSync(videoDir, { recursive: true, force: true });

  if (failure) {
    console.error(
      `\n✗ Step failed: "${failure.step}"\n` +
        `  ${failure.error instanceof Error ? failure.error.message : failure.error}\n` +
        `  The selector probably moved. Fix it in ${path.basename(demoAbs)} and re-run.`,
    );
    process.exit(1);
  }

  if (!fs.existsSync(rawPath)) {
    console.error("Recording finished but no video file was produced.");
    process.exit(1);
  }

  const probe = probeFile(rawPath);

  // Video time and step time start out offset by however long the recorder
  // took to attach, which varies per run — so measure it rather than assume.
  const syncVideoSeconds = findSyncFlash(rawPath);
  const measured =
    syncVideoSeconds !== null && syncStepMs !== null
      ? Math.round(syncVideoSeconds * 1000 - syncStepMs)
      : null;

  const stepsFile: StepsFile = {
    job,
    url,
    viewport,
    recordedAt: new Date().toISOString(),
    wallClockMs,
    videoDurationSeconds: probe.durationInSeconds,
    offsetMs: measured ?? 0,
    offsetSource: measured !== null ? "sync-marker" : "fallback",
    steps: logs,
  };
  fs.writeFileSync(
    path.join(jobDir, "steps.json"),
    JSON.stringify(stepsFile, null, 2),
  );

  console.log(
    `\n✓ Recorded ${probe.durationInSeconds.toFixed(2)}s ` +
      `(${probe.width}x${probe.height}) → public/jobs/${job}/raw.webm\n` +
      `  ${logs.length} step(s) logged → steps.json`,
  );
  if (measured === null) {
    console.warn(
      `  ! Sync marker not found — falling back to offset 0. Cuts may land\n` +
        `    up to ~0.5s early or late. Re-record, or set offsetMs in\n` +
        `    steps.json by hand if it persists.`,
    );
  } else {
    console.log(
      `  Sync offset ${measured >= 0 ? "+" : ""}${measured}ms (flash at ` +
        `${syncVideoSeconds!.toFixed(3)}s of video)`,
    );
  }
  console.log(`\n  Next: npx tsx scripts/demodraft.ts ${job}`);
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
