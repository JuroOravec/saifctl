/**
 * Tests for the per-subtask env file helpers (per-phase-config phase 7.4
 * — Level 1.5 fast path).
 *
 * Pins the merge precedence (subtask wins; null unsets), the shell-quote
 * contract on `renderSubtaskEnvFile` (every byte must round-trip safely
 * through `bash -c "source <file>"`), and the file-permission /
 * atomic-swap behaviour of `writeSubtaskEnvFile`.
 */

import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildSubtaskEnvShadowKeys,
  computeSubtaskEnv,
  renderSubtaskEnvFile,
  type SubtaskEnvBaseline,
  type SubtaskWithLevel1_5Overrides,
  writeSubtaskEnvFile,
} from './per-subtask-env.js';

let saifctlPath: string;

beforeEach(async () => {
  saifctlPath = await mkdtemp(join(tmpdir(), 'saifctl-subtask-env-'));
  await mkdir(saifctlPath, { recursive: true });
});

afterEach(async () => {
  await rm(saifctlPath, { recursive: true, force: true });
});

const baseline: SubtaskEnvBaseline = {
  agentEnv: { RUN_LEVEL: 'baseline' },
  // Operator-approved at run-level; the value is in hostEnv below.
  // Per-phase-config 7.4 review F-B: this acts as the implicit
  // allow-list for any per-phase `agent.secrets` declaration.
  agentSecretKeys: ['EXISTING_SECRET'],
  llm: { globalModel: 'anthropic/claude-haiku-4-5' },
  reviewerEnabled: true,
  hostEnv: {
    EXISTING_SECRET: 'baseline-secret-value',
    OPENAI_API_KEY: 'phase-allowed-key',
    GITHUB_TOKEN: 'phase-allowed-token',
    HOME: '/Users/test',
    AWS_SECRET_ACCESS_KEY: 'must-not-leak',
    EMPTY_KEY: '',
  },
};

describe('computeSubtaskEnv — full resolved env (F-A)', () => {
  // Per-phase-config 7.4 review F-A: the resolver returns the FULL
  // resolved env (run-level baseline + active overrides), not just the
  // per-phase delta. Sourcing the file always brings the shell to a
  // known state regardless of what was sourced before.

  it('emits the run-level baseline even when the active subtask is undefined', () => {
    const r = computeSubtaskEnv({ active: undefined, baseline });
    expect(r.RUN_LEVEL).toBe('baseline');
    expect(r.EXISTING_SECRET).toBe('baseline-secret-value');
    expect(r.LLM_MODEL).toBe('anthropic/claude-haiku-4-5');
    expect(r.SAIFCTL_REVIEWER_ENABLED).toBe('1');
  });

  it('emits the run-level baseline when the active subtask declares no overrides', () => {
    const r = computeSubtaskEnv({ active: {}, baseline });
    expect(r.RUN_LEVEL).toBe('baseline');
    expect(r.LLM_MODEL).toBe('anthropic/claude-haiku-4-5');
    expect(r.SAIFCTL_REVIEWER_ENABLED).toBe('1');
  });

  it('phase override layered on top of baseline (overrides win, baseline keys preserved)', () => {
    const r = computeSubtaskEnv({
      active: { agentEnv: { RUN_LEVEL: 'phase-overrides', PHASE_ONLY: 'value' } },
      baseline,
    });
    expect(r.RUN_LEVEL).toBe('phase-overrides');
    expect(r.PHASE_ONLY).toBe('value');
  });

  it('SAIFCTL_REVIEWER_ENABLED falls back to baseline when the active subtask leaves it undefined', () => {
    expect(computeSubtaskEnv({ active: {}, baseline }).SAIFCTL_REVIEWER_ENABLED).toBe('1');
  });

  it('agent.reviewer: false on the active subtask → SAIFCTL_REVIEWER_ENABLED = null (unset)', () => {
    expect(computeSubtaskEnv({ active: { reviewerEnabled: false }, baseline })).toMatchObject({
      SAIFCTL_REVIEWER_ENABLED: null,
    });
  });
});

describe('computeSubtaskEnv — agent.env / agent.secrets / LLM merging', () => {
  it('drops reserved factory keys from agent.env with a warning (not error)', () => {
    const r = computeSubtaskEnv({
      active: { agentEnv: { LLM_MODEL: 'evil', SAIFCTL_GATE_RETRIES: 'evil', GOOD: 'value' } },
      baseline,
    });
    expect(r.GOOD).toBe('value');
    expect(r.LLM_MODEL).toBe('anthropic/claude-haiku-4-5'); // baseline preserved
  });

  it('skips agent.secrets entries whose host value is undefined', () => {
    // NEVER_SET_KEY isn't in hostEnv; OPENAI_API_KEY is. Only the latter
    // lands in the resolved env (matches run-level docker-run-e behavior).
    const r = computeSubtaskEnv({
      active: { agentSecretKeys: ['OPENAI_API_KEY', 'NEVER_SET_KEY'] },
      baseline,
    });
    expect(r.OPENAI_API_KEY).toBe('phase-allowed-key');
    expect(r).not.toHaveProperty('NEVER_SET_KEY');
  });

  it('preserves an empty-string host value (only `undefined` triggers skip)', () => {
    // Run-level allow-list includes EMPTY_KEY explicitly; per-phase
    // declaration is allowed and emitted as the empty string.
    const customBaseline: SubtaskEnvBaseline = {
      ...baseline,
      agentSecretKeys: [...baseline.agentSecretKeys, 'EMPTY_KEY'],
    };
    const r = computeSubtaskEnv({
      active: { agentSecretKeys: ['EMPTY_KEY'] },
      baseline: customBaseline,
    });
    expect(r.EMPTY_KEY).toBe('');
  });

  it('llmOverrides: phase override emits LLM_MODEL / LLM_MODEL_ID / LLM_PROVIDER for the resolved coder model', () => {
    const r = computeSubtaskEnv({
      active: { llmOverrides: { globalModel: 'openai/gpt-4o-mini' } },
      baseline,
    });
    expect(r.LLM_MODEL).toBe('openai/gpt-4o-mini');
    expect(r.LLM_MODEL_ID).toBe('gpt-4o-mini');
    expect(r.LLM_PROVIDER).toBe('openai');
  });

  it('llmOverrides: ALWAYS emits LLM_API_KEY (incl. the sk-none sentinel — F-A regression)', () => {
    // Per-phase-config 7.4 review F-A: previous behaviour skipped writing
    // LLM_API_KEY when the resolver returned `'sk-none'` (no host key for
    // the active provider). With the shadow-keys sweep now emitting
    // `unset LLM_API_KEY` for any LLM_* not in the resolved set, that
    // skip would let the sweep delete the key entirely from the shell.
    // We now forward the resolver's value verbatim, including the
    // sentinel — failure mode is a clear 401 from the provider rather
    // than a missing-key confusion or a leaked stale key from a prior
    // phase.
    const r = computeSubtaskEnv({
      active: { llmOverrides: { globalModel: 'openai/gpt-4o-mini' } },
      baseline,
    });
    expect(typeof r.LLM_API_KEY).toBe('string');
  });

  it('llmOverrides: empty delta {} keeps the baseline LLM model (no surprise unset)', () => {
    const r = computeSubtaskEnv({ active: { llmOverrides: {} }, baseline });
    expect(r.LLM_MODEL).toBe('anthropic/claude-haiku-4-5');
  });

  it('combines agent.env + reviewer + llmOverrides into a single map', () => {
    const r = computeSubtaskEnv({
      active: {
        agentEnv: { PHASE: '1' },
        reviewerEnabled: false,
        llmOverrides: { globalModel: 'openai/gpt-4o-mini' },
      },
      baseline,
    });
    expect(r.PHASE).toBe('1');
    expect(r.SAIFCTL_REVIEWER_ENABLED).toBeNull();
    expect(r.LLM_MODEL).toBe('openai/gpt-4o-mini');
  });
});

describe('computeSubtaskEnv — agent.secrets allow-list (F-B)', () => {
  // Per-phase-config 7.4 review F-B: a phase config can name any host
  // env var via `agent.secrets`. The allow-list permits only operator-
  // approved names (run-level `defaults.agentSecretKeys`) plus a built-
  // in pattern set (`*_API_KEY`, `*_TOKEN`). Anything else is dropped.

  it('allows names matching the *_API_KEY pattern without operator opt-in', () => {
    const r = computeSubtaskEnv({
      active: { agentSecretKeys: ['OPENAI_API_KEY'] },
      baseline,
    });
    expect(r.OPENAI_API_KEY).toBe('phase-allowed-key');
  });

  it('allows names matching the *_TOKEN pattern without operator opt-in', () => {
    const r = computeSubtaskEnv({
      active: { agentSecretKeys: ['GITHUB_TOKEN'] },
      baseline,
    });
    expect(r.GITHUB_TOKEN).toBe('phase-allowed-token');
  });

  it('allows operator-approved names from run-level agentSecretKeys (any shape)', () => {
    const r = computeSubtaskEnv({
      active: { agentSecretKeys: ['EXISTING_SECRET'] },
      baseline,
    });
    expect(r.EXISTING_SECRET).toBe('baseline-secret-value');
  });

  it('drops arbitrary host env names not on the allow-list (HOME, AWS_SECRET_ACCESS_KEY, …)', () => {
    const r = computeSubtaskEnv({
      active: { agentSecretKeys: ['HOME', 'AWS_SECRET_ACCESS_KEY'] },
      baseline,
    });
    expect(r).not.toHaveProperty('HOME');
    expect(r).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  });
});

describe('computeSubtaskEnv — shadow-keys unset (F-A regression)', () => {
  // Per-phase-config 7.4 review F-A: the cross-subtask leak — phase-A-
  // only-added keys must not survive into phase B. The resolver emits
  // `null` (= `unset KEY`) for any shadow key not in the active set.

  function subtask(over: Partial<SubtaskWithLevel1_5Overrides>): SubtaskWithLevel1_5Overrides {
    return { ...over };
  }

  it('emits unset for a key added by a different subtask but not by the active one', () => {
    const phaseA = subtask({ agentEnv: { PHASE_A_ONLY: 'x' } });
    const phaseB = subtask({}); // no overrides; should NOT inherit PHASE_A_ONLY
    const shadowKeys = buildSubtaskEnvShadowKeys({ baseline, subtasks: [phaseA, phaseB] });

    const rA = computeSubtaskEnv({ active: phaseA, baseline, shadowKeys });
    const rB = computeSubtaskEnv({ active: phaseB, baseline, shadowKeys });

    expect(rA.PHASE_A_ONLY).toBe('x');
    expect(rB.PHASE_A_ONLY).toBeNull(); // unset directive
  });

  it('emits unset for a secret name added only by a sibling subtask', () => {
    const phaseA = subtask({ agentSecretKeys: ['OPENAI_API_KEY'] });
    const phaseB = subtask({}); // no secrets
    const shadowKeys = buildSubtaskEnvShadowKeys({ baseline, subtasks: [phaseA, phaseB] });

    const rB = computeSubtaskEnv({ active: phaseB, baseline, shadowKeys });
    expect(rB.OPENAI_API_KEY).toBeNull();
  });

  it('does NOT unset baseline keys that the active subtask omits — they re-emit as exports', () => {
    const phaseA = subtask({ agentEnv: { PHASE_A_ONLY: 'x' } });
    const shadowKeys = buildSubtaskEnvShadowKeys({ baseline, subtasks: [phaseA] });
    const r = computeSubtaskEnv({ active: phaseA, baseline, shadowKeys });
    // Baseline keys come through as their baseline values, not null.
    expect(r.RUN_LEVEL).toBe('baseline');
    expect(r.EXISTING_SECRET).toBe('baseline-secret-value');
  });
});

describe('buildSubtaskEnvShadowKeys', () => {
  it('unions baseline + every subtask override into a single set', () => {
    const subtasks: SubtaskWithLevel1_5Overrides[] = [
      { agentEnv: { PHASE_A_VAR: 'a' } },
      { agentSecretKeys: ['GITHUB_TOKEN'] },
      { agentEnv: { PHASE_C_VAR: 'c' } },
    ];
    const shadow = buildSubtaskEnvShadowKeys({ baseline, subtasks });

    // Always-managed.
    expect(shadow.has('SAIFCTL_REVIEWER_ENABLED')).toBe(true);
    expect(shadow.has('LLM_MODEL')).toBe(true);
    // Baseline.
    expect(shadow.has('RUN_LEVEL')).toBe(true);
    expect(shadow.has('EXISTING_SECRET')).toBe(true);
    // Per-subtask.
    expect(shadow.has('PHASE_A_VAR')).toBe(true);
    expect(shadow.has('PHASE_C_VAR')).toBe(true);
    expect(shadow.has('GITHUB_TOKEN')).toBe(true);
  });

  it('filters reserved factory prefixes from per-subtask agent.env / agent.secrets', () => {
    const subtasks: SubtaskWithLevel1_5Overrides[] = [
      { agentEnv: { LLM_MODEL: 'evil', NORMAL: 'fine' } },
    ];
    const shadow = buildSubtaskEnvShadowKeys({ baseline, subtasks });
    // LLM_MODEL is in shadow because it's always-managed, not because we
    // honored the user's attempt to shadow it via agent.env.
    expect(shadow.has('LLM_MODEL')).toBe(true);
    expect(shadow.has('NORMAL')).toBe(true);
  });
});

describe('renderSubtaskEnvFile — shell quoting', () => {
  it('renders an empty map as a header-only file (no exports)', () => {
    const out = renderSubtaskEnvFile({});
    expect(out).toContain('#!/bin/bash');
    expect(out).not.toContain('export');
    expect(out).not.toContain('unset');
    expect(out.endsWith('\n')).toBe(true);
  });

  it("single-quotes simple values: export FOO='bar'", () => {
    const out = renderSubtaskEnvFile({ FOO: 'bar' });
    expect(out).toContain("export FOO='bar'");
  });

  it("escapes embedded single quotes via the close-escape-reopen pattern '\\''", () => {
    const out = renderSubtaskEnvFile({ MSG: "it's a test" });
    expect(out).toContain("export MSG='it'\\''s a test'");
  });

  it('values with newlines, $, backticks, backslashes, double quotes round-trip safely', () => {
    const value = 'line1\nline2 $VAR `cmd` \\backslash "quote"';
    const out = renderSubtaskEnvFile({ DATA: value });
    expect(out).toContain(`export DATA='${value}'`);
  });

  it('null values render as `unset KEY` (no quoting)', () => {
    const out = renderSubtaskEnvFile({ SAIFCTL_REVIEWER_ENABLED: null });
    expect(out).toContain('unset SAIFCTL_REVIEWER_ENABLED');
    expect(out).not.toContain("export SAIFCTL_REVIEWER_ENABLED=''");
  });

  it('emits keys in lexicographic order (deterministic re-renders)', () => {
    const out = renderSubtaskEnvFile({ ZED: '1', ALPHA: '2', MID: '3' });
    const lines = out.split('\n').filter((l) => l.startsWith('export') || l.startsWith('unset'));
    expect(lines).toEqual(["export ALPHA='2'", "export MID='3'", "export ZED='1'"]);
  });
});

describe('writeSubtaskEnvFile', () => {
  it('writes the file at <saifctlPath>/subtask-env.sh', async () => {
    await writeSubtaskEnvFile({ saifctlPath, env: { FOO: 'bar' } });
    const body = await readFile(join(saifctlPath, 'subtask-env.sh'), 'utf8');
    expect(body).toContain("export FOO='bar'");
  });

  it('sets file mode 0o600 (sensitive — may contain agent.secrets values)', async () => {
    await writeSubtaskEnvFile({ saifctlPath, env: { SECRET: 'abc' } });
    const s = await stat(join(saifctlPath, 'subtask-env.sh'));
    // mask off the file-type bits; permission bits should be exactly 0o600.
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('overwrites an existing file with new content (rewrite at subtask transition)', async () => {
    await writeSubtaskEnvFile({ saifctlPath, env: { OLD: '1' } });
    await writeSubtaskEnvFile({ saifctlPath, env: { NEW: '2' } });
    const body = await readFile(join(saifctlPath, 'subtask-env.sh'), 'utf8');
    expect(body).not.toContain('OLD');
    expect(body).toContain("export NEW='2'");
  });
});
