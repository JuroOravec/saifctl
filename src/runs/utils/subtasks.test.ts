/**
 * Round-trip tests for {@link runSubtasksFromInputs} / {@link runSubtasksToInputs}.
 *
 * These functions are the manifest ↔ runtime bridge: any field declared on
 * `RunSubtaskInput` must survive the conversion in both directions, otherwise
 * a `run pause` / `run resume` cycle silently drops it. `testScope` (Block 2
 * of TODO_phases_and_critics) is the most recent addition; locking the
 * round-trip here prevents future refactors from regressing it.
 */

import { describe, expect, it } from 'vitest';

import type { RunSubtaskInput } from '../types.js';
import { runSubtasksFromInputs, runSubtasksToInputs } from './subtasks.js';

describe('runSubtasksFromInputs / runSubtasksToInputs', () => {
  it('round-trips testScope through manifest → runtime → manifest', () => {
    const input: RunSubtaskInput = {
      title: 'phase-02-trigger critic A',
      content: 'audit phase 02',
      testScope: {
        include: ['/abs/feat/phases/01-core/tests', '/abs/feat/phases/02-trigger/tests'],
        cumulative: true,
      },
    };

    const runtime = runSubtasksFromInputs([input]);
    expect(runtime[0]?.testScope).toEqual(input.testScope);

    const backToInput = runSubtasksToInputs(runtime);
    expect(backToInput[0]?.testScope).toEqual(input.testScope);
  });

  it('round-trips testScope.cumulative=false (isolated scope)', () => {
    const input: RunSubtaskInput = {
      content: 'spike',
      testScope: { include: ['/abs/feat/phases/00-spike/tests'], cumulative: false },
    };

    const runtime = runSubtasksFromInputs([input]);
    const back = runSubtasksToInputs(runtime);
    expect(back[0]?.testScope?.cumulative).toBe(false);
    expect(back[0]?.testScope?.include).toEqual(input.testScope?.include);
  });

  it('round-trips a mix of scoped and unscoped subtasks (preserves absence)', () => {
    const inputs: RunSubtaskInput[] = [
      { content: 'a', testScope: { include: ['/x/01'] } },
      { content: 'b' }, // no testScope
      { content: 'c', testScope: { include: ['/x/02'] } },
    ];

    const runtime = runSubtasksFromInputs(inputs);
    const back = runSubtasksToInputs(runtime);

    expect(back[0]?.testScope).toEqual({ include: ['/x/01'] });
    expect(back[1]?.testScope).toBeUndefined();
    expect(back[2]?.testScope).toEqual({ include: ['/x/02'] });
  });

  it('round-trips all per-subtask config fields (gateScript, agentEnv, etc.)', () => {
    const input: RunSubtaskInput = {
      title: 'phase-01-core impl',
      content: 'implement core',
      gateScript: '#!/bin/sh\nexit 0',
      agentScript: '#!/bin/sh\necho coder',
      gateRetries: 3,
      reviewerEnabled: true,
      agentEnv: { FOO: 'bar', BAZ: 'qux' },
      testScope: { include: ['/x/01'], cumulative: true },
    };

    const runtime = runSubtasksFromInputs([input]);
    const back = runSubtasksToInputs(runtime);
    expect(back[0]).toEqual(input);
  });

  it('round-trips Block 4 phaseId + criticPrompt metadata', () => {
    const input: RunSubtaskInput = {
      title: 'phase:02-trigger critic:paranoid round:1/2 discover',
      content: 'raw critic body — {{phase.id}} {{phase.baseRef}}',
      phaseId: '02-trigger',
      criticPrompt: {
        criticId: 'paranoid',
        round: 1,
        totalRounds: 2,
        step: 'discover',
        findingsPath: '/workspace/.saifctl/critic-findings/02-trigger--paranoid--r1.md',
        vars: {
          feature: {
            name: 'auth',
            dir: 'saifctl/features/auth',
            plan: '/workspace/saifctl/features/auth/plan.md',
          },
          phase: {
            id: '02-trigger',
            dir: '/workspace/saifctl/features/auth/phases/02-trigger',
            spec: '/workspace/saifctl/features/auth/phases/02-trigger/spec.md',
            tests: '/workspace/saifctl/features/auth/phases/02-trigger/tests',
          },
        },
      },
    };

    const runtime = runSubtasksFromInputs([input]);
    expect(runtime[0]?.phaseId).toBe('02-trigger');
    expect(runtime[0]?.criticPrompt?.criticId).toBe('paranoid');

    const back = runSubtasksToInputs(runtime);
    expect(back[0]).toEqual(input);
  });

  it('round-trips Block 4 phaseId on impl subtasks (no criticPrompt)', () => {
    const input: RunSubtaskInput = {
      title: 'phase:01-core impl',
      content: 'implement core',
      phaseId: '01-core',
    };
    const runtime = runSubtasksFromInputs([input]);
    expect(runtime[0]?.phaseId).toBe('01-core');
    expect(runtime[0]?.criticPrompt).toBeUndefined();
    const back = runSubtasksToInputs(runtime);
    expect(back[0]).toEqual(input);
  });

  // per-phase-config phase 7.5 — round-trip Level-2 fields + the
  // `requiresLevel2RestartFromPrev` flag. These fields persist across
  // `run resume` so a paused multi-phase run picks up the same Level-2
  // values it had before pause.
  it('round-trips per-phase-config v1 Level-2 fields (phase 7.5)', () => {
    const input: RunSubtaskInput = {
      title: 'phase:02-b impl',
      content: 'implement b',
      phaseId: '02-b',
      agentProfileId: 'aider',
      agentInstallScript: '#!/bin/sh\npipx install aider-chat',
      startupScript: '#!/bin/sh\npnpm install',
      cedarScript: 'permit(...)',
      dangerousNoLeash: false,
      requiresLevel2RestartFromPrev: true,
    };
    const runtime = runSubtasksFromInputs([input]);
    expect(runtime[0]?.agentProfileId).toBe('aider');
    expect(runtime[0]?.requiresLevel2RestartFromPrev).toBe(true);
    const back = runSubtasksToInputs(runtime);
    expect(back[0]).toEqual(input);
  });

  // per-phase-config phase 7.4 — round-trip the new Level-1.5 fields
  // (`agentSecretKeys` for additive per-phase secret names; `llmOverrides`
  // for per-phase model / base-url). The pre-existing `agentEnv` /
  // `reviewerEnabled` round-trip is already covered above — phase 7.4
  // wired the runtime-read site, but the manifest fields existed before.
  it('round-trips per-phase-config v1 Level-1.5 fields (phase 7.4)', () => {
    const input: RunSubtaskInput = {
      title: 'phase:01-core impl',
      content: 'implement core',
      phaseId: '01-core',
      agentSecretKeys: ['API_KEY', 'DATABASE_URL'],
      llmOverrides: {
        globalModel: 'openai/gpt-4o-mini',
        globalBaseUrl: 'https://api.openai.com/v1',
      },
    };
    const runtime = runSubtasksFromInputs([input]);
    expect(runtime[0]?.agentSecretKeys).toEqual(['API_KEY', 'DATABASE_URL']);
    expect(runtime[0]?.llmOverrides?.globalModel).toBe('openai/gpt-4o-mini');
    const back = runSubtasksToInputs(runtime);
    expect(back[0]).toEqual(input);
  });

  // per-phase-config phase 7.3 — round-trip every Level-4 field plus
  // tests.none. Every field must survive `run resume`, so a regression in
  // subtasks.ts would silently drop per-phase routing across resumes.
  it('round-trips per-phase-config v1 Level-4 + bypass fields (phase 7.3)', () => {
    const input: RunSubtaskInput = {
      title: 'phase:01-core impl',
      content: 'implement core',
      phaseId: '01-core',
      testProfile: 'pytest',
      testImage: 'my-runner:v1',
      testScript: '#!/bin/sh\nrun-tests',
      stageScript: '#!/bin/sh\nstart-app',
      resolveAmbiguity: 'ai',
      testRetries: 3,
      noRunner: true,
    };
    const runtime = runSubtasksFromInputs([input]);
    expect(runtime[0]?.testProfile).toBe('pytest');
    expect(runtime[0]?.noRunner).toBe(true);
    const back = runSubtasksToInputs(runtime);
    expect(back[0]).toEqual(input);
  });

  // per-phase-config phase 7.5b (level-3-mirror) — round-trip the four
  // Level-3 fields (image / sandbox-profile / engine / compose-file) and
  // the `requiresLevel3RestartFromPrev` flag. Same shape as the Level-2
  // round-trip above; phase 7.5d reads these from the manifest at
  // coder-container creation, so a paused multi-phase run picks up the
  // same Level-3 values it had before pause.
  it('round-trips per-phase-config v1 Level-3 fields (phase 7.5b — level-3-mirror)', () => {
    const input: RunSubtaskInput = {
      title: 'phase:02-b impl',
      content: 'implement b',
      phaseId: '02-b',
      containerImage: 'my-coder:v2',
      containerSandboxProfileId: 'node-pnpm-python',
      containerEngine: 'docker',
      containerComposeFile: 'docker-compose.gpu.yml',
      requiresLevel3RestartFromPrev: true,
    };
    const runtime = runSubtasksFromInputs([input]);
    expect(runtime[0]?.containerImage).toBe('my-coder:v2');
    expect(runtime[0]?.containerEngine).toBe('docker');
    expect(runtime[0]?.requiresLevel3RestartFromPrev).toBe(true);
    const back = runSubtasksToInputs(runtime);
    expect(back[0]).toEqual(input);
  });
});
