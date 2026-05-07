/**
 * Tests for the per-subtask runner-override resolver
 * (per-phase-config phase 7.3).
 *
 * Pins the merge precedence (subtask wins; otherwise run-level baseline)
 * and the validation paths (`resolveTestProfile` / `validateImageTag`).
 */

import { describe, expect, it } from 'vitest';

import { SUPPORTED_PROFILES } from '../test-profiles/index.js';
import {
  pickActiveSandboxProfileId,
  pickRunnerOptsForSubtask,
  type RunnerOptsBaseline,
} from './runner-overrides.js';

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

describe('pickRunnerOptsForSubtask', () => {
  it('returns the run-level baseline when no active subtask is provided', () => {
    const r = pickRunnerOptsForSubtask({ active: undefined, runLevel: baseline });
    expect(r.testProfile).toBe(VITEST);
    expect(r.testImage).toBe('saifctl-test-node-vitest:latest');
    expect(r.testScript).toBe('run-level-test\n');
    expect(r.stageScript).toBe('run-level-stage\n');
    expect(r.resolveAmbiguity).toBe('ai');
    expect(r.testRetries).toBe(1);
    expect(r.noRunner).toBe(false);
  });

  it('returns the run-level baseline when the subtask declares no overrides', () => {
    const r = pickRunnerOptsForSubtask({ active: {}, runLevel: baseline });
    expect(r.testProfile).toBe(VITEST);
    expect(r.testRetries).toBe(1);
  });

  it('subtask testProfile id is resolved to the registered TestProfile object', () => {
    const r = pickRunnerOptsForSubtask({
      active: { testProfile: 'python-pytest' },
      runLevel: baseline,
    });
    expect(r.testProfile).toBe(PYTEST);
  });

  it('throws when the subtask testProfile id is unknown', () => {
    expect(() =>
      pickRunnerOptsForSubtask({
        active: { testProfile: 'definitely-not-a-real-profile' },
        runLevel: baseline,
      }),
    ).toThrow();
  });

  it('subtask testImage validates and replaces the run-level value', () => {
    const r = pickRunnerOptsForSubtask({
      active: { testImage: 'custom-runner:v2' },
      runLevel: baseline,
    });
    expect(r.testImage).toBe('custom-runner:v2');
  });

  it('subtask values for testScript / stageScript / resolveAmbiguity / testRetries take precedence', () => {
    const r = pickRunnerOptsForSubtask({
      active: {
        testScript: 'phase-test\n',
        stageScript: 'phase-stage\n',
        resolveAmbiguity: 'prompt',
        testRetries: 5,
      },
      runLevel: baseline,
    });
    expect(r.testScript).toBe('phase-test\n');
    expect(r.stageScript).toBe('phase-stage\n');
    expect(r.resolveAmbiguity).toBe('prompt');
    expect(r.testRetries).toBe(5);
  });

  it('surfaces noRunner: true when set on the subtask', () => {
    const r = pickRunnerOptsForSubtask({
      active: { noRunner: true },
      runLevel: baseline,
    });
    expect(r.noRunner).toBe(true);
  });

  it('noRunner defaults to false when omitted on the subtask', () => {
    const r = pickRunnerOptsForSubtask({ active: {}, runLevel: baseline });
    expect(r.noRunner).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5e — review N1: `pickActiveSandboxProfileId`.
// Pin the precedence rule (active subtask wins, fallback to run-level) so a
// regression that drops the override re-introduces N1 (silent half-wired
// `container.sandbox-profile` field).
// ---------------------------------------------------------------------------

describe('pickActiveSandboxProfileId', () => {
  it('returns the run-level baseline when no active subtask is provided', () => {
    expect(pickActiveSandboxProfileId({ active: undefined, runLevel: 'node-pnpm' })).toBe(
      'node-pnpm',
    );
  });

  it('returns the run-level baseline when the active subtask did not override', () => {
    expect(pickActiveSandboxProfileId({ active: {}, runLevel: 'node-pnpm' })).toBe('node-pnpm');
  });

  it('returns the active subtask override when set (per-phase wins over run-level)', () => {
    expect(
      pickActiveSandboxProfileId({
        active: { containerSandboxProfileId: 'python-pytest' },
        runLevel: 'node-pnpm',
      }),
    ).toBe('python-pytest');
  });

  it('treats an undefined-typed override as no override (back-compat with optional field)', () => {
    expect(
      pickActiveSandboxProfileId({
        active: { containerSandboxProfileId: undefined },
        runLevel: 'node-pnpm',
      }),
    ).toBe('node-pnpm');
  });
});
