/**
 * Tests for subtask signaling helpers in sandbox.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  subtaskDonePath,
  subtaskExitPath,
  subtaskNextPath,
  subtaskRetriesPath,
} from '../constants.js';
import { pathExists, readUtf8 } from '../utils/io.js';
import {
  pollSubtaskDone,
  prepareSubtaskSignalDir,
  updateSandboxSubtaskScripts,
  writeSubtaskExitSignal,
  writeSubtaskNextPrompt,
  writeSubtaskRetriesOverride,
} from './sandbox.js';

describe('updateSandboxSubtaskScripts', () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it('writes gate.sh + agent.sh + stage.sh with chmod 0755 from the per-subtask values', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    const saifctlPath = join(base, 'saifctl');
    await mkdir(saifctlPath, { recursive: true });

    await updateSandboxSubtaskScripts({
      saifctlPath,
      gateScript: '#!/bin/bash\necho gate',
      agentScript: '#!/bin/bash\necho agent',
      stageScript: '#!/bin/bash\necho stage',
      subtaskEnv: {},
    });

    expect(await readUtf8(join(saifctlPath, 'gate.sh'))).toBe('#!/bin/bash\necho gate');
    expect(await readUtf8(join(saifctlPath, 'agent.sh'))).toBe('#!/bin/bash\necho agent');
    expect(await readUtf8(join(saifctlPath, 'stage.sh'))).toBe('#!/bin/bash\necho stage');
  });

  // Per-phase-config phase 7.2: agent.sh must be rewritten on every transition,
  // not only when a per-phase override exists. Otherwise transitioning from a
  // phase that overrode `agent.script` to a phase that didn't would leak the
  // previous phase's script across the boundary. The compile/runtime layer
  // resolves the per-subtask value (override-or-run-level fallback) before
  // it reaches this function, so always-write makes phase boundaries
  // idempotent.
  it('overwrites a previously-overridden agent.sh with the run-level fallback on the next transition', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    const saifctlPath = join(base, 'saifctl');
    await mkdir(saifctlPath, { recursive: true });

    // Simulate a phase A override having been written.
    await updateSandboxSubtaskScripts({
      saifctlPath,
      gateScript: '#!/bin/bash\necho gate-a',
      agentScript: '#!/bin/bash\necho phase-a-override',
      stageScript: '#!/bin/bash\necho stage-a',
      subtaskEnv: {},
    });
    expect(await readUtf8(join(saifctlPath, 'agent.sh'))).toBe(
      '#!/bin/bash\necho phase-a-override',
    );

    // Transition to phase B that resolves to the run-level fallback.
    await updateSandboxSubtaskScripts({
      saifctlPath,
      gateScript: '#!/bin/bash\necho gate-b',
      agentScript: '#!/bin/bash\necho run-level',
      stageScript: '#!/bin/bash\necho stage-b',
      subtaskEnv: {},
    });
    expect(await readUtf8(join(saifctlPath, 'agent.sh'))).toBe('#!/bin/bash\necho run-level');
  });

  // Per-phase-config phase 7.3 (regression for the 7.3 review F-A finding):
  // stage.sh must be rewritten on every transition for the same reason as
  // agent.sh — the staging container reads it from the bind-mount fresh
  // each `runStagingTestVerification` call (per subtask). A
  // previously-overridden stage.sh would otherwise leak into a non-
  // overriding phase's staging tests.
  it('overwrites a previously-overridden stage.sh with the run-level fallback on the next transition', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    const saifctlPath = join(base, 'saifctl');
    await mkdir(saifctlPath, { recursive: true });

    await updateSandboxSubtaskScripts({
      saifctlPath,
      gateScript: 'g',
      agentScript: 'a',
      stageScript: '#!/bin/bash\necho phase-a-stage',
      subtaskEnv: {},
    });
    expect(await readUtf8(join(saifctlPath, 'stage.sh'))).toBe('#!/bin/bash\necho phase-a-stage');

    await updateSandboxSubtaskScripts({
      saifctlPath,
      gateScript: 'g',
      agentScript: 'a',
      stageScript: '#!/bin/bash\necho run-level-stage',
      subtaskEnv: {},
    });
    expect(await readUtf8(join(saifctlPath, 'stage.sh'))).toBe('#!/bin/bash\necho run-level-stage');
  });
});

describe('prepareSubtaskSignalDir', () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it('creates .saifctl under code/ when missing', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code'), { recursive: true });

    await prepareSubtaskSignalDir(base);

    expect(await pathExists(join(base, 'code', '.saifctl'))).toBe(true);
  });

  it('removes stale signal files when present; does not throw when absent', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    const workspace = join(base, 'code');
    await mkdir(join(workspace, '.saifctl'), { recursive: true });
    await writeFile(subtaskDonePath(workspace), '0', 'utf8');
    await writeFile(subtaskExitPath(workspace), '', 'utf8');
    await writeFile(subtaskNextPath(workspace), 'x', 'utf8');
    await writeFile(subtaskRetriesPath(workspace), '3', 'utf8');

    await prepareSubtaskSignalDir(base);

    expect(await pathExists(subtaskDonePath(workspace))).toBe(false);
    expect(await pathExists(subtaskExitPath(workspace))).toBe(false);
    expect(await pathExists(subtaskNextPath(workspace))).toBe(false);
    expect(await pathExists(subtaskRetriesPath(workspace))).toBe(false);
  });
});

describe('writeSubtaskNextPrompt', () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it('writes exact content and creates parent dirs', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code'), { recursive: true });

    await writeSubtaskNextPrompt(base, 'next task body\nline2');

    const p = subtaskNextPath(join(base, 'code'));
    expect(await readUtf8(p)).toBe('next task body\nline2');
  });
});

describe('writeSubtaskRetriesOverride', () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it('writes stringified integer', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code'), { recursive: true });

    await writeSubtaskRetriesOverride(base, 7);

    expect(await readUtf8(subtaskRetriesPath(join(base, 'code')))).toBe('7');
  });
});

describe('writeSubtaskExitSignal', () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it('creates exit marker file', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code'), { recursive: true });

    await writeSubtaskExitSignal(base);

    const p = subtaskExitPath(join(base, 'code'));
    expect(await pathExists(p)).toBe(true);
    expect(await readUtf8(p)).toBe('');
  });
});

describe('pollSubtaskDone', () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it('resolves with exitCode 0 when file contains 0', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code', '.saifctl'), { recursive: true });
    const donePath = subtaskDonePath(join(base, 'code'));
    const ac = new AbortController();

    setTimeout(() => {
      void writeFile(donePath, '0', 'utf8');
    }, 30);

    const result = await pollSubtaskDone(base, ac.signal, 20);
    expect(result).toEqual({ exitCode: 0 });
    expect(await pathExists(donePath)).toBe(false);
  });

  it('resolves with exitCode 1 when file contains 1', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code', '.saifctl'), { recursive: true });
    const donePath = subtaskDonePath(join(base, 'code'));
    const ac = new AbortController();

    setTimeout(() => {
      void writeFile(donePath, '1', 'utf8');
    }, 30);

    const result = await pollSubtaskDone(base, ac.signal, 20);
    expect(result).toEqual({ exitCode: 1 });
    expect(await pathExists(donePath)).toBe(false);
  });

  it('resolves with exitCode 1 for non-integer content', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code', '.saifctl'), { recursive: true });
    const donePath = subtaskDonePath(join(base, 'code'));
    const ac = new AbortController();

    setTimeout(() => {
      void writeFile(donePath, 'not-a-number', 'utf8');
    }, 30);

    const result = await pollSubtaskDone(base, ac.signal, 20);
    expect(result).toEqual({ exitCode: 1 });
  });

  it('rejects when signal aborted before file appears', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code'), { recursive: true });
    const ac = new AbortController();

    const p = pollSubtaskDone(base, ac.signal, 20);
    ac.abort();

    await expect(p).rejects.toThrow(/aborted/);
  });

  it('rejects immediately when signal already aborted at call time', async () => {
    base = await mkdtemp(join(tmpdir(), 'saif-subtask-'));
    await mkdir(join(base, 'code'), { recursive: true });
    const ac = new AbortController();
    ac.abort();

    await expect(pollSubtaskDone(base, ac.signal, 20)).rejects.toThrow(/already aborted/);
  });
});
