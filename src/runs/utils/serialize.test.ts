/**
 * Tests for {@link serializeArtifactConfig} / {@link deserializeArtifactConfig}
 * — focused on the agent-options snapshot persisted on the artifact so
 * `run start <id>` / `run resume <id>` replay with the exact options the
 * run was started with, regardless of how `saifctl/config.ts` evolves.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGitProvider } from '../../git/index.js';
import type { IterativeLoopOpts } from '../../orchestrator/loop.js';
import { resolveTestProfile } from '../../test-profiles/index.js';
import {
  deserializeArtifactConfig,
  type PersistedScriptBundle,
  serializeArtifactConfig,
} from './serialize.js';

function minimalLoopOpts(
  overrides: Partial<IterativeLoopOpts & PersistedScriptBundle> = {},
): IterativeLoopOpts & PersistedScriptBundle {
  return {
    sandboxProfileId: 'node-pnpm-python',
    agentProfileId: 'openhands',
    feature: {
      name: 'x',
      absolutePath: '/tmp/saifctl/features/x',
      relativePath: 'saifctl/features/x',
    },
    projectDir: '/tmp',
    maxRuns: 5,
    llm: {},
    saifctlDir: 'saifctl',
    projectName: 'test',
    testImage: 'test:latest',
    resolveAmbiguity: 'ai',
    runTimeoutMs: null,
    subtaskTimeoutMs: 60 * 60 * 1000,
    dangerousNoLeash: false,
    cedarPolicyPath: '',
    cedarScript: '',
    coderImage: '',
    push: null,
    pr: false,
    targetBranch: null,
    gitProvider: getGitProvider('github'),
    gateRetries: 10,
    agentEnv: {},
    agentSecretKeys: [],
    agentSecretFiles: [],
    testScript: 'test',
    testProfile: resolveTestProfile('node-vitest'),
    testRetries: 1,
    reviewerEnabled: true,
    includeDirty: false,
    strict: true,
    stagingEnvironment: {
      engine: 'docker',
      app: { sidecarPort: 8080, sidecarPath: '/exec' },
      appEnvironment: {},
    },
    codingEnvironment: { engine: 'docker' },
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
    subtasks: [{ content: 'test task', title: 'x' }],
    currentSubtaskIndex: 0,
    enableSubtaskSequence: false,
    ...overrides,
  };
}

describe('serializeArtifactConfig — agentOptions snapshot', () => {
  // The claude profile declares `max` (boolean, default false) and
  // `credentials` (string, no default) — used here as a real-world
  // profile with options to exercise the snapshot path.
  const trackedEnvKeys = [
    'SAIFCTL_AGENT_OPT_CLAUDE_MAX',
    'SAIFCTL_AGENT_OPT_CLAUDE_CREDENTIALS',
    'SAIFCTL_AGENT_OPT_OPENHANDS_FOO',
  ];

  beforeEach(() => {
    for (const k of trackedEnvKeys) delete process.env[k];
  });
  afterEach(() => {
    for (const k of trackedEnvKeys) delete process.env[k];
  });

  it('captures resolved profile options into agentOptions[profileId]', () => {
    process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX = 'true';
    process.env.SAIFCTL_AGENT_OPT_CLAUDE_CREDENTIALS = '/home/u/team-claude.json';

    const serialized = serializeArtifactConfig(minimalLoopOpts({ agentProfileId: 'claude' }));

    expect(serialized.agentOptions).toEqual({
      claude: {
        max: true,
        credentials: '/home/u/team-claude.json',
      },
    });
  });

  it('captures profile defaults even when env vars are unset', () => {
    // No CLI / config values set — claude's `max: false` default should
    // still land in the snapshot so replay is fully deterministic.
    const serialized = serializeArtifactConfig(minimalLoopOpts({ agentProfileId: 'claude' }));

    expect(serialized.agentOptions).toEqual({ claude: { max: false } });
  });

  it('omits agentOptions when the profile declares no options', () => {
    // openhands has no declared options at the time of writing.
    const serialized = serializeArtifactConfig(minimalLoopOpts({ agentProfileId: 'openhands' }));
    expect(serialized.agentOptions).toBeUndefined();
  });

  it('round-trips agentOptions through deserialize', () => {
    process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX = 'true';
    process.env.SAIFCTL_AGENT_OPT_CLAUDE_CREDENTIALS = '/p.json';

    const serialized = serializeArtifactConfig(minimalLoopOpts({ agentProfileId: 'claude' }));
    const deserialized = deserializeArtifactConfig(serialized);

    expect(deserialized.agentOptions).toEqual({
      claude: { max: true, credentials: '/p.json' },
    });
  });

  it('deserialize is robust to artifacts predating the field', () => {
    const serialized = serializeArtifactConfig(minimalLoopOpts({ agentProfileId: 'claude' }));
    // Simulate an old artifact: drop agentOptions entirely.
    const { agentOptions: _agentOptions, ...legacy } = serialized;
    const deserialized = deserializeArtifactConfig(legacy);
    expect(deserialized.agentOptions).toBeUndefined();
  });
});
