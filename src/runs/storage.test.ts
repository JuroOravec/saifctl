import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRunStorage } from './storage.js';
import { type RunArtifact, StaleArtifactError } from './types.js';

const dummyArtifact: RunArtifact = {
  runId: 'test-1',
  baseCommitSha: 'abc123',
  runPatchSteps: [{ message: 'm', diff: 'diff' }],
  specRef: 'saifac/features/x',
  config: {
    featureName: 'x',
    gitProviderId: 'github',
    testProfileId: 'vitest',
    sandboxProfileId: 'vitest',
    agentProfileId: 'openhands',
    projectDir: '/tmp',
    maxRuns: 5,
    overrides: {},
    saifDir: 'saifac',
    projectName: 'test',
    testImage: 'test:latest',
    resolveAmbiguity: 'ai',
    dangerousDebug: false,
    dangerousNoLeash: false,
    cedarPolicyPath: '',
    coderImage: '',
    push: null,
    pr: false,
    gateRetries: 10,
    reviewerEnabled: true,
    agentEnv: {},
    agentLogFormat: 'openhands',
    testScript: 'test',
    gateScript: '#',
    startupScript: '#',
    agentInstallScript: '#',
    agentScript: '#',
    stageScript: '#',
    startupScriptFile: 's/startup.sh',
    gateScriptFile: 's/gate.sh',
    stageScriptFile: 's/stage.sh',
    testScriptFile: 's/test.sh',
    agentInstallScriptFile: 's/agent-install.sh',
    agentScriptFile: 's/agent.sh',
    testRetries: 1,
    stagingEnvironment: {
      provisioner: 'docker',
      app: { sidecarPort: 8080, sidecarPath: '/exec' },
      appEnvironment: {},
    },
    codingEnvironment: {
      provisioner: 'docker',
    },
  },
  status: 'failed',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('createRunStorage', () => {
  it('returns null for none', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'saifac-'));
    try {
      expect(createRunStorage('none', tmp)).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns RunsStorage for local', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'saifac-'));
    try {
      const storage = createRunStorage('local', tmp);
      expect(storage).not.toBeNull();
      await storage!.saveRun('run-1', { ...dummyArtifact, runId: 'run-1' });
      const got = await storage!.getRun('run-1');
      expect(got?.runId).toBe('run-1');
      expect(got?.artifactRevision).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('increments artifactRevision on each save and preserves startedAt', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'saifac-'));
    try {
      const storage = createRunStorage('local', tmp)!;
      const t0 = '2026-01-01T12:00:00.000Z';
      await storage.saveRun('run-1', {
        ...dummyArtifact,
        runId: 'run-1',
        startedAt: t0,
        updatedAt: t0,
      });
      const r1 = await storage.getRun('run-1');
      expect(r1?.artifactRevision).toBe(1);
      expect(r1?.startedAt).toBe(t0);

      const t1 = '2026-01-02T12:00:00.000Z';
      await storage.saveRun('run-1', {
        ...dummyArtifact,
        runId: 'run-1',
        runPatchSteps: [{ message: 'm', diff: 'updated' }],
        startedAt: t1,
        updatedAt: t1,
      });
      const r2 = await storage.getRun('run-1');
      expect(r2?.artifactRevision).toBe(2);
      expect(r2?.startedAt).toBe(t0);
      expect(r2?.runPatchSteps).toEqual([{ message: 'm', diff: 'updated' }]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('saveRun with ifRevisionEquals succeeds when revision matches', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'saifac-'));
    try {
      const storage = createRunStorage('local', tmp)!;
      await storage.saveRun('run-1', { ...dummyArtifact, runId: 'run-1' });
      expect((await storage.getRun('run-1'))?.artifactRevision).toBe(1);

      await storage.saveRun(
        'run-1',
        { ...dummyArtifact, runId: 'run-1', runPatchSteps: [{ message: 'm', diff: 'v2' }] },
        { ifRevisionEquals: 1 },
      );
      expect((await storage.getRun('run-1'))?.artifactRevision).toBe(2);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('saveRun with ifRevisionEquals throws StaleArtifactError on mismatch', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'saifac-'));
    try {
      const storage = createRunStorage('local', tmp)!;
      await storage.saveRun('run-1', { ...dummyArtifact, runId: 'run-1' });
      await expect(
        storage.saveRun(
          'run-1',
          { ...dummyArtifact, runId: 'run-1', runPatchSteps: [{ message: 'm', diff: 'stale' }] },
          { ifRevisionEquals: 0 },
        ),
      ).rejects.toThrow(StaleArtifactError);
      expect((await storage.getRun('run-1'))?.artifactRevision).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns RunsStorage for file URI with custom base path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'saifac-'));
    const customBase = join(tmp, 'custom-base');
    try {
      const storage = createRunStorage(`file://${customBase}`, tmp);
      expect(storage).not.toBeNull();
      await storage!.saveRun('run-1', { ...dummyArtifact, runId: 'run-1' });
      const got = await storage!.getRun('run-1');
      expect(got?.runId).toBe('run-1');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('listRuns and clearRuns respect filters', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'saifac-'));
    try {
      const storage = createRunStorage('local', tmp)!;
      await storage.saveRun('run-1', {
        ...dummyArtifact,
        runId: 'run-1',
        status: 'failed',
        taskId: 'task-a',
      });
      await storage.saveRun('run-2', {
        ...dummyArtifact,
        runId: 'run-2',
        status: 'completed',
        taskId: 'task-a',
      });
      await storage.saveRun('run-3', {
        ...dummyArtifact,
        runId: 'run-3',
        status: 'failed',
        taskId: 'task-b',
      });

      const failed = await storage.listRuns({ status: 'failed' });
      expect(failed).toHaveLength(2);
      const taskB = await storage.listRuns({ taskId: 'task-b' });
      expect(taskB).toHaveLength(1);
      expect(taskB[0].runId).toBe('run-3');

      await storage.clearRuns({ status: 'failed' });
      expect(await storage.getRun('run-1')).toBeNull();
      expect(await storage.getRun('run-3')).toBeNull();
      expect(await storage.getRun('run-2')).not.toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
