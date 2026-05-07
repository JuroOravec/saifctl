/**
 * Integration tests for `runMergeIntoHost`.
 *
 * Each test sets up a real git repo on disk, captures real unified diffs via
 * `git diff --cached HEAD`, and exercises the full merge pipeline end-to-end.
 * Safety properties (untracked preserved, staged-new files preserved, stash
 * recoverable, pre-existing user stashes intact) are verified by inspecting
 * the filesystem and stash list after the merge.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunCommit } from '../../runs/types.js';
import { git, gitAdd, gitCommit, gitInit } from '../../utils/git.js';
import { writeUtf8 } from '../../utils/io.js';
import { runMergeIntoHost } from './merge-into-host.js';

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 't@test.dev',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 't@test.dev',
  // Avoid picking up the user's gitconfig hooks/aliases.
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

/**
 * Initialize a git repo with one initial commit on `main`.
 * Returns the repo path.
 */
async function makeRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  await gitInit({ cwd: repo, env: gitEnv, stdio: 'pipe' });
  // Force `main` as default branch name regardless of user config.
  await git({ cwd: repo, env: gitEnv, args: ['checkout', '-b', 'main'] }).catch(() => {});
  await writeUtf8(join(repo, 'README.md'), 'baseline\n');
  await gitAdd({ cwd: repo, env: gitEnv, stdio: 'pipe' });
  await gitCommit({ cwd: repo, env: gitEnv, message: 'initial' });
  return repo;
}

/**
 * Capture a real unified diff representing the given file mutations,
 * then revert the working tree so the diff can later be replayed.
 *
 * `mutate` should perform writes/deletes inside `repo`. We `git add -A` to
 * include adds, capture `git diff --cached HEAD`, then `git reset --hard`
 * to wipe both the index and working tree back to HEAD.
 */
async function captureDiffAndReset(repo: string, mutate: () => Promise<void>): Promise<string> {
  await mutate();
  await gitAdd({ cwd: repo, env: gitEnv, stdio: 'pipe' });
  const diff = await git({
    cwd: repo,
    env: gitEnv,
    args: ['diff', '--cached', 'HEAD', '--no-color', '--no-renames'],
  });
  await git({ cwd: repo, env: gitEnv, args: ['reset', '--hard', 'HEAD'] });
  // git reset --hard preserves untracked; clean those that we created in mutate().
  // We use `git ls-files --others --exclude-standard` and rm each, deliberately
  // never `git clean -fd` (test mirrors the production rule).
  const stray = (
    await git({ cwd: repo, env: gitEnv, args: ['ls-files', '--others', '--exclude-standard'] })
  )
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const path of stray) {
    await rm(join(repo, path), { force: true });
  }
  return diff;
}

async function porcelainStatus(repo: string): Promise<string[]> {
  const out = await git({ cwd: repo, env: gitEnv, args: ['status', '--porcelain'] });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

async function stashList(repo: string): Promise<string[]> {
  const out = await git({ cwd: repo, env: gitEnv, args: ['stash', 'list', '--format=%s'] });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

describe('runMergeIntoHost', () => {
  const repos: string[] = [];
  afterEach(async () => {
    for (const r of repos.splice(0)) {
      await rm(r, { recursive: true, force: true });
    }
  });

  async function newRepo(prefix: string): Promise<string> {
    const r = await makeRepo(prefix);
    repos.push(r);
    return r;
  }

  describe('clean tree, cherry-pick (default)', () => {
    it('applies each commit as a separate commit, preserving message and author', async () => {
      const repo = await newRepo('merge-cp-clean-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      const diff2 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'b.txt'), 'bb\n');
      });

      const commits: RunCommit[] = [
        { message: 'add a', diff: diff1, author: 'Agent <agent@x.io>' },
        { message: 'add b', diff: diff2 },
      ];

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r1',
        commits,
        env: gitEnv,
      });

      expect(result.success).toBe(true);
      expect(result.appliedCommitCount).toBe(2);
      expect(result.targetBranch).toBe('main');
      expect(result.stash).toBeNull();

      // Two new commits on main with original messages.
      const log = await git({
        cwd: repo,
        env: gitEnv,
        args: ['log', '-2', '--format=%s%n%an'],
      });
      expect(log).toContain('add a');
      expect(log).toContain('add b');
      expect(log).toContain('Agent');

      // Files are present.
      expect(await readMaybe(join(repo, 'a.txt'))).toBe('aa\n');
      expect(await readMaybe(join(repo, 'b.txt'))).toBe('bb\n');
    });
  });

  describe('clean tree, squash strategy', () => {
    it('produces exactly one new commit with the default message', async () => {
      const repo = await newRepo('merge-sq-clean-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      const diff2 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'b.txt'), 'bb\n');
      });

      const before = (
        await git({ cwd: repo, env: gitEnv, args: ['rev-list', '--count', 'HEAD'] })
      ).trim();

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'rq',
        commits: [
          { message: 'one', diff: diff1 },
          { message: 'two', diff: diff2 },
        ],
        strategy: 'squash',
        env: gitEnv,
      });

      expect(result.success).toBe(true);
      const after = (
        await git({ cwd: repo, env: gitEnv, args: ['rev-list', '--count', 'HEAD'] })
      ).trim();
      expect(parseInt(after, 10) - parseInt(before, 10)).toBe(1);

      const headMsg = (
        await git({ cwd: repo, env: gitEnv, args: ['log', '-1', '--format=%s'] })
      ).trim();
      expect(headMsg).toBe('Merge run rq (2 commit(s))');
    });

    it('uses --message override when provided', async () => {
      const repo = await newRepo('merge-sq-msg-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r',
        commits: [{ message: 'x', diff: diff1 }],
        strategy: 'squash',
        squashMessage: 'custom squash msg',
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      const headMsg = (
        await git({ cwd: repo, env: gitEnv, args: ['log', '-1', '--format=%s'] })
      ).trim();
      expect(headMsg).toBe('custom squash msg');
    });
  });

  describe('clean tree, worktree strategy', () => {
    it('applies to working tree without committing', async () => {
      const repo = await newRepo('merge-wt-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      const before = (await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim();

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'rw',
        commits: [{ message: 'x', diff: diff1 }],
        strategy: 'worktree',
        env: gitEnv,
      });
      expect(result.success).toBe(true);

      // HEAD did not move.
      const after = (await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim();
      expect(after).toBe(before);

      // a.txt exists and tree is dirty (file is staged or untracked).
      expect(await readMaybe(join(repo, 'a.txt'))).toBe('aa\n');
      expect((await porcelainStatus(repo)).length).toBeGreaterThan(0);
    });
  });

  describe('dirty tree refusal', () => {
    it('refuses without --allow-dirty and makes no changes', async () => {
      const repo = await newRepo('merge-refuse-');
      // Modify tracked + add untracked.
      await writeUtf8(join(repo, 'README.md'), 'modified\n');
      await writeUtf8(join(repo, 'workflows.yml'), 'untracked\n');

      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      // Re-introduce the dirty state because captureDiffAndReset cleaned up.
      await writeUtf8(join(repo, 'README.md'), 'modified\n');
      await writeUtf8(join(repo, 'workflows.yml'), 'untracked\n');

      const beforeHead = (
        await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })
      ).trim();
      const beforeStashes = await stashList(repo);

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-refuse',
        commits: [{ message: 'x', diff: diff1 }],
        env: gitEnv,
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Working tree is dirty/);
      expect(result.message).toMatch(/--allow-dirty/);

      // No new commits, no new stash.
      expect((await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim()).toBe(
        beforeHead,
      );
      expect(await stashList(repo)).toEqual(beforeStashes);

      // Dirty paths still on disk.
      expect(await readMaybe(join(repo, 'README.md'))).toBe('modified\n');
      expect(await readMaybe(join(repo, 'workflows.yml'))).toBe('untracked\n');
    });
  });

  describe('dirty tree with --allow-dirty', () => {
    it('stashes, merges, restores; preserves untracked file content', async () => {
      const repo = await newRepo('merge-allowdirty-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      // User's pre-existing dirty state:
      //   - tracked README.md is modified
      //   - untracked workflows.yml exists
      await writeUtf8(join(repo, 'README.md'), 'user-modified\n');
      await writeUtf8(join(repo, 'workflows.yml'), 'user-untracked\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-allow',
        commits: [{ message: 'add a', diff: diff1 }],
        allowDirty: true,
        env: gitEnv,
      });

      expect(result.success).toBe(true);
      expect(result.stash).not.toBeNull();
      expect(result.stash?.restored).toBe(true);
      expect(result.stash?.tag).toMatch(/^saifctl-merge:r-allow:\d+$/);
      expect(result.stash?.sha).toMatch(/^[0-9a-f]{40}$/);

      // Merged commit is on the branch, with our agent file.
      expect(await readMaybe(join(repo, 'a.txt'))).toBe('aa\n');
      // User's pre-merge state restored.
      expect(await readMaybe(join(repo, 'README.md'))).toBe('user-modified\n');
      expect(await readMaybe(join(repo, 'workflows.yml'))).toBe('user-untracked\n');

      // Stash entry intentionally LEFT in the list as a recovery point.
      const stashes = await stashList(repo);
      expect(stashes.some((s) => s.includes('saifctl-merge:r-allow'))).toBe(true);
    });

    it('preserves pre-existing user stashes (only adds our entry)', async () => {
      const repo = await newRepo('merge-preexisting-');
      // Create an unrelated user stash.
      await writeUtf8(join(repo, 'README.md'), 'user-prework\n');
      await git({
        cwd: repo,
        env: gitEnv,
        args: ['stash', 'push', '-u', '-m', 'user-prior-work'],
      });
      const beforeStashes = await stashList(repo);
      expect(beforeStashes.some((s) => s.includes('user-prior-work'))).toBe(true);

      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      await writeUtf8(join(repo, 'workflows.yml'), 'untracked\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-pre',
        commits: [{ message: 'x', diff: diff1 }],
        allowDirty: true,
        env: gitEnv,
      });
      expect(result.success).toBe(true);

      const afterStashes = await stashList(repo);
      // User's prior stash still present.
      expect(afterStashes.some((s) => s.includes('user-prior-work'))).toBe(true);
      // Our new stash also present.
      expect(afterStashes.some((s) => s.includes('saifctl-merge:r-pre'))).toBe(true);
    });
  });

  describe('rollback safety', () => {
    it('on apply failure: HEAD reset, untracked preserved, stash recoverable', async () => {
      const repo = await newRepo('merge-rollback-');
      const goodDiff = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      const badDiff = 'not a real diff at all\n';

      // Pre-existing untracked file the user must keep.
      await writeUtf8(join(repo, 'precious-untracked.txt'), 'must-survive\n');

      const headBefore = (
        await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })
      ).trim();

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-fail',
        commits: [
          { message: 'good', diff: goodDiff },
          { message: 'bad', diff: badDiff },
        ],
        allowDirty: true,
        env: gitEnv,
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/HEAD was reset/);

      // HEAD rolled back.
      const headAfter = (await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim();
      expect(headAfter).toBe(headBefore);

      // Untracked file still on disk.
      expect(await readMaybe(join(repo, 'precious-untracked.txt'))).toBe('must-survive\n');

      // Stash entry preserved (apply, not pop).
      const stashes = await stashList(repo);
      expect(stashes.some((s) => s.includes('saifctl-merge:r-fail'))).toBe(true);
    });
  });

  describe('dry-run', () => {
    it('prints plan without mutating state', async () => {
      const repo = await newRepo('merge-dryrun-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      const headBefore = (
        await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })
      ).trim();

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-dry',
        commits: [{ message: 'x', diff: diff1 }],
        dryRun: true,
        env: gitEnv,
      });

      expect(result.success).toBe(true);
      expect(result.appliedCommitCount).toBe(0);
      expect(result.message).toMatch(/Dry-run plan/);

      const headAfter = (await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim();
      expect(headAfter).toBe(headBefore);
      expect(await stashList(repo)).toEqual([]);
    });
  });

  describe('input validation', () => {
    it('returns failure when commits array is empty', async () => {
      const repo = await newRepo('merge-empty-');
      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-empty',
        commits: [],
        env: gitEnv,
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no commits to merge/);
    });

    it('rejects commits that touch .git/hooks', async () => {
      const repo = await newRepo('merge-hooks-');
      const evilDiff =
        'diff --git a/.git/hooks/pre-commit b/.git/hooks/pre-commit\n' +
        'new file mode 100755\n' +
        '--- /dev/null\n' +
        '+++ b/.git/hooks/pre-commit\n' +
        '@@ -0,0 +1,1 @@\n' +
        '+#!/bin/sh\n';
      await expect(
        runMergeIntoHost({
          projectDir: repo,
          runId: 'r-hooks',
          commits: [{ message: 'evil', diff: evilDiff }],
          env: gitEnv,
        }),
      ).rejects.toThrow(/\.git\/hooks/);
    });
  });

  describe('--into <branch>', () => {
    it('refuses --into with dirty tree (even with --allow-dirty)', async () => {
      const repo = await newRepo('merge-into-dirty-');
      // Create another branch.
      await git({ cwd: repo, env: gitEnv, args: ['branch', 'feature'] });

      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      // Dirty the working tree.
      await writeUtf8(join(repo, 'README.md'), 'dirty\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-into',
        commits: [{ message: 'x', diff: diff1 }],
        intoBranch: 'feature',
        allowDirty: true,
        env: gitEnv,
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/--into/);
    });

    it('switches branch and merges on clean tree', async () => {
      const repo = await newRepo('merge-into-clean-');
      await git({ cwd: repo, env: gitEnv, args: ['branch', 'feature'] });

      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-into-ok',
        commits: [{ message: 'x', diff: diff1 }],
        intoBranch: 'feature',
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      const currentBranch = (
        await git({ cwd: repo, env: gitEnv, args: ['branch', '--show-current'] })
      ).trim();
      expect(currentBranch).toBe('feature');
      expect(await readMaybe(join(repo, 'a.txt'))).toBe('aa\n');
    });

    it('refuses cleanly when --into branch does not exist (no state mutation)', async () => {
      const repo = await newRepo('merge-into-missing-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      const headBefore = (
        await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })
      ).trim();

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-missing-target',
        commits: [{ message: 'x', diff: diff1 }],
        intoBranch: 'does-not-exist',
        env: gitEnv,
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/branch does not exist/);
      const headAfter = (await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim();
      expect(headAfter).toBe(headBefore);
    });

    it('treats --into = current branch as no-op (no checkout)', async () => {
      const repo = await newRepo('merge-into-self-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-self',
        commits: [{ message: 'x', diff: diff1 }],
        intoBranch: 'main',
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      const currentBranch = (
        await git({ cwd: repo, env: gitEnv, args: ['branch', '--show-current'] })
      ).trim();
      expect(currentBranch).toBe('main');
    });
  });

  describe('safety: staged-but-uncommitted new files', () => {
    it('preserves staged-new files via the stash, even though git reset --hard would discard them', async () => {
      const repo = await newRepo('merge-staged-new-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'agent.txt'), 'agent\n');
      });

      // User has a staged-new file. With `git add`, the file is tracked-staged;
      // a bare `git reset --hard` would delete it. The stash must capture it.
      await writeUtf8(join(repo, 'staged-new.txt'), 'staged-content\n');
      await gitAdd({ cwd: repo, env: gitEnv, stdio: 'pipe' });

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-staged',
        commits: [{ message: 'add agent', diff: diff1 }],
        allowDirty: true,
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      expect(result.stash?.restored).toBe(true);

      // Agent's file landed.
      expect(await readMaybe(join(repo, 'agent.txt'))).toBe('agent\n');
      // User's staged-new file survives.
      expect(await readMaybe(join(repo, 'staged-new.txt'))).toBe('staged-content\n');
    });

    it('preserves staged-new files even when the merge fails mid-flight', async () => {
      const repo = await newRepo('merge-staged-new-fail-');
      const goodDiff = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'agent.txt'), 'agent\n');
      });
      const badDiff = 'not a valid diff\n';

      // Pre-stage a new file the user must keep.
      await writeUtf8(join(repo, 'staged-new.txt'), 'staged-content\n');
      await gitAdd({ cwd: repo, env: gitEnv, stdio: 'pipe' });

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-staged-fail',
        commits: [
          { message: 'good', diff: goodDiff },
          { message: 'bad', diff: badDiff },
        ],
        allowDirty: true,
        env: gitEnv,
      });
      expect(result.success).toBe(false);

      // Even though `git reset --hard` ran during rollback (which would discard
      // staged-new files), the file survives because Phase 2 stashed it first
      // and Phase 4 restored it.
      expect(await readMaybe(join(repo, 'staged-new.txt'))).toBe('staged-content\n');
    });
  });

  describe('safety: .saifctl/ exclusion in dirty filter', () => {
    it('does not block merge when only .saifctl/ files are dirty, and preserves them', async () => {
      const repo = await newRepo('merge-saifctl-only-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      // The user's only "dirty" content is under .saifctl/ — the filter should
      // ignore it and the merge should proceed without --allow-dirty.
      const saifctlDir = join(repo, '.saifctl');
      await mkdir(saifctlDir, { recursive: true });
      await writeUtf8(join(saifctlDir, 'config.yml'), 'user-edit: true\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-saifctl-only',
        commits: [{ message: 'add a', diff: diff1 }],
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      // User's .saifctl/ edit survives byte-identical (it was never committed).
      expect(await readMaybe(join(saifctlDir, 'config.yml'))).toBe('user-edit: true\n');
      // No stash was created — the filter said "clean".
      expect(result.stash).toBeNull();
    });
  });

  describe('safety: original user-reported conflict scenario', () => {
    it('refuses cleanly when dirty tree mirrors the saifdocs run case (modified README + untracked workflows + .github files)', async () => {
      const repo = await newRepo('merge-original-case-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        // Agent diff that touches README, adds workflow files — same shape as
        // the actual user-reported conflict.
        await writeUtf8(join(repo, 'README.md'), 'agent-modified\n');
        await mkdir(join(repo, '.github/workflows'), { recursive: true });
        await writeUtf8(join(repo, '.github/workflows/publish.yml'), 'name: publish\n');
      });

      // Recreate the user's pre-merge state: README modified + multiple
      // untracked workflow files, exactly the failure mode that motivated this
      // command's existence.
      await writeUtf8(join(repo, 'README.md'), 'user-modified\n');
      await mkdir(join(repo, '.github/workflows'), { recursive: true });
      await writeUtf8(join(repo, '.github/workflows/publish.yml'), 'user-untracked-1\n');
      await writeUtf8(join(repo, '.github/workflows/tests.yml'), 'user-untracked-2\n');
      await writeUtf8(join(repo, '.github/workflows/web.yml'), 'user-untracked-3\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-original',
        commits: [{ message: 'agent', diff: diff1 }],
        env: gitEnv,
      });
      // Refusal must be clean: friendly explanation + remediation, not git's
      // "would be overwritten by merge" error.
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Working tree is dirty/);
      expect(result.message).toMatch(/--allow-dirty/);
      expect(result.message).toMatch(/commit\/stash your work first/);

      // No state mutation: every dirty file is byte-identical, no new stash.
      expect(await readMaybe(join(repo, 'README.md'))).toBe('user-modified\n');
      expect(await readMaybe(join(repo, '.github/workflows/publish.yml'))).toBe(
        'user-untracked-1\n',
      );
      expect(await readMaybe(join(repo, '.github/workflows/tests.yml'))).toBe('user-untracked-2\n');
      expect(await readMaybe(join(repo, '.github/workflows/web.yml'))).toBe('user-untracked-3\n');
      expect(await stashList(repo)).toEqual([]);
    });

    it('with --allow-dirty: stashes, applies the agent commit, restores everything', async () => {
      const repo = await newRepo('merge-original-allow-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'agent\n');
      });
      // Pre-existing dirty state.
      await writeUtf8(join(repo, 'README.md'), 'user-modified\n');
      await mkdir(join(repo, '.github/workflows'), { recursive: true });
      await writeUtf8(join(repo, '.github/workflows/publish.yml'), 'user-untracked\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-original-ok',
        commits: [{ message: 'agent', diff: diff1 }],
        allowDirty: true,
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      expect(result.stash?.restored).toBe(true);
      // Agent's commit landed.
      expect(await readMaybe(join(repo, 'a.txt'))).toBe('agent\n');
      // User's dirty state restored byte-identical.
      expect(await readMaybe(join(repo, 'README.md'))).toBe('user-modified\n');
      expect(await readMaybe(join(repo, '.github/workflows/publish.yml'))).toBe('user-untracked\n');
    });
  });

  describe('stash apply conflicts (restored: false)', () => {
    it('reports restored=false and leaves the stash in the list when restoration conflicts', async () => {
      const repo = await newRepo('merge-stashconflict-');
      // Agent diff creates `agent.txt`.
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'agent.txt'), 'agent\n');
      });
      // User has an untracked file at the SAME path the agent will create.
      // After the merge:
      //   - stash captures user's `agent.txt`
      //   - agent commit creates and commits `agent.txt`
      //   - `git stash apply <sha>` tries to bring back user's `agent.txt`,
      //     conflicts with the now-committed file
      await writeUtf8(join(repo, 'agent.txt'), 'user-version\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-stashc',
        commits: [{ message: 'agent', diff: diff1 }],
        allowDirty: true,
        env: gitEnv,
      });

      // The merge itself succeeded; only the stash restoration conflicted.
      expect(result.success).toBe(true);
      expect(result.stash).not.toBeNull();
      expect(result.stash?.restored).toBe(false);

      // Stash entry preserved (apply, not pop).
      const stashes = await stashList(repo);
      expect(stashes.some((s) => s.includes('saifctl-merge:r-stashc'))).toBe(true);
    });
  });

  describe('--no-verify', () => {
    it('bypasses pre-commit hooks during cherry-pick', async () => {
      const repo = await newRepo('merge-noverify-');
      // Install a pre-commit hook that always fails.
      const hookDir = join(repo, '.git', 'hooks');
      await writeUtf8(
        join(hookDir, 'pre-commit'),
        '#!/bin/sh\necho "pre-commit reject" >&2\nexit 1\n',
      );
      // Make hook executable. Use chmod via fs so we don't shell out.
      const { chmod } = await import('node:fs/promises');
      await chmod(join(hookDir, 'pre-commit'), 0o755);

      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      // Without --no-verify: hook fails, merge fails.
      const blocked = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-noverify-block',
        commits: [{ message: 'x', diff: diff1 }],
        env: gitEnv,
      });
      expect(blocked.success).toBe(false);

      // With --no-verify: hook is bypassed, merge succeeds.
      const passed = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-noverify-pass',
        commits: [{ message: 'x', diff: diff1 }],
        noVerify: true,
        env: gitEnv,
      });
      expect(passed.success).toBe(true);
    });
  });

  describe('committer/author identity', () => {
    it('does NOT override the user\'s git identity (no implicit "saifctl" committer)', async () => {
      // The merge command must respect the user's gitconfig — never silently
      // commit as `saifctl <saifctl@safeaifactory.com>`.
      const repo = await newRepo('merge-identity-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-identity',
        commits: [{ message: 'x', diff: diff1, author: 'Agent <agent@x.io>' }],
        env: gitEnv,
      });
      expect(result.success).toBe(true);

      // Author preserved from commit; committer = test env identity (NOT saifctl).
      const meta = (
        await git({
          cwd: repo,
          env: gitEnv,
          args: ['log', '-1', '--format=%an|%ae|%cn|%ce'],
        })
      ).trim();
      const [authorName, authorEmail, committerName, committerEmail] = meta.split('|');
      expect(authorName).toBe('Agent');
      expect(authorEmail).toBe('agent@x.io');
      expect(committerName).toBe('Tester');
      expect(committerEmail).toBe('t@test.dev');
      // Negative assertion: never default to saifctl identity.
      expect(committerName).not.toBe('saifctl');
      expect(committerEmail).not.toBe('saifctl@safeaifactory.com');
    });

    it('squash uses git config identity by default', async () => {
      const repo = await newRepo('merge-squash-default-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-sq-default',
        commits: [{ message: 'x', diff: diff1 }],
        strategy: 'squash',
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      const author = (
        await git({ cwd: repo, env: gitEnv, args: ['log', '-1', '--format=%an|%ae'] })
      ).trim();
      expect(author).toBe('Tester|t@test.dev');
    });

    it('squash --author overrides the env / config identity', async () => {
      const repo = await newRepo('merge-squash-override-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });
      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-sq-override',
        commits: [{ message: 'x', diff: diff1 }],
        strategy: 'squash',
        squashAuthor: 'Override <override@x.io>',
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      const author = (
        await git({ cwd: repo, env: gitEnv, args: ['log', '-1', '--format=%an|%ae'] })
      ).trim();
      expect(author).toBe('Override|override@x.io');
    });
  });

  describe('dry-run: --apply-check signal', () => {
    it('reports clean apply-check when the first commit applies cleanly to HEAD', async () => {
      const repo = await newRepo('merge-dryrun-clean-');
      const diff1 = await captureDiffAndReset(repo, async () => {
        await writeUtf8(join(repo, 'a.txt'), 'aa\n');
      });

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-dry-clean',
        commits: [{ message: 'x', diff: diff1 }],
        dryRun: true,
        env: gitEnv,
      });
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/apply --check.*applies cleanly/);
    });

    it('flags an apply-check failure in dry-run when the first commit conflicts with HEAD', async () => {
      const repo = await newRepo('merge-dryrun-conflict-');
      // Agent diff: modify README from "baseline" to "agent-version". But
      // the actual current README content is "baseline" (from initial
      // commit). To force a conflict, we capture against the wrong base:
      // craft a diff that expects "non-existent-line" as the pre-image.
      const fakeDiff = [
        'diff --git a/README.md b/README.md',
        'index 0000000..1111111 100644',
        '--- a/README.md',
        '+++ b/README.md',
        '@@ -1 +1 @@',
        '-non-existent-line',
        '+agent-version',
        '',
      ].join('\n');

      const result = await runMergeIntoHost({
        projectDir: repo,
        runId: 'r-dry-conflict',
        commits: [{ message: 'agent', diff: fakeDiff }],
        dryRun: true,
        env: gitEnv,
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/apply --check.*FAILS/);
    });
  });
});
