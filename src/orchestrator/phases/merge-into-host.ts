/**
 * Phase: merge-into-host — apply a stored Run's commits into the user's
 * current branch (or `--into <branch>`), with strict safety guarantees for
 * pre-existing untracked / staged / stashed work.
 *
 * Key invariants (see also docs in {@link runMergeIntoHost}):
 *   - We never call `git clean` (would delete untracked files).
 *   - We never call `git stash pop` — only `git stash apply`, leaving the
 *     stash entry in the list as a recovery point.
 *   - We never auto-drop a stash entry we created. The user prunes manually.
 *   - We never override `GIT_AUTHOR_*` / `GIT_COMMITTER_*` — the user's
 *     gitconfig (or pre-existing env) determines the committer identity.
 *     Per-commit author is set explicitly via `git commit --author=...` for
 *     the cherry-pick path; the squash path uses git config / env, optionally
 *     overridden by the `--author` flag.
 *   - On any failure mid-apply we `git reset --hard` to the captured
 *     INITIAL_HEAD (resets tracked tree only — untracked files survive),
 *     then re-apply our stash. Note: staged-but-uncommitted *new* files are
 *     considered tracked by git, so they would be discarded by `--hard` —
 *     they are protected by being captured into the stash in Phase 2.
 *   - The stash SHA is captured at creation and used everywhere; stash list
 *     indices (`stash@{0}`) shift as other stashes are added, so we never
 *     trust them after the initial lookup.
 *   - A recovery file is written under `SAIFCTL_TEMP_ROOT/merge-recovery/`
 *     before any state-mutating operation, so the user can recover the
 *     stash SHA even if the terminal is closed. SIGINT/SIGTERM trigger
 *     a one-time hint print to stderr.
 *   - The patch file used for `git apply` lives under `os.tmpdir()` so it
 *     never collides with user state or surfaces as dirty.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { consola } from '../../logger.js';
import type { RunCommit } from '../../runs/types.js';
import {
  git,
  gitAdd,
  gitApply,
  gitBranchShowCurrent,
  gitCommit,
  gitResetHard,
} from '../../utils/git.js';
import { writeUtf8 } from '../../utils/io.js';
import { applyRunCommitInRepo, resolveRunCommitAuthor } from '../patch.js';
import { SAIFCTL_TEMP_ROOT } from '../sandbox.js';
import { assertRunCommitsSafeForHost } from './apply-patch.js';

/** Strategy for how run commits are merged onto the target branch. */
export type MergeStrategy = 'cherry-pick' | 'squash' | 'worktree';

/** Stash bookkeeping returned to the orchestrator/CLI for user-facing hints. */
export interface MergeStashInfo {
  /** SHA of the stash commit object (stable; doesn't shift like `stash@{0}`). */
  sha: string;
  /** Tag we used in the stash message: `saifctl-merge:<runId>:<unix-ms>`. */
  tag: string;
  /** Path of the recovery file written before any state mutation. */
  recoveryFilePath: string;
  /**
   * Whether `git stash apply <sha>` succeeded cleanly at restore time. False
   * means the stash list still holds a usable entry the user must reconcile.
   */
  restored: boolean;
}

/** Result of {@link runMergeIntoHost}. */
export interface MergeIntoHostResult {
  /** True if commits were applied successfully (or, in dry-run, the plan validated). */
  success: boolean;
  /** Commits actually applied. May be 0 in dry-run. */
  appliedCommitCount: number;
  /** Branch the commits landed on. */
  targetBranch: string;
  /** Strategy used. */
  strategy: MergeStrategy;
  /** Set when we stashed user state (only on `--allow-dirty`). */
  stash: MergeStashInfo | null;
  /** Human-readable summary suitable for printing. */
  message: string;
}

/** Inputs for {@link runMergeIntoHost}. */
export interface MergeIntoHostOpts {
  /** User's repo root. */
  projectDir: string;
  /** Run id (used for stash tags, recovery filename, default squash message). */
  runId: string;
  /** Commits to merge (artifact's `runCommits`). */
  commits: RunCommit[];
  /** How to land them on the target branch. Default: `cherry-pick`. */
  strategy?: MergeStrategy;
  /**
   * Target branch. When set and different from the current branch, we
   * `git checkout` it first (and refuse if doing so would lose work).
   * When omitted, we merge into whatever branch is currently checked out.
   */
  intoBranch?: string;
  /**
   * When false (default): refuse if the working tree is dirty.
   * When true: stash the dirty state (including untracked) before merging.
   */
  allowDirty?: boolean;
  /**
   * Custom commit message for `--strategy=squash`. Default:
   * `Merge run <runId> (<N> commit(s))`.
   */
  squashMessage?: string;
  /**
   * Override author for `--strategy=squash` (`Name <email>`). Default: git
   * config / env. Has no effect on cherry-pick (which preserves each commit's
   * original author) or worktree (which doesn't commit).
   */
  squashAuthor?: string;
  /**
   * Skip git pre-commit/post-commit hooks (`--no-verify`).
   */
  noVerify?: boolean;
  /**
   * Print the plan and exit without mutating state. Also runs `git apply --check`
   * on the first commit against current HEAD so the user gets early signal on
   * obvious conflicts.
   */
  dryRun?: boolean;
  /**
   * Forwarded to git. When omitted, the user's git config / pre-existing
   * env determines author/committer — we deliberately do NOT default to
   * `saifctl <saifctl@safeaifactory.com>` here; that fallback belongs to
   * sandbox-side code (no user gitconfig), not host-side merges.
   */
  env?: NodeJS.ProcessEnv;
}

const RECOVERY_DIR = join(SAIFCTL_TEMP_ROOT, 'merge-recovery');

/** Render a clear, copy-pasteable recovery hint for the user. */
function recoveryHintLines(stash: MergeStashInfo): string[] {
  return [
    '[run merge] Your pre-merge state is preserved in a stash entry:',
    `  Tag: ${stash.tag}`,
    `  SHA: ${stash.sha}`,
    `  Recovery file: ${stash.recoveryFilePath}`,
    '  Recover with:  git stash apply ' + stash.sha,
    '  Drop later with:  git stash list | grep saifctl-merge   # find ref, then git stash drop <ref>',
  ];
}

/**
 * Parse one porcelain v1 line, returning the path or null if the line is
 * malformed. Format: `XY <path>` (or `R  src -> dst` for renames).
 */
function porcelainPath(line: string): string | null {
  // 2 status chars + space, then the path. Renames are `R  a -> b` — we want b.
  if (line.length < 4) return null;
  const rest = line.slice(3);
  const renameSplit = rest.split(' -> ');
  return renameSplit[renameSplit.length - 1] ?? null;
}

/**
 * Snapshot dirty paths the user cares about. We exclude saifctl's own state
 * directory (`.saifctl/`) — it holds run artifacts/config and is not user work.
 * The rest of the codebase treats it the same way: `applyRunCommitInRepo`
 * unstages `.saifctl/` after a wholesale `git add -A`. Mirror that here so the
 * merge command isn't blocked by its own storage.
 */
async function dirtyStatusLines(opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<string[]> {
  const out = await git({ ...opts, args: ['status', '--porcelain'] });
  return out
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter(Boolean)
    .filter((l) => {
      const path = porcelainPath(l);
      if (!path) return true;
      return !(path === '.saifctl' || path.startsWith('.saifctl/'));
    });
}

/**
 * Push a stash entry tagged with our run id and capture its commit SHA.
 *
 * We use `git stash push --include-untracked -m <tag>` (single command) and
 * verify the resulting top-of-stack matches our tag before resolving its SHA.
 * The SHA never moves; the `stash@{N}` ref does, so we keep the SHA.
 *
 * Throws (with a user-readable message wrapped in {@link MergeStashError}) if
 * the stash command runs but doesn't produce our entry. Callers should treat
 * this as a hard failure and abort before any further mutations.
 */
async function stashUserState(opts: {
  cwd: string;
  tag: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ sha: string }> {
  const { cwd, tag, env } = opts;
  await git({
    cwd,
    env,
    args: ['stash', 'push', '--include-untracked', '-m', tag],
  });
  const topMsg = (
    await git({
      cwd,
      env,
      args: ['stash', 'list', '-1', '--format=%s'],
    })
  ).trim();
  if (!topMsg.includes(tag)) {
    throw new MergeStashError(
      `Expected our stash entry "${tag}" at top of stash list, found "${topMsg}". ` +
        `Aborting before any further state changes.`,
    );
  }
  const sha = (
    await git({
      cwd,
      env,
      args: ['rev-parse', 'stash@{0}'],
    })
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new MergeStashError(`stash@{0} did not resolve to a SHA (got "${sha}").`);
  }
  return { sha };
}

/** Distinct error class so callers can catch stash-push failures specifically. */
class MergeStashError extends Error {
  constructor(message: string) {
    super(`[run merge] Stash setup failed: ${message}`);
    this.name = 'MergeStashError';
  }
}

/**
 * Apply a stash by SHA (never `pop` — apply leaves the entry in the stash list).
 * Returns true on clean apply, false on conflict or error. Logs the underlying
 * error so the user can distinguish "merge conflict" from "git not found".
 */
async function applyStashBySha(opts: {
  cwd: string;
  sha: string;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  try {
    await git({
      cwd: opts.cwd,
      env: opts.env,
      args: ['stash', 'apply', opts.sha],
    });
    return true;
  } catch (err) {
    consola.warn(
      `[run merge] git stash apply ${opts.sha} did not succeed cleanly: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

/** Persist recovery info (stash SHA + tag) for out-of-terminal recovery. */
async function writeRecoveryFile(opts: {
  runId: string;
  tag: string;
  sha: string;
  projectDir: string;
}): Promise<string> {
  await mkdir(RECOVERY_DIR, { recursive: true });
  // Use a UUID instead of Date.now() so two merges within the same ms can't collide.
  const filePath = join(RECOVERY_DIR, `${opts.runId}-${randomUUID()}.txt`);
  const body = [
    `# saifctl run merge — pre-merge stash recovery info`,
    `runId: ${opts.runId}`,
    `tag:   ${opts.tag}`,
    `sha:   ${opts.sha}`,
    `repo:  ${opts.projectDir}`,
    `time:  ${new Date().toISOString()}`,
    '',
    `# To restore your pre-merge state:`,
    `#   cd ${opts.projectDir}`,
    `#   git stash apply ${opts.sha}`,
    '',
  ].join('\n');
  await writeUtf8(filePath, body);
  return filePath;
}

/** Build the squash commit message — default or user-supplied. */
function defaultSquashMessage(runId: string, count: number): string {
  return `Merge run ${runId} (${count} commit(s))`;
}

/**
 * Write a commit's diff to a temp file under os.tmpdir() and call gitApply.
 * Always cleans up the temp file. When `check` is true, runs `git apply --check`
 * (verify-only, no state change).
 */
async function applyOneDiff(opts: {
  cwd: string;
  diff: string;
  env: NodeJS.ProcessEnv;
  check?: boolean;
}): Promise<void> {
  const tmpPath = join(tmpdir(), `saifctl-commit-${randomUUID()}.patch`);
  const safeDiff = opts.diff.endsWith('\n') ? opts.diff : `${opts.diff}\n`;
  await writeUtf8(tmpPath, safeDiff);
  try {
    await gitApply({ cwd: opts.cwd, env: opts.env, patchFile: tmpPath, check: opts.check });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Apply commits one at a time as separate commits on the current branch.
 * Each commit's message and (optional) author are preserved. Pre-checks each
 * diff with `git apply --check` so it fails fast, before the actual apply.
 */
async function cherryPickCommits(opts: {
  cwd: string;
  commits: RunCommit[];
  env: NodeJS.ProcessEnv;
  noVerify: boolean;
}): Promise<void> {
  for (const commit of opts.commits) {
    if (!commit.diff.trim()) continue;
    // applyRunCommitInRepo handles patch file under tmpdir, --check pre-pass, and noVerify.
    await applyRunCommitInRepo({
      cwd: opts.cwd,
      commit,
      gitEnv: opts.env,
      verbose: false,
      check: true,
    });
    await applyRunCommitInRepo({
      cwd: opts.cwd,
      commit,
      gitEnv: opts.env,
      verbose: false,
      noVerify: opts.noVerify,
    });
  }
}

/**
 * Apply each commit's diff to the working tree (no commit), then make one
 * squash commit with the supplied message. Pre-checks each diff before applying.
 */
async function squashCommits(opts: {
  cwd: string;
  commits: RunCommit[];
  message: string;
  author?: string;
  env: NodeJS.ProcessEnv;
  noVerify: boolean;
}): Promise<void> {
  // Pre-check the first diff cleanly against current HEAD; subsequent diffs
  // can only be checked iteratively (each builds on the previous), so we rely
  // on per-iteration --check there.
  for (const commit of opts.commits) {
    if (!commit.diff.trim()) continue;
    await applyOneDiff({ cwd: opts.cwd, diff: commit.diff, env: opts.env, check: true });
    await applyOneDiff({ cwd: opts.cwd, diff: commit.diff, env: opts.env });
  }
  await gitAdd({ cwd: opts.cwd, env: opts.env });
  try {
    await git({ cwd: opts.cwd, env: opts.env, args: ['reset', 'HEAD', '--', '.saifctl'] });
  } catch {
    /* .saifctl may be absent */
  }
  const stagedOut = (
    await git({ cwd: opts.cwd, env: opts.env, args: ['diff', '--cached', '--name-only'] })
  ).trim();
  if (!stagedOut) return;
  await gitCommit({
    cwd: opts.cwd,
    env: opts.env,
    message: opts.message,
    author: opts.author?.trim() || undefined,
    verbose: false,
    noVerify: opts.noVerify,
  });
}

/**
 * Apply each commit's diff to the working tree, no commit, no stage.
 * Used by `--strategy=worktree` for pre-commit review.
 */
async function applyToWorkingTreeOnly(opts: {
  cwd: string;
  commits: RunCommit[];
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  for (const commit of opts.commits) {
    if (!commit.diff.trim()) continue;
    await applyOneDiff({ cwd: opts.cwd, diff: commit.diff, env: opts.env, check: true });
    await applyOneDiff({ cwd: opts.cwd, diff: commit.diff, env: opts.env });
  }
}

/**
 * Install a one-time SIGINT/SIGTERM handler that prints the recovery hint and
 * exits non-zero. Returns a cleanup function that removes the handlers.
 *
 * Per the design: do NOT attempt cleanup automatically on interrupt — the
 * stash entry + recovery file are the recovery surface; printing the hint is
 * the only useful thing we can guarantee mid-flight.
 */
function installInterruptHint(stash: MergeStashInfo): () => void {
  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    // Use process.stderr.write instead of consola so we don't depend on
    // formatter state during the interrupt.
    const lines = ['', '[run merge] Interrupted.', ...recoveryHintLines(stash), ''];
    process.stderr.write(lines.join('\n') + '\n');
    // Re-raise after announcing — let the default handler exit the process.
    process.removeListener('SIGINT', handler);
    process.removeListener('SIGTERM', handler);
    process.kill(process.pid, 'SIGINT');
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return () => {
    process.removeListener('SIGINT', handler);
    process.removeListener('SIGTERM', handler);
  };
}

/**
 * Merge a stored Run's commits into the host's current branch (or `--into`).
 *
 * Refuses on dirty tree unless `--allow-dirty`. With `--allow-dirty`, the
 * dirty state is stashed (`git stash push -u`) before applying, then restored
 * via `git stash apply <sha>` after — never `pop`, so the stash entry remains
 * in the list as a recovery point. See file header for the full safety model.
 *
 * On any error during the apply phase we `git reset --hard <INITIAL_HEAD>`
 * (which preserves untracked files) and re-apply the stash.
 */
export async function runMergeIntoHost(opts: MergeIntoHostOpts): Promise<MergeIntoHostResult> {
  const {
    projectDir,
    runId,
    commits,
    strategy = 'cherry-pick',
    intoBranch,
    allowDirty = false,
    squashMessage,
    squashAuthor,
    noVerify = false,
    dryRun = false,
    env: callerEnv,
  } = opts;

  // ---------------------------------------------------------------------
  // Phase 0: read-only validation. No state changes.
  // ---------------------------------------------------------------------
  if (!commits || commits.length === 0) {
    return {
      success: false,
      appliedCommitCount: 0,
      targetBranch: '',
      strategy,
      stash: null,
      message: `Run "${runId}" has no commits to merge.`,
    };
  }
  assertRunCommitsSafeForHost(commits);

  // Deliberately no GIT_AUTHOR_*/GIT_COMMITTER_* defaults here — let the
  // user's gitconfig (or any pre-existing env) win. This is the user's repo.
  const env: NodeJS.ProcessEnv = { ...process.env, ...callerEnv };

  const initialBranch = (await gitBranchShowCurrent({ cwd: projectDir, env })).trim();
  const initialHead = (await git({ cwd: projectDir, env, args: ['rev-parse', 'HEAD'] })).trim();
  if (!initialHead) {
    return {
      success: false,
      appliedCommitCount: 0,
      targetBranch: initialBranch,
      strategy,
      stash: null,
      message: 'Could not determine HEAD of the host repository.',
    };
  }

  // Detached HEAD without an explicit `--into <branch>` is ambiguous; refuse.
  if (!initialBranch && !intoBranch) {
    return {
      success: false,
      appliedCommitCount: 0,
      targetBranch: '',
      strategy,
      stash: null,
      message:
        'HEAD is detached and no --into <branch> was given. Either checkout a branch first, or pass --into <branch>.',
    };
  }

  // If `--into` is given and points to a branch that doesn't exist, refuse cleanly
  // before any state mutation. (Currently-checked-out branch is treated as a no-op.)
  if (intoBranch && intoBranch.trim() && intoBranch.trim() !== initialBranch) {
    try {
      await git({
        cwd: projectDir,
        env,
        args: ['rev-parse', '--verify', `refs/heads/${intoBranch.trim()}`],
      });
    } catch {
      return {
        success: false,
        appliedCommitCount: 0,
        targetBranch: initialBranch,
        strategy,
        stash: null,
        message: `--into "${intoBranch.trim()}": branch does not exist.`,
      };
    }
  }

  const dirtyLines = await dirtyStatusLines({ cwd: projectDir, env });
  const isDirty = dirtyLines.length > 0;

  if (isDirty && !allowDirty) {
    const list = dirtyLines.slice(0, 20).join('\n  ');
    const more = dirtyLines.length > 20 ? `\n  ...and ${dirtyLines.length - 20} more` : '';
    return {
      success: false,
      appliedCommitCount: 0,
      targetBranch: initialBranch,
      strategy,
      stash: null,
      message:
        `Working tree is dirty. ${dirtyLines.length} change(s) present:\n  ${list}${more}\n\n` +
        `Refusing to merge without --allow-dirty. Either:\n` +
        `  - commit/stash your work first, then re-run, or\n` +
        `  - re-run with --allow-dirty (stashes your work to a recoverable entry,\n` +
        `    leaves it in the stash list after the merge for safety).`,
    };
  }

  // Dry-run: print plan, run a `git apply --check` on the first commit so the
  // user gets an early conflict signal — and exit without mutating state.
  if (dryRun) {
    const targetBranch = intoBranch?.trim() || initialBranch;
    const lines = [
      `[run merge] Dry-run plan:`,
      `  Run id:    ${runId}`,
      `  Strategy:  ${strategy}`,
      `  Target:    ${targetBranch}${intoBranch ? '' : ' (current branch)'}`,
      `  Commits:   ${commits.length}`,
      `  Dirty:     ${isDirty ? `yes (${dirtyLines.length} path(s); --allow-dirty=${allowDirty})` : 'no'}`,
      `  HEAD:      ${initialHead.slice(0, 12)}`,
    ];
    if (isDirty && allowDirty) {
      lines.push(
        '  Would stash --include-untracked, apply commits, then `git stash apply <sha>` (no pop, no auto-drop).',
      );
    }
    // Pre-flight: check that the first non-empty diff applies against current HEAD.
    // We can only check the first one cleanly without mutating state; subsequent
    // commits depend on previous ones being applied first.
    const firstNonEmpty = commits.find((c) => c.diff.trim());
    if (firstNonEmpty) {
      try {
        await applyOneDiff({
          cwd: projectDir,
          diff: firstNonEmpty.diff,
          env,
          check: true,
        });
        lines.push(`  apply --check: first commit applies cleanly against HEAD.`);
      } catch (err) {
        lines.push(
          `  apply --check: first commit FAILS to apply against HEAD: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          success: false,
          appliedCommitCount: 0,
          targetBranch,
          strategy,
          stash: null,
          message: lines.join('\n'),
        };
      }
    }
    return {
      success: true,
      appliedCommitCount: 0,
      targetBranch,
      strategy,
      stash: null,
      message: lines.join('\n'),
    };
  }

  // ---------------------------------------------------------------------
  // Phase 1: optional checkout of --into <branch>. Refuses to switch with
  // a dirty tree even under --allow-dirty (stashing across branch switch
  // is fragile and the stash would conceptually belong to the source branch).
  // ---------------------------------------------------------------------
  let switchedBranch = false;
  if (intoBranch && intoBranch.trim() && intoBranch.trim() !== initialBranch) {
    if (isDirty && allowDirty) {
      return {
        success: false,
        appliedCommitCount: 0,
        targetBranch: initialBranch,
        strategy,
        stash: null,
        message:
          `--into ${intoBranch} requires a clean working tree (would risk applying your stashed work to the wrong branch). ` +
          `Commit or stash manually, switch branches, then re-run without --into.`,
      };
    }
    await git({ cwd: projectDir, env, args: ['checkout', intoBranch.trim()] });
    switchedBranch = true;
  }
  const effectiveBranch = (await gitBranchShowCurrent({ cwd: projectDir, env })).trim();
  // Re-capture HEAD after potential branch switch — that's the rollback point.
  const rollbackHead = (await git({ cwd: projectDir, env, args: ['rev-parse', 'HEAD'] })).trim();

  // ---------------------------------------------------------------------
  // Phase 2: stash dirty state, if any. SHA captured up front and printed
  // BEFORE we touch the tree, so the user can recover even on Ctrl+C.
  // ---------------------------------------------------------------------
  let stashInfo: MergeStashInfo | null = null;
  let removeInterruptHint: (() => void) | null = null;
  if (isDirty) {
    const tag = `saifctl-merge:${runId}:${Date.now()}`;
    let stashResult: { sha: string };
    try {
      stashResult = await stashUserState({ cwd: projectDir, tag, env });
    } catch (err) {
      // Defensive: if the stash setup itself failed, abort with HEAD/index/tree
      // untouched. Phase 1 may have switched branches — switch back.
      if (switchedBranch && initialBranch) {
        try {
          await git({ cwd: projectDir, env, args: ['checkout', initialBranch] });
        } catch {
          /* best effort */
        }
      }
      return {
        success: false,
        appliedCommitCount: 0,
        targetBranch: effectiveBranch,
        strategy,
        stash: null,
        message:
          err instanceof Error ? err.message : `[run merge] Stash setup failed: ${String(err)}`,
      };
    }
    const recoveryFilePath = await writeRecoveryFile({
      runId,
      tag,
      sha: stashResult.sha,
      projectDir,
    });
    stashInfo = { sha: stashResult.sha, tag, recoveryFilePath, restored: false };
    consola.log(
      `[run merge] Pre-merge state stashed.\n` +
        `  Tag: ${tag}\n` +
        `  SHA: ${stashResult.sha}\n` +
        `  Recovery file: ${recoveryFilePath}\n` +
        `  Recover any time with:  git stash apply ${stashResult.sha}`,
    );
    removeInterruptHint = installInterruptHint(stashInfo);
  }

  // ---------------------------------------------------------------------
  // Phase 3: apply commits per strategy. On any failure: roll back tree
  // to rollbackHead (preserves untracked) and re-apply our stash.
  // ---------------------------------------------------------------------
  let appliedOk = false;
  let applyError: unknown = null;
  try {
    if (strategy === 'cherry-pick') {
      await cherryPickCommits({ cwd: projectDir, commits, env, noVerify });
    } else if (strategy === 'squash') {
      await squashCommits({
        cwd: projectDir,
        commits,
        message: squashMessage?.trim() || defaultSquashMessage(runId, commits.length),
        author: squashAuthor?.trim() || undefined,
        env,
        noVerify,
      });
    } else if (strategy === 'worktree') {
      await applyToWorkingTreeOnly({ cwd: projectDir, commits, env });
    } else {
      throw new Error(`[run merge] Unknown strategy: ${strategy as string}`);
    }
    appliedOk = true;
  } catch (err) {
    applyError = err;
    // Rollback: reset --hard rolls tracked working tree + index back to rollbackHead.
    // It explicitly does NOT touch untracked files. We never run `git clean`.
    // Note: any newly-staged-but-uncommitted files the user had are SAFE here
    // because they were captured into the stash in Phase 2 before this reset runs.
    try {
      await gitResetHard({ cwd: projectDir, env, ref: rollbackHead });
    } catch (resetErr) {
      consola.error(
        `[run merge] Rollback "git reset --hard ${rollbackHead}" failed: ${String(resetErr)}. ` +
          `Manual recovery may be needed.`,
      );
    }
    // Switch back to the original branch if we changed branches.
    if (switchedBranch && initialBranch) {
      try {
        await git({ cwd: projectDir, env, args: ['checkout', initialBranch] });
      } catch (coErr) {
        consola.error(
          `[run merge] Could not return to original branch "${initialBranch}": ${String(coErr)}.`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Phase 4: restore stash (always — both success and failure paths).
  // We use `apply`, never `pop`. The stash entry stays in the list.
  // ---------------------------------------------------------------------
  if (stashInfo) {
    const restored = await applyStashBySha({ cwd: projectDir, sha: stashInfo.sha, env });
    stashInfo = { ...stashInfo, restored };
    if (!restored) {
      consola.warn(
        `[run merge] Restoring your pre-merge state via 'git stash apply ${stashInfo.sha}' produced conflicts. ` +
          `Your work is still safe in the stash entry; resolve manually.`,
      );
      for (const line of recoveryHintLines(stashInfo)) {
        consola.warn(line);
      }
    }
  }

  // SIGINT handler is no longer useful — work is done.
  if (removeInterruptHint) removeInterruptHint();

  if (!appliedOk) {
    const errMsg = applyError instanceof Error ? applyError.message : String(applyError);
    const lines = [
      `Merge of run ${runId} failed: ${errMsg}`,
      `HEAD was reset to ${rollbackHead.slice(0, 12)} on branch ${initialBranch || '(detached)'}.`,
    ];
    if (stashInfo) {
      lines.push('', ...recoveryHintLines(stashInfo));
    }
    return {
      success: false,
      appliedCommitCount: 0,
      targetBranch: effectiveBranch,
      strategy,
      stash: stashInfo,
      message: lines.join('\n'),
    };
  }

  // ---------------------------------------------------------------------
  // Phase 5: success summary + opportunistic recovery-file cleanup.
  // ---------------------------------------------------------------------
  if (stashInfo && stashInfo.restored) {
    // Stash applied cleanly — the recovery file is no longer load-bearing.
    // The stash entry itself remains in the list per design (never auto-drop).
    await unlink(stashInfo.recoveryFilePath).catch(() => {});
  }

  const summary: string[] = [];
  if (strategy === 'worktree') {
    summary.push(
      `Applied ${commits.length} commit(s) from run ${runId} to working tree of "${effectiveBranch}" (no commit).`,
      `Review with 'git diff', then commit when ready.`,
    );
  } else if (strategy === 'squash') {
    summary.push(
      `Squash-merged ${commits.length} commit(s) from run ${runId} into "${effectiveBranch}" as 1 commit.`,
    );
  } else {
    summary.push(
      `Cherry-picked ${commits.length} commit(s) from run ${runId} onto "${effectiveBranch}".`,
    );
  }
  if (stashInfo) {
    summary.push('', ...recoveryHintLines(stashInfo));
  }

  return {
    success: true,
    appliedCommitCount: commits.length,
    targetBranch: effectiveBranch,
    strategy,
    stash: stashInfo,
    message: summary.join('\n'),
  };
}

// Re-export so callers (and the CLI) can pass through `squashAuthor`.
export type { RunCommit } from '../../runs/types.js';
