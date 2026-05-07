/**
 * Integration tests for `saifctl run merge` (CLI wiring).
 *
 * Stands up a real git repo with one initial commit, persists a `.saifctl/runs/<id>.json`
 * artifact with a real captured diff, then runs the CLI subcommand via citty's
 * `runCommand` programmatic entry — same pattern as `run-list.test.ts`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCommand as cittyRunCommand } from 'citty';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as loggerModule from '../../logger.js';
import { git, gitAdd, gitCommit, gitInit } from '../../utils/git.js';
import { writeUtf8 } from '../../utils/io.js';
import runCommand from './run.js';

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 't@test.dev',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 't@test.dev',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

async function makeRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  await gitInit({ cwd: repo, env: gitEnv, stdio: 'pipe' });
  await git({ cwd: repo, env: gitEnv, args: ['checkout', '-b', 'main'] }).catch(() => {});
  await writeUtf8(join(repo, 'README.md'), 'baseline\n');
  await gitAdd({ cwd: repo, env: gitEnv, stdio: 'pipe' });
  await gitCommit({ cwd: repo, env: gitEnv, message: 'initial' });
  return repo;
}

/** Write a real captured diff (one new file `a.txt` with `aa`) without mutating final tree. */
async function captureAddDiff(repo: string): Promise<string> {
  await writeUtf8(join(repo, 'a.txt'), 'aa\n');
  await gitAdd({ cwd: repo, env: gitEnv, stdio: 'pipe' });
  const diff = await git({
    cwd: repo,
    env: gitEnv,
    args: ['diff', '--cached', 'HEAD', '--no-color', '--no-renames'],
  });
  await git({ cwd: repo, env: gitEnv, args: ['reset', '--hard', 'HEAD'] });
  // Defensively remove any leftover untracked from the dry add.
  await rm(join(repo, 'a.txt'), { force: true });
  return diff;
}

async function writeRunArtifact(projectDir: string, runId: string, diff: string): Promise<void> {
  const dir = join(projectDir, '.saifctl', 'runs');
  await mkdir(dir, { recursive: true });
  const doc = {
    runId,
    baseCommitSha: 'abc',
    runCommits: [{ message: 'add a', diff, author: 'Agent <agent@x.io>' }],
    sandboxHostAppliedCommitCount: 0,
    subtasks: [],
    currentSubtaskIndex: 0,
    rules: [],
    config: { featureName: 'feat-x' },
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    controlSignal: null,
    pausedSandboxBasePath: null,
    liveInfra: null,
    inspectSession: null,
  };
  await writeFile(join(dir, `${runId}.json`), JSON.stringify(doc), 'utf8');
}

class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

/**
 * Run the `run` subcommand programmatically. Captures all logger output and
 * intercepts `process.exit(1)` (which the CLI calls on failure) so the test
 * can assert on the exit code without aborting the test process.
 */
async function runRunSubcommand(
  rawArgs: string[],
): Promise<{ output: string; exitCode: number | null }> {
  const chunks: string[] = [];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as never);
  const dataSpy = vi.spyOn(loggerModule, 'outputCliData').mockImplementation((msg: string) => {
    chunks.push(msg);
  });
  const logSpy = vi.spyOn(loggerModule.consola, 'log').mockImplementation((...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  const warnSpy = vi
    .spyOn(loggerModule.consola, 'warn')
    .mockImplementation((...args: unknown[]) => {
      chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  const errSpy = vi
    .spyOn(loggerModule.consola, 'error')
    .mockImplementation((...args: unknown[]) => {
      chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  let exitCode: number | null = null;
  try {
    await cittyRunCommand(runCommand, { rawArgs });
  } catch (err) {
    if (err instanceof ProcessExitError) {
      exitCode = err.code;
    } else {
      throw err;
    }
  } finally {
    dataSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { output: chunks.join('\n'), exitCode };
}

describe('saifctl run merge', () => {
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

  it('--dry-run prints plan and does not change HEAD', async () => {
    const repo = await newRepo('cli-merge-dry-');
    const diff = await captureAddDiff(repo);
    await writeRunArtifact(repo, 'r-dry', diff);

    const headBefore = (await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim();

    const { output } = await runRunSubcommand([
      'merge',
      'r-dry',
      '--project-dir',
      repo,
      '--dry-run',
    ]);

    expect(output).toMatch(/Dry-run plan/);
    expect(output).toMatch(/Run id:\s+r-dry/);

    const headAfter = (await git({ cwd: repo, env: gitEnv, args: ['rev-parse', 'HEAD'] })).trim();
    expect(headAfter).toBe(headBefore);
  });

  it('cherry-pick applies commit to current branch on a clean tree', async () => {
    const repo = await newRepo('cli-merge-cp-');
    const diff = await captureAddDiff(repo);
    await writeRunArtifact(repo, 'r-cp', diff);

    const { output } = await runRunSubcommand(['merge', 'r-cp', '--project-dir', repo]);

    expect(output).toMatch(/Cherry-picked 1 commit\(s\)/);
    const headMsg = (
      await git({ cwd: repo, env: gitEnv, args: ['log', '-1', '--format=%s'] })
    ).trim();
    expect(headMsg).toBe('add a');
  });

  it('--strategy squash makes one commit with default message', async () => {
    const repo = await newRepo('cli-merge-sq-');
    const diff = await captureAddDiff(repo);
    await writeRunArtifact(repo, 'r-sq', diff);

    const { output } = await runRunSubcommand([
      'merge',
      'r-sq',
      '--project-dir',
      repo,
      '--strategy',
      'squash',
    ]);

    expect(output).toMatch(/Squash-merged/);
    const headMsg = (
      await git({ cwd: repo, env: gitEnv, args: ['log', '-1', '--format=%s'] })
    ).trim();
    expect(headMsg).toBe('Merge run r-sq (1 commit(s))');
  });
});
