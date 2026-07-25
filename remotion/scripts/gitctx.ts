/**
 * Repository context for a demo: what branch, what changed, which PR.
 *
 * This is the third input source alongside the recording and the step log, and
 * it's what makes the output dev-native rather than generic screen capture —
 * the title card names the actual feature, and the code card shows the actual
 * diff rather than a filmed editor window.
 *
 * Everything degrades to null rather than throwing: a demo recorded outside a
 * repo, or with no PR, still produces a video.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const run = (cmd: string, args: string[]): string | null => {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  const out = res.stdout.trim();
  return out.length > 0 ? out : null;
};

export type DiffFile = {
  path: string;
  added: number;
  removed: number;
};

export type PullRequest = {
  number: number;
  title: string;
  url: string;
};

export type GitContext = {
  branch: string | null;
  /** Branch the comparison is against (main/master), if one exists. */
  baseBranch: string | null;
  /**
   * The revision range everything about "what changed" is derived from.
   * Shared so the file list and the diff hunks can never disagree — they did
   * once, when only one of them fell back for the on-base-branch case.
   */
  diffRange: string;
  subject: string | null;
  repo: string | null;
  files: DiffFile[];
  pr: PullRequest | null;
};

/** First of main/master that actually exists, so the diff has a base. */
const detectBaseBranch = (): string | null => {
  for (const candidate of ["main", "master"]) {
    if (run("git", ["rev-parse", "--verify", "--quiet", candidate])) {
      return candidate;
    }
  }
  return null;
};

const parseNumstat = (raw: string | null): DiffFile[] => {
  if (!raw) return [];
  const files: DiffFile[] = [];
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    // "-" marks a binary file; nothing useful to show from it.
    if (m[1] === "-" || m[2] === "-") continue;
    files.push({ added: Number(m[1]), removed: Number(m[2]), path: m[3] });
  }
  return files.sort((a, b) => b.added + b.removed - (a.added + a.removed));
};

export const readGitContext = (): GitContext => {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const baseBranch = detectBaseBranch();
  const subject = run("git", ["log", "-1", "--pretty=%s"]);

  const originUrl = run("git", ["remote", "get-url", "origin"]);
  const repo = originUrl
    ? (originUrl.match(/([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null)
    : null;

  // Compare against the merge base, so unrelated commits landing on main
  // afterwards don't show up as part of this feature. On the base branch
  // itself there is nothing to compare to, so fall back to the last commit.
  const diffRange =
    baseBranch && branch && branch !== baseBranch
      ? `${baseBranch}...HEAD`
      : "HEAD~1..HEAD";
  const files = parseNumstat(run("git", ["diff", "--numstat", diffRange]));

  return {
    branch,
    baseBranch,
    diffRange,
    subject,
    repo,
    files,
    pr: readPullRequest(),
  };
};

/** Open PR for the current branch, via gh. Null if gh is absent or there is none. */
export const readPullRequest = (): PullRequest | null => {
  const raw = run("gh", ["pr", "view", "--json", "number,title,url"]);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PullRequest;
    return typeof parsed.number === "number" ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Unified diff for the most-changed files, trimmed to what fits on a card.
 * Returns the hunk lines only — the card renders them, so surrounding
 * metadata would just be noise.
 */
export const readDiffLines = (
  filePath: string,
  diffRange: string,
  maxLines: number,
): string[] => {
  const raw = run("git", ["diff", "--unified=2", diffRange, "--", filePath]);
  if (!raw) return [];

  // Everything git prints before the first hunk is plumbing — mode bits,
  // blob hashes, rename scores. None of it belongs on a card.
  const HEADER = [
    "diff --git",
    "index ",
    "--- ",
    "+++ ",
    "new file mode",
    "deleted file mode",
    "old mode",
    "new mode",
    "similarity index",
    "dissimilarity index",
    "rename from",
    "rename to",
    "copy from",
    "copy to",
    "Binary files",
    "\\ No newline",
  ];

  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    if (HEADER.some((prefix) => line.startsWith(prefix))) continue;
    lines.push(line);
    if (lines.length >= maxLines) break;
  }
  return lines;
};
