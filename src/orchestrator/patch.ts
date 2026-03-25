import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { RunPatchStep } from '../runs/types.js';
import { git, gitAdd, gitApply, gitCommit } from '../utils/git.js';
import { writeUtf8 } from '../utils/io.js';

export const SAIFAC_DEFAULT_AUTHOR = 'saifac <saifac@safeaifactory.com>';

export function resolveRunPatchStepAuthor(step: RunPatchStep): string {
  return step.author?.trim() || SAIFAC_DEFAULT_AUTHOR;
}

/**
 * Applies one step's unified diff, stages (excluding `.saifac/`), and commits with message + author.
 */
export async function applyRunPatchStepInRepo(opts: {
  cwd: string;
  step: RunPatchStep;
  gitEnv?: NodeJS.ProcessEnv;
  verbose?: boolean;
}): Promise<void> {
  const { cwd, step, gitEnv = process.env, verbose = false } = opts;
  if (!step.diff.trim()) return;

  const tmpPath = join(cwd, '.saifac-step.patch');
  const safeDiff = step.diff.endsWith('\n') ? step.diff : `${step.diff}\n`;
  await writeUtf8(tmpPath, safeDiff);
  await gitApply({ cwd, env: gitEnv, patchFile: tmpPath });
  await unlink(tmpPath).catch(() => {});

  await gitAdd({ cwd, env: gitEnv });
  try {
    await git({ cwd, env: gitEnv, args: ['reset', 'HEAD', '--', '.saifac'] });
  } catch {
    /* .saifac may be absent */
  }

  const stagedOut = (
    await git({ cwd, env: gitEnv, args: ['diff', '--cached', '--name-only'] })
  ).trim();
  if (!stagedOut) return;

  await gitCommit({
    cwd,
    env: gitEnv,
    message: step.message,
    author: resolveRunPatchStepAuthor(step),
    verbose,
  });
}

/**
 * Applies each step in order (incremental diffs on top of the current tree).
 */
export async function replayRunPatchSteps(opts: {
  cwd: string;
  steps: RunPatchStep[];
  gitEnv?: NodeJS.ProcessEnv;
  verbose?: boolean;
}): Promise<void> {
  const { cwd, steps, gitEnv = process.env, verbose = false } = opts;
  for (const step of steps) {
    await applyRunPatchStepInRepo({ cwd, step, gitEnv, verbose });
  }
}
