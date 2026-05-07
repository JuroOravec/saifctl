import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunCommit } from '../runs/types.js';
import { git, gitAdd, gitApply, gitCommit } from '../utils/git.js';
import { writeUtf8 } from '../utils/io.js';

/** Default `Name <email>` author string used for saifctl-authored commits when {@link RunCommit.author} is unset. */
export const SAIFCTL_DEFAULT_AUTHOR = 'saifctl <saifctl@safeaifactory.com>';

/** Returns the commit's explicit author or {@link SAIFCTL_DEFAULT_AUTHOR}. */
export function resolveRunCommitAuthor(commit: RunCommit): string {
  return commit.author?.trim() || SAIFCTL_DEFAULT_AUTHOR;
}

/**
 * Applies one run commit's unified diff, stages (excluding `.saifctl/`), and commits with message + author.
 *
 * When `check` is true, only verifies the diff applies cleanly (no state change). When `noVerify`
 * is true, passes `--no-verify` to `git commit` (skips pre-commit / commit-msg hooks).
 *
 * The patch file is written under `os.tmpdir()` (not `cwd`) so it never collides with user state
 * or surfaces as dirty in `git status`.
 */
export async function applyRunCommitInRepo(opts: {
  cwd: string;
  commit: RunCommit;
  gitEnv?: NodeJS.ProcessEnv;
  verbose?: boolean;
  /** When true, only run `git apply --check` (verify cleanly, no state change). */
  check?: boolean;
  /** When true, pass `--no-verify` to `git commit`. */
  noVerify?: boolean;
}): Promise<void> {
  const {
    cwd,
    commit,
    gitEnv = process.env,
    verbose = false,
    check = false,
    noVerify = false,
  } = opts;
  if (!commit.diff.trim()) return;

  const tmpPath = join(tmpdir(), `saifctl-commit-${randomUUID()}.patch`);
  const safeDiff = commit.diff.endsWith('\n') ? commit.diff : `${commit.diff}\n`;
  await writeUtf8(tmpPath, safeDiff);
  try {
    await gitApply({ cwd, env: gitEnv, patchFile: tmpPath, check });
    if (check) return;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }

  await gitAdd({ cwd, env: gitEnv });
  try {
    await git({ cwd, env: gitEnv, args: ['reset', 'HEAD', '--', '.saifctl'] });
  } catch {
    /* .saifctl may be absent */
  }

  const stagedOut = (
    await git({ cwd, env: gitEnv, args: ['diff', '--cached', '--name-only'] })
  ).trim();
  if (!stagedOut) return;

  await gitCommit({
    cwd,
    env: gitEnv,
    message: commit.message,
    author: resolveRunCommitAuthor(commit),
    verbose,
    noVerify,
  });
}

/**
 * Applies each run commit in order (incremental diffs on top of the current tree).
 */
export async function replayRunCommits(opts: {
  cwd: string;
  commits: RunCommit[];
  gitEnv?: NodeJS.ProcessEnv;
  verbose?: boolean;
}): Promise<void> {
  const { cwd, commits, gitEnv = process.env, verbose = false } = opts;
  for (const commit of commits) {
    await applyRunCommitInRepo({ cwd, commit, gitEnv, verbose });
  }
}
