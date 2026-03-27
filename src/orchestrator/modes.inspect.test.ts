/**
 * Unit tests for {@link runInspect} — mocked provisioner, sandbox, resume, and I/O.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaifacConfig } from '../config/schema.js';
import { getGitProvider } from '../git/index.js';
import { type RunStorage } from '../runs/storage.js';
import { type RunArtifact, StaleArtifactError } from '../runs/types.js';
import type { Feature } from '../specs/discover.js';
import { resolveTestProfile } from '../test-profiles/index.js';
import type { OrchestratorOpts } from './modes.js';
import type { OrchestratorCliInput } from './options.js';
import type { Sandbox } from './sandbox.js';

const feature: Feature = {
  name: 'my-feat',
  absolutePath: '/tmp/proj/saifac/features/my-feat',
  relativePath: 'saifac/features/my-feat',
};

function makeOrchestratorOpts(): OrchestratorOpts {
  const testProfile = resolveTestProfile('node-vitest');
  const gitProvider = getGitProvider('github');
  return {
    sandboxProfileId: 'node-pnpm-python',
    agentProfileId: 'openhands',
    feature,
    projectDir: '/tmp/proj',
    maxRuns: 5,
    overrides: {},
    saifDir: 'saifac',
    projectName: 'proj',
    sandboxBaseDir: '/tmp/sandboxes',
    testImage: 'test:latest',
    resolveAmbiguity: 'ai',
    testRetries: 1,
    dangerousDebug: false,
    dangerousNoLeash: false,
    cedarPolicyPath: '/policy.cedar',
    coderImage: 'coder:latest',
    push: null,
    pr: false,
    targetBranch: null,
    gateRetries: 10,
    agentEnv: {},
    testScript: 'test',
    testProfile,
    gitProvider,
    reviewerEnabled: false,
    includeDirty: false,
    stagingEnvironment: {
      provisioner: 'docker',
      app: { sidecarPort: 8080, sidecarPath: '/exec' },
      appEnvironment: {},
    },
    codingEnvironment: { provisioner: 'docker' },
    gateScript: '#',
    startupScript: '#',
    agentInstallScript: '#',
    agentScript: '#',
    stageScript: '#',
    startupScriptFile: 'startup.sh',
    gateScriptFile: 'gate.sh',
    stageScriptFile: 'stage.sh',
    testScriptFile: 'test.sh',
    agentInstallScriptFile: 'agent-install.sh',
    agentScriptFile: 'agent.sh',
    runStorage: null,
    resume: null,
    patchExclude: undefined,
    verbose: false,
  };
}

const baseArtifact: RunArtifact = {
  runId: 'run-inspect-1',
  baseCommitSha: 'abc123',
  runCommits: [{ message: 'saifac: coding attempt 1', diff: 'original patch\n' }],
  specRef: 'saifac/features/my-feat',
  rules: [],
  config: {
    featureName: 'my-feat',
    gitProviderId: 'github',
    testProfileId: 'node-vitest',
    sandboxProfileId: 'node-pnpm-python',
    agentProfileId: 'openhands',
    projectDir: '/tmp/proj',
    maxRuns: 5,
    overrides: {},
    saifDir: 'saifac',
    projectName: 'proj',
    testImage: 'test:latest',
    resolveAmbiguity: 'ai',
    dangerousDebug: false,
    dangerousNoLeash: false,
    cedarPolicyPath: '',
    coderImage: '',
    push: null,
    pr: false,
    targetBranch: null,
    includeDirty: false,
    gateRetries: 10,
    reviewerEnabled: true,
    agentEnv: {},
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

const sandbox: Sandbox = {
  runId: 'sb-run1',
  sandboxBasePath: '/tmp/saifac/sandboxes/proj-my-feat-sb-run1',
  codePath: '/tmp/saifac/sandboxes/proj-my-feat-sb-run1/code',
  gatePath: '/tmp/saifac/sandboxes/proj-my-feat-sb-run1/gate.sh',
  hostBasePatchPath: '',
  startupPath: '/tmp/saifac/sandboxes/proj-my-feat-sb-run1/startup.sh',
  agentInstallPath: '/tmp/saifac/sandboxes/proj-my-feat-sb-run1/agent-install.sh',
  agentPath: '/tmp/saifac/sandboxes/proj-my-feat-sb-run1/agent.sh',
  stagePath: '/tmp/saifac/sandboxes/proj-my-feat-sb-run1/stage.sh',
};

const {
  createResumeWorktreeMock,
  cleanupResumeWorkspaceMock,
  createSandboxMock,
  destroySandboxMock,
  extractIncrementalRoundPatchMock,
  createProvisionerMock,
  resolveFeatureMock,
  resolveOrchestratorOptsMock,
  writeUtf8Mock,
  mockProvisioner,
} = vi.hoisted(() => {
  const setup = vi.fn().mockResolvedValue(undefined);
  const teardown = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const startInspect = vi.fn().mockResolvedValue({
    containerName: 'leash-target-test',
    workspacePath: '/workspace',
    stop,
  });
  const mockProvisioner = { setup, teardown, startInspect };
  return {
    createResumeWorktreeMock: vi.fn(),
    cleanupResumeWorkspaceMock: vi.fn().mockResolvedValue(undefined),
    createSandboxMock: vi.fn(),
    destroySandboxMock: vi.fn().mockResolvedValue(undefined),
    extractIncrementalRoundPatchMock: vi.fn(),
    createProvisionerMock: vi.fn(() => mockProvisioner),
    resolveFeatureMock: vi.fn(),
    resolveOrchestratorOptsMock: vi.fn(),
    writeUtf8Mock: vi.fn().mockResolvedValue(undefined),
    mockProvisioner,
  };
});

vi.mock('./resume.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createResumeWorktree: createResumeWorktreeMock,
    cleanupResumeWorkspace: cleanupResumeWorkspaceMock,
  };
});

vi.mock('./sandbox.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSandbox: createSandboxMock,
    destroySandbox: destroySandboxMock,
    extractIncrementalRoundPatch: extractIncrementalRoundPatchMock,
  };
});

vi.mock('../provisioners/index.js', () => ({
  createProvisioner: createProvisionerMock,
}));

vi.mock('../specs/discover.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveFeature: resolveFeatureMock,
  };
});

vi.mock('./options.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveOrchestratorOpts: resolveOrchestratorOptsMock,
  };
});

vi.mock('../utils/io.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeUtf8: writeUtf8Mock,
  };
});

vi.mock('./sidecars/reviewer/argus.js', () => ({
  getArgusBinaryPath: vi.fn().mockResolvedValue('/tmp/argus'),
}));

vi.mock('../utils/git.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    git: vi.fn().mockResolvedValue('pretestheadsha\n'),
  };
});

vi.mock('../llm-config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveAgentLlmConfig: vi.fn().mockReturnValue({
      modelId: 'claude-3-5-sonnet-latest',
      provider: 'anthropic',
      fullModelString: 'anthropic/claude-3-5-sonnet-latest',
      apiKey: 'test-key',
    }),
  };
});

vi.mock('./loop.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    buildInitialTask: vi.fn().mockResolvedValue('initial task'),
    logIterativeLoopSettings: vi.fn(),
  };
});

describe('runInspect', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'saifac-inspect-'));
    vi.clearAllMocks();
    createResumeWorktreeMock.mockResolvedValue({
      worktreePath: join(projectDir, 'wt'),
      branchName: 'saifac-resume-run-inspect-1',
      baseSnapshotPath: join(projectDir, 'base-snap'),
    });
    createSandboxMock.mockResolvedValue(sandbox);
    resolveFeatureMock.mockResolvedValue(feature);
    resolveOrchestratorOptsMock.mockImplementation(async () => makeOrchestratorOpts());
    extractIncrementalRoundPatchMock.mockResolvedValue({
      patch: '',
      patchPath: join(sandbox.sandboxBasePath, 'patch.diff'),
      commits: [],
    });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function importRunInspect() {
    const { runInspect } = await import('./modes.js');
    return runInspect;
  }

  async function finishWithSigint() {
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        process.emit('SIGINT');
        resolve();
      });
    });
  }

  function makeStorage(
    overrides: {
      getRun?: ReturnType<typeof vi.fn>;
      saveRun?: ReturnType<typeof vi.fn>;
      setStatusRunning?: ReturnType<typeof vi.fn>;
    } = {},
  ) {
    return {
      uri: 'mock',
      getRun:
        overrides.getRun ??
        vi.fn().mockResolvedValue({ ...baseArtifact, runId: baseArtifact.runId }),
      saveRun: overrides.saveRun ?? vi.fn().mockResolvedValue(undefined),
      setStatusRunning: overrides.setStatusRunning ?? vi.fn().mockResolvedValue(1),
      listRuns: vi.fn(),
      deleteRun: vi.fn(),
      clearRuns: vi.fn(),
    } as unknown as RunStorage;
  }

  it('throws when run storage is null', async () => {
    const runInspect = await importRunInspect();
    await expect(
      runInspect({
        runId: 'x',
        projectDir,
        saifDir: 'saifac',
        config: {} as SaifacConfig,
        runStorage: null as unknown as RunStorage,
        cli: {} as unknown as OrchestratorCliInput,
        cliModelDelta: undefined,
      }),
    ).rejects.toThrow(/run storage/i);
  });

  it('passes dangerousNoLeash false to startInspect when inspectLeash is true', async () => {
    const runInspect = await importRunInspect();
    const storage = makeStorage();
    const p = runInspect({
      runId: baseArtifact.runId,
      projectDir,
      saifDir: 'saifac',
      config: {} as SaifacConfig,
      runStorage: storage,
      cli: {} as unknown as OrchestratorCliInput,
      cliModelDelta: undefined,
      inspectLeash: true,
    });
    await finishWithSigint();
    await p;

    expect(mockProvisioner.startInspect).toHaveBeenCalledWith(
      expect.objectContaining({ dangerousNoLeash: false }),
    );
  });

  it('throws when run is not found', async () => {
    const runInspect = await importRunInspect();
    const storage = makeStorage({ getRun: vi.fn().mockResolvedValue(null) });
    await expect(
      runInspect({
        runId: 'missing',
        projectDir,
        saifDir: 'saifac',
        config: {} as SaifacConfig,
        runStorage: storage,
        cli: {} as unknown as OrchestratorCliInput,
        cliModelDelta: undefined,
      }),
    ).rejects.toThrow(/Run not found/);
  });

  it('throws when stored run status is running', async () => {
    const runInspect = await importRunInspect();
    const storage = makeStorage({
      getRun: vi.fn().mockResolvedValue({ ...baseArtifact, status: 'running' }),
    });
    await expect(
      runInspect({
        runId: baseArtifact.runId,
        projectDir,
        saifDir: 'saifac',
        config: {} as SaifacConfig,
        runStorage: storage,
        cli: {} as unknown as OrchestratorCliInput,
        cliModelDelta: undefined,
      }),
    ).rejects.toThrow(/already running/);
  });

  it('creates worktree and sandbox, then on SIGINT skips save when patch unchanged', async () => {
    const runInspect = await importRunInspect();
    const storage = makeStorage();
    const p = runInspect({
      runId: baseArtifact.runId,
      projectDir,
      saifDir: 'saifac',
      config: {} as SaifacConfig,
      runStorage: storage,
      cli: {} as unknown as OrchestratorCliInput,
      cliModelDelta: undefined,
    });
    await finishWithSigint();
    await p;

    expect(createResumeWorktreeMock).toHaveBeenCalled();
    expect(createSandboxMock).toHaveBeenCalled();
    expect(mockProvisioner.setup).toHaveBeenCalled();
    expect(mockProvisioner.startInspect).toHaveBeenCalledWith(
      expect.objectContaining({ dangerousNoLeash: true }),
    );
    expect(storage.saveRun).not.toHaveBeenCalled();
    expect(destroySandboxMock).toHaveBeenCalledWith(sandbox.sandboxBasePath);
    expect(cleanupResumeWorkspaceMock).toHaveBeenCalled();
  });

  it('calls saveRun with ifRevisionEquals when patch changes', async () => {
    const runInspect = await importRunInspect();
    const artifact = {
      ...baseArtifact,
      artifactRevision: 2,
      runCommits: [] as RunArtifact['runCommits'],
    };
    const storage = makeStorage({
      getRun: vi.fn().mockResolvedValue(artifact),
    });
    const newStep = {
      message: 'saifac: inspect session',
      diff: 'new patch content\n',
      author: 'saifac <saifac@safeaifactory.com>',
    };
    extractIncrementalRoundPatchMock.mockResolvedValue({
      patch: 'new patch content\n',
      patchPath: join(sandbox.sandboxBasePath, 'patch.diff'),
      commits: [newStep],
    });

    const p = runInspect({
      runId: artifact.runId,
      projectDir,
      saifDir: 'saifac',
      config: {} as SaifacConfig,
      runStorage: storage,
      cli: {} as unknown as OrchestratorCliInput,
      cliModelDelta: undefined,
    });
    await finishWithSigint();
    await p;

    expect(storage.saveRun).toHaveBeenCalledTimes(1);
    expect(storage.saveRun).toHaveBeenCalledWith(
      artifact.runId,
      expect.objectContaining({
        runCommits: [newStep],
      }),
      { ifRevisionEquals: 2 },
    );
  });

  it('writes fallback json file on StaleArtifactError', async () => {
    const runInspect = await importRunInspect();
    const artifact = {
      ...baseArtifact,
      artifactRevision: 1,
      runCommits: [] as RunArtifact['runCommits'],
    };
    const storage = makeStorage({
      getRun: vi.fn().mockResolvedValue(artifact),
      saveRun: vi.fn().mockRejectedValue(
        new StaleArtifactError({
          runId: artifact.runId,
          expectedRevision: 1,
          actualRevision: 3,
        }),
      ),
    });
    const staleStep = {
      message: 'saifac: inspect session',
      diff: 'conflict patch\n',
      author: 'saifac <saifac@safeaifactory.com>',
    };
    extractIncrementalRoundPatchMock.mockResolvedValue({
      patch: 'conflict patch\n',
      patchPath: join(sandbox.sandboxBasePath, 'patch.diff'),
      commits: [staleStep],
    });

    const p = runInspect({
      runId: artifact.runId,
      projectDir,
      saifDir: 'saifac',
      config: {} as SaifacConfig,
      runStorage: storage,
      cli: {} as unknown as OrchestratorCliInput,
      cliModelDelta: undefined,
    });
    await finishWithSigint();
    await p;

    expect(writeUtf8Mock).toHaveBeenCalledWith(
      join(projectDir, `.saifac-inspect-stale-${artifact.runId}.json`),
      JSON.stringify([staleStep]),
    );
  });

  it('rethrows non-stale save errors after cleanup', async () => {
    const runInspect = await importRunInspect();
    const artifact = {
      ...baseArtifact,
      runCommits: [{ message: 'm', diff: 'a\n' }],
    };
    const diskError = new Error('disk full');
    const storage = makeStorage({
      getRun: vi.fn().mockResolvedValue(artifact),
      saveRun: vi.fn().mockRejectedValue(diskError),
    });
    extractIncrementalRoundPatchMock.mockResolvedValue({
      patch: 'b\n',
      patchPath: join(sandbox.sandboxBasePath, 'patch.diff'),
      commits: [{ message: 'saifac: inspect session', diff: 'b\n' }],
    });

    const p = runInspect({
      runId: artifact.runId,
      projectDir,
      saifDir: 'saifac',
      config: {} as SaifacConfig,
      runStorage: storage,
      cli: {} as unknown as OrchestratorCliInput,
      cliModelDelta: undefined,
    });
    await finishWithSigint();
    await expect(p).rejects.toThrow('disk full');

    expect(destroySandboxMock).toHaveBeenCalled();
    expect(cleanupResumeWorkspaceMock).toHaveBeenCalled();
  });
});
