/**
 * Tests for resume / base git capture.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { gitAdd, gitCommit, gitInit } from '../utils/git.js';
import { writeUtf8 } from '../utils/io.js';
import { captureBaseGitState } from './resume.js';

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@test.dev',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@test.dev',
};

describe('captureBaseGitState', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('includes untracked files in basePatchDiff', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'resume-capture-'));
    await gitInit({ cwd: tmp, stdio: 'pipe' });
    await writeUtf8(join(tmp, 'tracked.md'), 'committed\n');
    await gitAdd({ cwd: tmp, env: gitEnv });
    await gitCommit({ cwd: tmp, env: gitEnv, message: 'init' });

    await writeUtf8(join(tmp, 'untracked-only.txt'), 'fresh\n');

    const { baseCommitSha, basePatchDiff } = await captureBaseGitState(tmp);
    expect(baseCommitSha.length).toBeGreaterThan(0);
    expect(basePatchDiff).toBeDefined();
    expect(basePatchDiff).toContain('untracked-only.txt');
    expect(basePatchDiff).toMatch(/^\s*diff --git/m);
  });

  it('combines tracked and untracked when both exist', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'resume-capture-'));
    await gitInit({ cwd: tmp, stdio: 'pipe' });
    await writeUtf8(join(tmp, 'a.md'), 'v1\n');
    await gitAdd({ cwd: tmp, env: gitEnv });
    await gitCommit({ cwd: tmp, env: gitEnv, message: 'init' });

    await writeUtf8(join(tmp, 'a.md'), 'v2\n');
    await writeUtf8(join(tmp, 'new.txt'), 'x\n');

    const { basePatchDiff } = await captureBaseGitState(tmp);
    expect(basePatchDiff).toBeDefined();
    expect(basePatchDiff).toContain('a.md');
    expect(basePatchDiff).toContain('new.txt');
  });

  it('returns undefined basePatchDiff when working tree is clean', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'resume-capture-'));
    await gitInit({ cwd: tmp, stdio: 'pipe' });
    await writeUtf8(join(tmp, 'x.md'), 'x\n');
    await gitAdd({ cwd: tmp, env: gitEnv });
    await gitCommit({ cwd: tmp, env: gitEnv, message: 'init' });

    const { basePatchDiff } = await captureBaseGitState(tmp);
    expect(basePatchDiff).toBeUndefined();
  });

  it('skips untracked directories (only records files from ls-files)', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'resume-capture-'));
    await gitInit({ cwd: tmp, stdio: 'pipe' });
    await writeUtf8(join(tmp, 'r.md'), 'r\n');
    await gitAdd({ cwd: tmp, env: gitEnv });
    await gitCommit({ cwd: tmp, env: gitEnv, message: 'init' });

    await mkdir(join(tmp, 'empty-dir'), { recursive: true });
    await writeUtf8(join(tmp, 'empty-dir', 'inside.txt'), 'in\n');

    const { basePatchDiff } = await captureBaseGitState(tmp);
    expect(basePatchDiff).toBeDefined();
    expect(basePatchDiff).toContain('inside.txt');
    expect(basePatchDiff).not.toMatch(/diff --git a\/empty-dir\/ b\/empty-dir\//);
  });

  it('uses binary patches for untracked non-text files', async () => {
    tmp = await mkdtemp(join(process.cwd(), 'resume-capture-'));
    await gitInit({ cwd: tmp, stdio: 'pipe' });
    await writeUtf8(join(tmp, 'r.md'), 'r\n');
    await gitAdd({ cwd: tmp, env: gitEnv });
    await gitCommit({ cwd: tmp, env: gitEnv, message: 'init' });

    await writeFile(join(tmp, 'pixel.bin'), Buffer.from([0x00, 0xff, 0x00, 0xfe]));

    const { basePatchDiff } = await captureBaseGitState(tmp);
    expect(basePatchDiff).toBeDefined();
    expect(basePatchDiff).toContain('pixel.bin');
    expect(basePatchDiff).toMatch(/GIT binary patch|literal/m);
  });
});
