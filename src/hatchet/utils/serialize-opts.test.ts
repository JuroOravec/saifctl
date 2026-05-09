/**
 * Round-trip tests for the Hatchet wire form of `OrchestratorOpts.fromArtifact`.
 *
 * Per-phase-config phase 7.6 review H1: distributed-mode `run start <id>`
 * MUST carry `seedPhaseAttemptCount` (per-phase outer-attempt counter) and
 * `transitionInProgress` (crashed-transition recovery seed) across the
 * Hatchet wire. Dropping either field on the dispatcher → worker hop
 * silently lets the user reset the budget by re-dispatching, and breaks
 * Level-2/3 crash recovery in distributed mode.
 *
 * These tests pin the minimum: any future refactor that re-extracts the
 * `fromArtifact` projection must preserve both fields.
 */

import { describe, expect, it } from 'vitest';

import type { OrchestratorOpts } from '../../orchestrator/modes.js';
import type { RunTransitionInProgress } from '../../runs/types.js';
import { deserializeOrchestratorOpts, serializeOrchestratorOpts } from './serialize-opts.js';

/**
 * Build the minimum-shape OrchestratorOpts needed to exercise serialize +
 * deserialize. We only assert against fields the round-trip preserves
 * verbatim — see the `expect`s in each test — so cast-through-`unknown`
 * is safe here even though we omit class-instance fields the runtime
 * pipeline normally fills.
 */
function makeOpts(fromArtifact: NonNullable<OrchestratorOpts['fromArtifact']>): OrchestratorOpts {
  const stub: Record<string, unknown> = {
    sandboxProfileId: 'vitest',
    agentProfileId: 'openhands',
    feature: {
      name: 'f',
      absolutePath: '/p/saifctl/features/f',
      relativePath: 'saifctl/features/f',
    },
    projectDir: '/p',
    maxRuns: 5,
    llm: {},
    saifctlDir: 'saifctl',
    projectName: 'p',
    testImage: 't',
    resolveAmbiguity: 'ai',
    runTimeoutMs: null,
    subtaskTimeoutMs: 60_000,
    dangerousNoLeash: false,
    cedarPolicyPath: '',
    cedarScript: '',
    coderImage: 'coder:v1',
    push: null,
    pr: false,
    targetBranch: null,
    gitProvider: { id: 'github' },
    gateRetries: 10,
    agentEnv: {},
    agentSecretKeys: [],
    agentSecretFiles: [],
    testScript: '#',
    testProfile: { id: 'node-vitest' },
    testRetries: 1,
    reviewerEnabled: true,
    allowSaifctlInPatch: false,
    subtasks: [{ content: 'work' }],
    currentSubtaskIndex: 0,
    enableSubtaskSequence: false,
    stagingEnvironment: { engine: 'docker' },
    codingEnvironment: { engine: 'docker' },
    sandboxBaseDir: '/tmp/sb',
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
    runStorage: null,
    fromArtifact,
  };
  return stub as unknown as OrchestratorOpts;
}

function makeFromArtifact(
  over: Partial<NonNullable<OrchestratorOpts['fromArtifact']>> = {},
): NonNullable<OrchestratorOpts['fromArtifact']> {
  return {
    sandboxSourceDir: '/tmp/src',
    runContext: {
      baseCommitSha: 'abc',
      basePatchDiff: '',
      lastErrorFeedback: '',
      rules: [],
    },
    sandboxHostAppliedCommitCount: 0,
    resumedCodingInfra: null,
    ...over,
  } as NonNullable<OrchestratorOpts['fromArtifact']>;
}

describe('serializeOrchestratorOpts ↔ deserializeOrchestratorOpts — fromArtifact wire form', () => {
  describe('per-phase-config phase 7.6 review H1 — seedPhaseAttemptCount round-trip', () => {
    it('preserves a non-empty seedPhaseAttemptCount across serialize/deserialize', () => {
      // A run that's mid-budget on phase-a and just started phase-b. The
      // dispatcher hands this to the worker; the worker MUST see the same
      // counts so the loop's closure seeds from the persisted state and
      // can fail-fast on the next phase-a failure if it reaches the cap.
      const seed = { 'phase-a': 2, 'phase-b': 1 };
      const opts = makeOpts(makeFromArtifact({ seedPhaseAttemptCount: seed }));
      const wire = serializeOrchestratorOpts(opts);
      // Wire form holds the field verbatim:
      expect(wire.fromArtifact?.seedPhaseAttemptCount).toEqual(seed);
      // Worker reconstructs it identically:
      const restored = deserializeOrchestratorOpts(wire as Record<string, unknown>);
      expect(restored.fromArtifact?.seedPhaseAttemptCount).toEqual(seed);
    });

    it('defaults to {} on the worker side when the wire form omits seedPhaseAttemptCount (back-compat)', () => {
      // A pre-7.6 worker dispatching to a 7.6+ worker: the wire form
      // has no `seedPhaseAttemptCount`. The deserializer fills `{}` so
      // the loop's closure starts at zero rather than `undefined`.
      const opts = makeOpts(makeFromArtifact());
      const wire = serializeOrchestratorOpts(opts);
      // Strip the field to simulate a pre-7.6 wire form.
      const wireWithoutSeed: Record<string, unknown> = {
        ...wire,
        fromArtifact: { ...wire.fromArtifact, seedPhaseAttemptCount: undefined },
      };
      const restored = deserializeOrchestratorOpts(wireWithoutSeed);
      expect(restored.fromArtifact?.seedPhaseAttemptCount).toEqual({});
    });
  });

  describe('per-phase-config phase 7.5d/7.5e — transitionInProgress round-trip', () => {
    it('preserves a transitionInProgress snapshot across serialize/deserialize', () => {
      // A run that crashed mid-Level-3 transition: the snapshot lives on
      // the artifact and must reach the worker so its first outer-iteration
      // pass calls `completeControlledRestart` BEFORE booting the next
      // coder container.
      const transitionInProgress: RunTransitionInProgress = {
        toSubtaskIndex: 4,
        costClass: 'level-3',
        fields: ['container.image'],
        startedAt: '2026-05-07T13:00:00.000Z',
      };
      const opts = makeOpts(makeFromArtifact({ transitionInProgress }));
      const wire = serializeOrchestratorOpts(opts);
      expect(wire.fromArtifact?.transitionInProgress).toEqual(transitionInProgress);
      const restored = deserializeOrchestratorOpts(wire as Record<string, unknown>);
      expect(restored.fromArtifact?.transitionInProgress).toEqual(transitionInProgress);
    });

    it('defaults to null on the worker side when the wire form omits transitionInProgress (back-compat)', () => {
      const opts = makeOpts(makeFromArtifact());
      const wire = serializeOrchestratorOpts(opts);
      const wireWithoutTransition: Record<string, unknown> = {
        ...wire,
        fromArtifact: { ...wire.fromArtifact, transitionInProgress: undefined },
      };
      const restored = deserializeOrchestratorOpts(wireWithoutTransition);
      expect(restored.fromArtifact?.transitionInProgress).toBeNull();
    });
  });
});
