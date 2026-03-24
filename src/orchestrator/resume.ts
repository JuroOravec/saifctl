/**
 * Resume-specific logic for the Software Factory.
 *
 * Handles git state capture, worktree creation for resuming failed runs,
 * save-on-Ctrl+C artifact persistence.
 */

import { createHash } from 'node:crypto';
import { mkdir, realpath, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { consola } from '../logger.js';
import type { RunStorage } from '../runs/types.js';
import { buildRunArtifact, type BuildRunArtifactOpts } from '../runs/utils/artifact.js';
import {
  git,
  gitApply,
  gitBranchDelete,
  gitDiff,
  gitWorktreeAdd,
  gitWorktreeRemove,
} from '../utils/git.js';
import { pathExists, readUtf8, writeUtf8 } from '../utils/io.js';
import { type RunStorageContext } from './loop.js';
import { SAIFAC_TEMP_ROOT, type Sandbox } from './sandbox.js';

// ---------------------------------------------------------------------------
// Base git state capture (for run storage on start)
// ---------------------------------------------------------------------------

/**
 * Captures the current git state so we can reconstruct it when resuming.
 * Returns baseCommitSha and basePatchDiff (unstaged + staged) for RunStorageContext.
 */
export async function captureBaseGitState(projectDir: string): Promise<RunStorageContext> {
  let baseCommitSha: string;
  let basePatchDiff: string | undefined;

  try {
    baseCommitSha = (await git({ cwd: projectDir, args: ['rev-parse', 'HEAD'] })).trim();
    const status = (await git({ cwd: projectDir, args: ['status', '--porcelain'] })).trim();
    if (status) {
      const unstaged = await gitDiff({ cwd: projectDir });
      const staged = await gitDiff({ cwd: projectDir, staged: true });
      // Filter out entirely empty output, but do not trim valid diffs so trailing newlines are preserved
      basePatchDiff = [unstaged, staged].filter((s) => s.trim()).join('') || undefined;
    }
  } catch (err) {
    consola.warn('[orchestrator] Could not capture base git state for run storage:', err);
    baseCommitSha = '';
  }
  return { baseCommitSha, basePatchDiff };
}

// ---------------------------------------------------------------------------
// Create resume worktree
// ---------------------------------------------------------------------------

export interface CreateResumeWorktreeParams {
  projectDir: string;
  runId: string;
  baseCommitSha: string;
  basePatchDiff: string | undefined;
  runPatchDiff: string;
}

export interface CreateResumeWorktreeResult {
  worktreePath: string;
  branchName: string;
}

async function gitWorktreeListForDebug(cwd: string): Promise<string> {
  try {
    return (await git({ cwd, args: ['worktree', 'list'] })).trimEnd();
  } catch {
    return '(git worktree list failed)';
  }
}

/**
 * Materializes a **fresh** git worktree from the stored run artifact (always from scratch).
 * The worktree lives under `{@link SAIFAC_TEMP_ROOT}/resume-worktrees/` so it is ephemeral
 * like sandboxes — not under `.saifac/worktrees/` inside the repo (linked worktrees there
 * often break or confuse git). `runStartCore` then builds a new rsync sandbox from this path.
 *
 * Layers applied on top of `baseCommitSha`:
 * - Base patch diff — uncommitted host changes at run start (optional).
 * - Run patch diff — agent output from the stored artifact.
 */
export async function createResumeWorktree(
  params: CreateResumeWorktreeParams,
): Promise<CreateResumeWorktreeResult> {
  const { projectDir, runId, baseCommitSha, basePatchDiff, runPatchDiff } = params;

  try {
    await git({ cwd: projectDir, args: ['rev-parse', baseCommitSha] });
  } catch {
    throw new Error(
      `baseCommitSha ${baseCommitSha} not found. Ensure you have pulled the latest changes or are on the correct machine.`,
    );
  }

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'saifac',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'saifac@localhost',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'saifac',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'saifac@localhost',
  };

  const resumeWorktreesBase = join(SAIFAC_TEMP_ROOT, 'resume-worktrees');
  await mkdir(resumeWorktreesBase, { recursive: true });
  const dirKey = createHash('sha256').update(projectDir).digest('hex').slice(0, 16);
  const worktreePath = join(resumeWorktreesBase, `${dirKey}-${runId}`);
  const branchName = `saifac-resume-${runId}`;

  // Same runId may have left a broken worktree dir / branch from a prior attempt; git would
  // otherwise leave us with no usable path and Node reports spawn ENOENT when cwd is missing.
  try {
    await gitWorktreeRemove({ cwd: projectDir, path: worktreePath, stdio: 'pipe' });
  } catch {
    /* not registered */
  }
  if (await pathExists(worktreePath)) {
    await rm(worktreePath, { recursive: true, force: true });
  }
  try {
    await gitBranchDelete({ cwd: projectDir, branch: branchName, force: true, stdio: 'pipe' });
  } catch {
    /* branch may not exist */
  }

  consola.log(`[orchestrator] Preparing workspace from storage...`);

  await gitWorktreeAdd({
    cwd: projectDir,
    path: worktreePath,
    branch: branchName,
    startCommit: baseCommitSha,
    env: gitEnv,
    stdio: 'inherit',
  });

  if (!(await pathExists(worktreePath))) {
    throw new Error(
      `[orchestrator] git worktree add exited 0 but worktree path is missing: ${worktreePath}\n` +
        `git worktree list:\n${await gitWorktreeListForDebug(projectDir)}`,
    );
  }

  const applyPatchFromString = async (diff: string) => {
    const tmpPath = join(worktreePath, '.saifac-apply.patch');
    // Ensure the patch string ends with a newline, otherwise git apply will fail with "corrupt patch".
    // Needed because older runs may have saved trimmed diffs into the JSON artifact.
    const safeDiff = diff.endsWith('\n') ? diff : diff + '\n';
    await writeUtf8(tmpPath, safeDiff);
    await gitApply({ cwd: worktreePath, env: gitEnv, patchFile: tmpPath });
    await unlink(tmpPath);
  };

  try {
    if (basePatchDiff?.trim()) {
      await applyPatchFromString(basePatchDiff);
    }
    if (runPatchDiff.trim()) {
      await applyPatchFromString(runPatchDiff);
    }
  } catch (err: unknown) {
    // Remove worktree on failure. cleanupResumeWorkspace only invokes onError when *cleanup*
    // throws — not when apply failed — so we must rethrow the apply error here.
    await cleanupResumeWorkspace({ worktreePath, projectDir, branchName }, () => {});
    throw new Error(
      `[orchestrator] Failed to apply stored diffs. The run state may be incompatible with the current tree.\n${err}`,
    );
  }

  if (!(await pathExists(worktreePath))) {
    throw new Error(
      `[orchestrator] Resume worktree path missing after applying stored patches: ${worktreePath}\n` +
        `git worktree list:\n${await gitWorktreeListForDebug(projectDir)}`,
    );
  }

  let canonicalWorktreePath: string;
  try {
    canonicalWorktreePath = await realpath(worktreePath);
  } catch (err) {
    throw new Error(
      `[orchestrator] Could not realpath resume worktree ${worktreePath}: ${String(err)}`,
    );
  }

  return { worktreePath: canonicalWorktreePath, branchName };
}

// ---------------------------------------------------------------------------
// Cleanup resume worktree
// ---------------------------------------------------------------------------

export interface CleanupResumeWorkspaceParams {
  worktreePath: string;
  projectDir: string;
  branchName: string;
}

/**
 * Removes the resume worktree and deletes the branch.
 * `onError` runs only if cleanup itself throws (e.g. git worktree remove failed); it does not
 * run on success. Callers that need to propagate a prior error must throw after awaiting this.
 */
export async function cleanupResumeWorkspace(
  params: CleanupResumeWorkspaceParams,
  onError: () => void,
): Promise<void> {
  const { worktreePath, projectDir, branchName } = params;
  try {
    await gitWorktreeRemove({ cwd: projectDir, path: worktreePath });
    await gitBranchDelete({ cwd: projectDir, branch: branchName, force: true });
  } catch {
    onError();
  }
}

// ---------------------------------------------------------------------------
// Save run artifact (on Ctrl+C / failure)
// ---------------------------------------------------------------------------

export interface CreateSaveRunHandlerParams {
  sandbox: Sandbox;
  runContext: RunStorageContext;
  opts: BuildRunArtifactOpts;
  runStorage: RunStorage;
}

/**
 * Returns an async handler for registry.setBeforeCleanup.
 * When the user hits Ctrl+C before the loop finishes, persists a failed run artifact (patch may be empty).
 */
export async function saveRunOnError(params: CreateSaveRunHandlerParams): Promise<void> {
  const { sandbox, runContext, opts, runStorage } = params;

  const runId = sandbox.runId;
  const patchPath = join(sandbox.sandboxBasePath, 'patch.diff');
  const runPatchDiff = (await pathExists(patchPath)) ? (await readUtf8(patchPath)).trimEnd() : '';

  const artifact = buildRunArtifact({
    runId,
    baseCommitSha: runContext.baseCommitSha,
    basePatchDiff: runContext.basePatchDiff,
    runPatchDiff,
    specRef: opts.feature.relativePath,
    lastFeedback: runContext.lastErrorFeedback,
    status: 'failed',
    opts,
  });

  await runStorage.saveRun(runId, artifact);
  consola.log(
    `[orchestrator] Run artifact saved (interrupted). Resume with: saifac run resume ${runId}`,
  );
}
