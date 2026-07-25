/**
 * Sign in once, in the profile that recordings use.
 *
 * Recordings run against a dedicated Chrome profile at .demotape/profile —
 * not your everyday one, because Chrome holds an exclusive lock on a profile
 * directory while it's running, so Playwright could never open it while you
 * had Chrome open. The trade is that the recording profile starts logged out.
 * This opens it interactively so you can log in; the session then persists for
 * every future recording.
 *
 * Usage (from remotion/):
 *   npx tsx scripts/login.ts <url>
 */
import path from "node:path";
import { openContext, PROFILE_DIR } from "./record";

const main = async () => {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx scripts/login.ts <url>");
    process.exit(1);
  }

  console.log(
    `\nOpening ${url} in the recording profile\n  ${PROFILE_DIR}\n\n` +
      `Sign in, then press Enter here to save the session and close.\n`,
  );

  const { context, page } = await openContext({
    viewport: { width: 1280, height: 800 },
    headless: false,
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  await context.close();
  console.log(
    `✓ Session saved to ${path.relative(process.cwd(), PROFILE_DIR)}\n` +
      `  Future recordings will already be signed in.`,
  );
  process.exit(0);
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
