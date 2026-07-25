/**
 * The API a `demos/<name>.demo.ts` file is written against.
 *
 *   import { demo, step, smoothClick, smoothType, pause } from "../remotion/scripts/driver";
 *
 *   demo({ url: "http://localhost:3000" });
 *
 *   step("Open the projects board", async (p) => {
 *     await smoothClick(p.getByRole("link", { name: "Projects" }));
 *   });
 *
 * A demo file only *registers* its steps at import time; record.ts imports the
 * file, then drives them against a live page. That split is what lets the same
 * file be re-run whenever the UI changes.
 *
 * Everything here writes into steps.json, which is the demo-native replacement
 * for analysis.json: instead of inferring structure from audio silence, we log
 * exactly when each action happened and what it targeted.
 */
import type { Locator, Page } from "playwright";

export type ClickLog = {
  /** ms since the first video frame */
  t: number;
  /** normalized 0..1 viewport coordinates */
  x: number;
  y: number;
};

export type FocusBox = { x: number; y: number; width: number; height: number };

export type StepLog = {
  index: number;
  caption: string;
  /** ms since the first video frame */
  tStart: number;
  tEnd: number;
  clicks: ClickLog[];
  /** Normalized bounding box of the last element this step touched. */
  focus?: FocusBox;
};

export type DemoConfig = {
  url: string;
  viewport?: { width: number; height: number };
  /** Seconds to hold on the final frame before recording stops. */
  outroHold?: number;
  /**
   * Clear cookies and local/session storage before the first step.
   *
   * Recordings share one Chrome profile, so without this a demo inherits
   * whatever state the previous run left behind and stops being reproducible.
   * Off by default: for a signed-in app, that state IS the login.
   */
  resetStorage?: boolean;
};

export type RegisteredStep = {
  caption: string;
  fn: (page: Page) => Promise<void>;
};

// --- Registry (populated at import time by the demo file) -------------------

let config: DemoConfig | null = null;
const registered: RegisteredStep[] = [];

export const demo = (cfg: DemoConfig): void => {
  config = cfg;
};

export const step = (
  caption: string,
  fn: (page: Page) => Promise<void>,
): void => {
  registered.push({ caption, fn });
};

export const getConfig = (): DemoConfig => {
  if (!config) {
    throw new Error(
      "Demo file never called demo({ url }) — add it above your steps.",
    );
  }
  return config;
};

export const getSteps = (): RegisteredStep[] => registered;

export const resetRegistry = (): void => {
  config = null;
  registered.length = 0;
};

// --- Live context (set by record.ts while a step runs) ---------------------

type LiveContext = {
  page: Page;
  /** Date.now() of the first video frame. */
  videoStartedAt: number;
  viewport: { width: number; height: number };
  current: StepLog | null;
};

let live: LiveContext | null = null;

export const beginRun = (
  page: Page,
  videoStartedAt: number,
  viewport: { width: number; height: number },
): void => {
  live = { page, videoStartedAt, viewport, current: null };
};

const requireLive = (): LiveContext => {
  if (!live) {
    throw new Error(
      "Driver helpers were called outside a recording run. They only work " +
        "inside a step() body, executed by record.ts.",
    );
  }
  return live;
};

/** ms since the first video frame. */
export const elapsed = (): number => Date.now() - requireLive().videoStartedAt;

export const beginStep = (index: number, caption: string): StepLog => {
  const ctx = requireLive();
  const log: StepLog = {
    index,
    caption,
    tStart: elapsed(),
    tEnd: elapsed(),
    clicks: [],
  };
  ctx.current = log;
  return log;
};

export const endStep = (log: StepLog): void => {
  log.tEnd = elapsed();
  requireLive().current = null;
};

// --- Helpers used inside step() bodies ------------------------------------

const centerOf = async (
  locator: Locator,
): Promise<{ x: number; y: number; box: FocusBox }> => {
  const ctx = requireLive();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(
      "Target is not visible on the page, so it cannot be clicked or filmed.",
    );
  }
  const { width: vw, height: vh } = ctx.viewport;
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    box: {
      x: box.x / vw,
      y: box.y / vh,
      width: box.width / vw,
      height: box.height / vh,
    },
  };
};

/**
 * Click with a visible pointer glide.
 *
 * locator.click() teleports the pointer straight to the target, which reads as
 * a jump cut in the recording. Moving the mouse in steps first produces real
 * mousemove events — which is also what the injected cursor element follows.
 */
export const smoothClick = async (locator: Locator): Promise<void> => {
  const ctx = requireLive();
  const { x, y, box } = await centerOf(locator);

  await ctx.page.mouse.move(x, y, { steps: 24 });
  await ctx.page.waitForTimeout(140);
  await ctx.page.mouse.down();
  await ctx.page.waitForTimeout(60);
  await ctx.page.mouse.up();

  if (ctx.current) {
    ctx.current.clicks.push({
      t: elapsed(),
      x: x / ctx.viewport.width,
      y: y / ctx.viewport.height,
    });
    ctx.current.focus = box;
  }
};

/** Click into a field and type at a human cadence. */
export const smoothType = async (
  locator: Locator,
  text: string,
  perCharMs = 55,
): Promise<void> => {
  await smoothClick(locator);
  await locator.pressSequentially(text, { delay: perCharMs });
};

/** Glide the pointer to an element without clicking, and mark it as the focus. */
export const smoothHover = async (locator: Locator): Promise<void> => {
  const ctx = requireLive();
  const { x, y, box } = await centerOf(locator);
  await ctx.page.mouse.move(x, y, { steps: 24 });
  if (ctx.current) ctx.current.focus = box;
};

/** Hold on the current frame — use it to let a result land before moving on. */
export const pause = async (ms: number): Promise<void> => {
  await requireLive().page.waitForTimeout(ms);
};

/**
 * Mark a region of the viewport as this step's focus, for a zoom overlay,
 * when there is no single element to point at.
 */
export const focusRegion = (box: FocusBox): void => {
  const ctx = requireLive();
  if (ctx.current) ctx.current.focus = box;
};

// --- Sync marker -----------------------------------------------------------

/**
 * Full-viewport flash used to align the step log with the video.
 *
 * Playwright's recorder attaches a few hundred ms after we stamp our clock,
 * and the lag varies with how long the browser took to launch — so step
 * timestamps and video timestamps start out offset by an unknown amount.
 * Rather than assume a constant, we paint a colour that will not occur
 * naturally, find it in the recording afterwards, and derive the exact offset
 * for this run. It happens before the first step, so it is always cut.
 */
export const SYNC_COLOR = { r: 255, g: 0, b: 255 };
export const SYNC_FLASH_MS = 200;

/**
 * Runs in the page. Passed to page.evaluate as a real function rather than a
 * source string — a string is evaluated as an expression, so a bare arrow
 * function would be created and never called.
 */
export const flashSyncMarker = (ms: number): Promise<void> => {
  const el = document.createElement("div");
  el.id = "__demotape_sync";
  el.style.cssText = [
    "position:fixed",
    "inset:0",
    "background:rgb(255,0,255)",
    "z-index:2147483646",
    "pointer-events:none",
  ].join(";");
  (document.body || document.documentElement).appendChild(el);
  return new Promise((resolve) => {
    setTimeout(() => {
      el.remove();
      resolve();
    }, ms);
  });
};

// --- Injected cursor -------------------------------------------------------

/**
 * Playwright renders no pointer of its own, so a recording would show clicks
 * happening with nothing visibly causing them. This draws one and follows the
 * synthetic mousemove events that smoothClick generates.
 *
 * Passed to addInitScript as a function (a string argument would be run as a
 * script, so a bare arrow function would be defined and never invoked), and
 * therefore re-installed on every navigation.
 *
 * Must stay self-contained: it is serialized and runs in the page, where
 * nothing from this module's scope exists.
 *
 * DO NOT introduce a named inner function here (`const install = () => {}`).
 * esbuild's keepNames wraps those in a `__name()` helper that does not exist
 * in the page, so the whole script throws — silently, producing recordings
 * with no cursor. Anonymous callbacks passed straight to an argument are fine.
 * record.ts asserts the element exists so a regression is caught loudly.
 */
export const CURSOR_ELEMENT_ID = "__demotape_cursor";

export const installCursor = (): void => {
  // Init scripts run at document-start, before parsing — document.body and
  // even document.documentElement are still null here. So rather than build
  // the cursor now (or wait on DOMContentLoaded, which needs a named handler),
  // create it on the first mouse move: precisely when it is first needed, and
  // it re-creates itself after any navigation for free.
  window.addEventListener(
    "mousemove",
    (e) => {
      let el = document.getElementById("__demotape_cursor");
      if (!el) {
        if (!document.documentElement) return;
        el = document.createElement("div");
        el.id = "__demotape_cursor";
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = [
          "position:fixed",
          "left:0",
          "top:0",
          "width:24px",
          "height:24px",
          "z-index:2147483647",
          "pointer-events:none",
          "will-change:transform",
        ].join(";");

        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        svg.setAttribute("viewBox", "0 0 24 24");
        const pathEl = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        pathEl.setAttribute(
          "d",
          "M5 2.5 L5 19 L9.2 15.2 L11.9 21.2 L14.9 19.9 L12.2 14 L18 13.6 Z",
        );
        pathEl.setAttribute("fill", "#fff");
        pathEl.setAttribute("stroke", "rgba(0,0,0,0.75)");
        pathEl.setAttribute("stroke-width", "1.4");
        pathEl.setAttribute("stroke-linejoin", "round");
        svg.appendChild(pathEl);
        el.appendChild(svg);

        document.documentElement.appendChild(el);
      }
      el.style.transform =
        "translate(" + (e.clientX - 3) + "px," + (e.clientY - 2) + "px)";
    },
    true,
  );
};
