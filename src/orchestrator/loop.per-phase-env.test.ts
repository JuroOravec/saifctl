/**
 * Loop-level integration tests for the per-phase-config phase 7.4
 * Level-1.5 env file.
 *
 * The loop-side use of `computeSubtaskEnv` + `buildSubtaskEnvShadowKeys`
 * has one job: turn a sequence of subtasks (run-level baseline + per-
 * phase overrides) into a sequence of `subtask-env.sh` contents that
 * never leak state across phase boundaries. The unit tests in
 * `per-subtask-env.test.ts` pin the resolver in isolation; this file
 * pins the cross-subtask transitions the loop actually produces.
 *
 * Per-phase-config 7.4 review F-C: the spec required a test like this
 * by name. Without it, the F-A pattern (override leaks into a non-
 * overriding subsequent phase) ships silently — the unit tests cover
 * "phase A's override applies" but not "phase B inherits the run-level
 * baseline correctly". Cross-phase transition is the load-bearing case.
 */

import { describe, expect, it } from 'vitest';

import {
  buildSubtaskEnvShadowKeys,
  computeSubtaskEnv,
  type SubtaskEnvBaseline,
  type SubtaskWithLevel1_5Overrides,
} from './per-subtask-env.js';

const baseline: SubtaskEnvBaseline = {
  agentEnv: { RUN_LEVEL: 'baseline' },
  agentSecretKeys: ['EXISTING_SECRET'],
  llm: { globalModel: 'anthropic/claude-haiku-4-5' },
  reviewerEnabled: true,
  hostEnv: {
    EXISTING_SECRET: 'baseline-secret-value',
    OPENAI_API_KEY: 'opa-host',
    GITHUB_TOKEN: 'gh-token',
  },
};

/**
 * Resolve a sequence of subtasks the way the loop does — baseline +
 * shadow-keys computed once, then `computeSubtaskEnv` per subtask. The
 * returned array is parallel to `subtasks`, indexed by position.
 */
function resolveSequence(
  subtasks: readonly SubtaskWithLevel1_5Overrides[],
): { active: SubtaskWithLevel1_5Overrides; resolved: Record<string, string | null> }[] {
  const shadowKeys = buildSubtaskEnvShadowKeys({ baseline, subtasks });
  return subtasks.map((active) => ({
    active,
    resolved: computeSubtaskEnv({ active, baseline, shadowKeys }),
  }));
}

describe('loop integration — per-phase env across subtasks', () => {
  // F-A is the exact pattern this suite exists to pin. Each test maps
  // directly to one of the cross-phase transition shapes the unit
  // tests can't cover (because they don't know about sibling subtasks).

  it('phase A overrides agent.env; phase B reverts to baseline (no leak)', () => {
    const phaseA: SubtaskWithLevel1_5Overrides = {
      agentEnv: { RUN_LEVEL: 'phase-a-override' },
    };
    const phaseB: SubtaskWithLevel1_5Overrides = {};
    const [a, b] = resolveSequence([phaseA, phaseB]);

    expect(a?.resolved.RUN_LEVEL).toBe('phase-a-override');
    expect(b?.resolved.RUN_LEVEL).toBe('baseline');
  });

  it('phase A adds a phase-only key; phase B emits unset (no leak)', () => {
    const phaseA: SubtaskWithLevel1_5Overrides = {
      agentEnv: { PHASE_A_VAR: 'a-value' },
    };
    const phaseB: SubtaskWithLevel1_5Overrides = {};
    const [a, b] = resolveSequence([phaseA, phaseB]);

    expect(a?.resolved.PHASE_A_VAR).toBe('a-value');
    // Without the shadow-keys sweep, phase B's file would be empty and
    // phase A's `export PHASE_A_VAR='a-value'` would persist in the
    // long-lived shell. The sweep emits `null` here so the file
    // contains `unset PHASE_A_VAR` — bringing the shell back.
    expect(b?.resolved.PHASE_A_VAR).toBeNull();
  });

  it('phase A disables the reviewer; phase B reverts to the baseline-enabled value', () => {
    const phaseA: SubtaskWithLevel1_5Overrides = { reviewerEnabled: false };
    const phaseB: SubtaskWithLevel1_5Overrides = {};
    const [a, b] = resolveSequence([phaseA, phaseB]);

    expect(a?.resolved.SAIFCTL_REVIEWER_ENABLED).toBeNull();
    expect(b?.resolved.SAIFCTL_REVIEWER_ENABLED).toBe('1');
  });

  it('phase A overrides the model; phase B reverts to the baseline model', () => {
    const phaseA: SubtaskWithLevel1_5Overrides = {
      llmOverrides: { globalModel: 'openai/gpt-4o-mini' },
    };
    const phaseB: SubtaskWithLevel1_5Overrides = {};
    const [a, b] = resolveSequence([phaseA, phaseB]);

    expect(a?.resolved.LLM_MODEL).toBe('openai/gpt-4o-mini');
    expect(b?.resolved.LLM_MODEL).toBe('anthropic/claude-haiku-4-5');
  });

  it('phase A pulls in a per-phase secret; phase B does not (and emits unset for the phase secret)', () => {
    const phaseA: SubtaskWithLevel1_5Overrides = {
      agentSecretKeys: ['OPENAI_API_KEY'],
    };
    const phaseB: SubtaskWithLevel1_5Overrides = {};
    const [a, b] = resolveSequence([phaseA, phaseB]);

    expect(a?.resolved.OPENAI_API_KEY).toBe('opa-host');
    // Shadow-keys sweep clears the phase-A-only secret out of phase B's
    // shell — the bind-mounted env file is the source of truth.
    expect(b?.resolved.OPENAI_API_KEY).toBeNull();
  });

  it('three-phase sequence: A adds VAR, B overrides VAR, C drops both back to baseline', () => {
    const phaseA: SubtaskWithLevel1_5Overrides = { agentEnv: { TEMP: 'a' } };
    const phaseB: SubtaskWithLevel1_5Overrides = { agentEnv: { TEMP: 'b' } };
    const phaseC: SubtaskWithLevel1_5Overrides = {};
    const [a, b, c] = resolveSequence([phaseA, phaseB, phaseC]);

    expect(a?.resolved.TEMP).toBe('a');
    expect(b?.resolved.TEMP).toBe('b');
    expect(c?.resolved.TEMP).toBeNull(); // unset — neither A nor B leak into C
  });

  it('baseline secrets always re-emit on every subtask (run-level secret survives across phases)', () => {
    const phaseA: SubtaskWithLevel1_5Overrides = {
      agentEnv: { RUN_LEVEL: 'override' },
    };
    const phaseB: SubtaskWithLevel1_5Overrides = {};
    const [a, b] = resolveSequence([phaseA, phaseB]);

    expect(a?.resolved.EXISTING_SECRET).toBe('baseline-secret-value');
    expect(b?.resolved.EXISTING_SECRET).toBe('baseline-secret-value');
  });

  it('shadow-keys do not unset baseline-only keys when no phase touches them', () => {
    // Sanity: the shadow-keys sweep should never `unset` a key the
    // baseline owns when the active subtask omits it — it should
    // re-emit the baseline value via the always-emit path.
    const phaseA: SubtaskWithLevel1_5Overrides = {};
    const [a] = resolveSequence([phaseA]);

    expect(a?.resolved.RUN_LEVEL).toBe('baseline');
    // Reviewer baseline is enabled; emitted as '1', not unset.
    expect(a?.resolved.SAIFCTL_REVIEWER_ENABLED).toBe('1');
  });

  it('rejects arbitrary host vars via agent.secrets (allow-list F-B regression)', () => {
    // A phase declaring `agent.secrets: [HOME]` is a security boundary
    // violation; the resolver must drop the entry rather than copy
    // /Users/... into the bind-mounted env file. Test alongside the
    // per-phase-env tests because the loop is what aggregates the
    // run-level baseline against which the allow-list is evaluated.
    const phaseA: SubtaskWithLevel1_5Overrides = {
      agentSecretKeys: ['HOME', 'OPENAI_API_KEY'],
    };
    const baselineWithHome: SubtaskEnvBaseline = {
      ...baseline,
      hostEnv: { ...baseline.hostEnv, HOME: '/Users/test' },
    };
    const r = computeSubtaskEnv({ active: phaseA, baseline: baselineWithHome });
    expect(r).not.toHaveProperty('HOME');
    expect(r.OPENAI_API_KEY).toBe('opa-host');
  });
});
