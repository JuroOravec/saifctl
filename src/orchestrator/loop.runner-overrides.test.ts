/**
 * Tests for the per-subtask runner-override resolution as the loop calls it.
 *
 * The loop invokes `pickRunnerOptsForSubtask` at three sites (see
 * [loop.ts:1104, 1116, 1733](../orchestrator/loop.ts)) — once when building
 * `testRunnerOpts` for the active subtask, once on test-only mode, and once
 * before each verify. The helper itself is exercised by
 * `runner-overrides.test.ts`; these tests pin the cross-subtask transitions
 * the loop sees: a phase that overrides every runner field, a phase that
 * overrides nothing, and the boundary in between.
 *
 * Per-phase-config phase 7.3 review F-D: the spec specifically asked for
 * this file to pin loop-level precedence so future regressions surface
 * here rather than only via end-to-end feature runs.
 */

import { describe, expect, it } from 'vitest';

import type { RunSubtask } from '../runs/types.js';
import { SUPPORTED_PROFILES } from '../test-profiles/index.js';
import { pickRunnerOptsForSubtask, type RunnerOptsBaseline } from './runner-overrides.js';

const VITEST = SUPPORTED_PROFILES['node-vitest'];
const PYTEST = SUPPORTED_PROFILES['python-pytest'];

const baseline: RunnerOptsBaseline = {
  testProfile: VITEST,
  testImage: 'saifctl-test-node-vitest:latest',
  testScript: 'run-level-test\n',
  stageScript: 'run-level-stage\n',
  resolveAmbiguity: 'ai',
  testRetries: 1,
};

/** Build a minimal RunSubtask shape that the override picker reads from. */
function subtask(over: Partial<RunSubtask>): RunSubtask {
  return {
    id: 'x',
    content: 'task',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('loop integration — pickRunnerOptsForSubtask across phase transitions', () => {
  it('phase A (every runner.* set) ⇒ overrides win across all six fields', () => {
    const phaseA = subtask({
      testProfile: 'python-pytest',
      testImage: 'phase-a-runner:v1',
      testScript: 'phase-a-test\n',
      stageScript: 'phase-a-stage\n',
      resolveAmbiguity: 'prompt',
      testRetries: 7,
    });
    const r = pickRunnerOptsForSubtask({ active: phaseA, runLevel: baseline });
    expect(r.testProfile).toBe(PYTEST);
    expect(r.testImage).toBe('phase-a-runner:v1');
    expect(r.testScript).toBe('phase-a-test\n');
    expect(r.stageScript).toBe('phase-a-stage\n');
    expect(r.resolveAmbiguity).toBe('prompt');
    expect(r.testRetries).toBe(7);
  });

  it('phase B (no overrides) ⇒ every field falls through to the run-level baseline', () => {
    const phaseB = subtask({});
    const r = pickRunnerOptsForSubtask({ active: phaseB, runLevel: baseline });
    expect(r.testProfile).toBe(VITEST);
    expect(r.testImage).toBe('saifctl-test-node-vitest:latest');
    expect(r.testScript).toBe('run-level-test\n');
    expect(r.stageScript).toBe('run-level-stage\n');
    expect(r.resolveAmbiguity).toBe('ai');
    expect(r.testRetries).toBe(1);
  });

  it('phase A → phase B transition: each subtask resolves independently (no leak across boundary)', () => {
    // The runtime calls `pickRunnerOptsForSubtask` per active subtask. The
    // output must reflect ONLY the active subtask + run-level — never any
    // sibling subtask. This is the loop-level analogue of the F-A bug:
    // if the helper accidentally cached a previous override, phase B would
    // inherit phase A's runner config silently.
    const phaseA = subtask({
      testProfile: 'python-pytest',
      stageScript: 'phase-a-stage\n',
      testRetries: 9,
    });
    const phaseB = subtask({});

    const rA = pickRunnerOptsForSubtask({ active: phaseA, runLevel: baseline });
    const rB = pickRunnerOptsForSubtask({ active: phaseB, runLevel: baseline });

    expect(rA.testProfile).toBe(PYTEST);
    expect(rA.stageScript).toBe('phase-a-stage\n');
    expect(rA.testRetries).toBe(9);

    expect(rB.testProfile).toBe(VITEST);
    expect(rB.stageScript).toBe('run-level-stage\n');
    expect(rB.testRetries).toBe(1);
  });

  it('partial override: only test-script set ⇒ other five fall through unchanged', () => {
    const phase = subtask({ testScript: 'phase-only-test\n' });
    const r = pickRunnerOptsForSubtask({ active: phase, runLevel: baseline });
    expect(r.testScript).toBe('phase-only-test\n');
    expect(r.testProfile).toBe(VITEST);
    expect(r.testImage).toBe('saifctl-test-node-vitest:latest');
    expect(r.stageScript).toBe('run-level-stage\n');
    expect(r.resolveAmbiguity).toBe('ai');
    expect(r.testRetries).toBe(1);
  });

  it('noRunner flows independently of the override fields', () => {
    // A phase can declare `tests.none: true` (manifest `noRunner: true`)
    // without setting any other runner.* override; the helper must surface
    // the bypass intent even when nothing else is customized.
    const r = pickRunnerOptsForSubtask({ active: subtask({ noRunner: true }), runLevel: baseline });
    expect(r.noRunner).toBe(true);
    expect(r.testProfile).toBe(VITEST);
    expect(r.stageScript).toBe('run-level-stage\n');
  });
});
