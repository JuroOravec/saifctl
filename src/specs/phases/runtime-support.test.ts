/**
 * Tests for the per-phase-config v1 runtime-support feature-flag table.
 *
 * The table maps each new field to its lifecycle level + the
 * implementation-phase that ships its runtime support. It's the single
 * source of truth used by `validate.ts` for the §6.9.8 future-proof
 * reject.
 *
 * These tests pin the **shape** of the table so later phases can't
 * accidentally drop a field while clearing their flag, and so the
 * phase-7.1 release of saifctl rejects every new field as "not yet
 * implemented" until subsequent phases land.
 */

import { describe, expect, it } from 'vitest';

import {
  formatNotYetImplementedMessage,
  isFieldRuntimeSupported,
  KNOWN_PHASE_CONFIG_FIELDS,
  lookupKnownField,
} from './runtime-support.js';

describe('KNOWN_PHASE_CONFIG_FIELDS', () => {
  it('lists every v1 field once (no duplicate paths)', () => {
    const paths = KNOWN_PHASE_CONFIG_FIELDS.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('covers every documented v1 field path', () => {
    const expected = [
      'tests.none',
      'gate.script',
      'gate.retries',
      'agent.script',
      'agent.env',
      'agent.secrets',
      'agent.model',
      'agent.base-url',
      'agent.reviewer',
      'agent.profile',
      'agent.install',
      'container.startup',
      'container.cedar',
      'container.no-leash',
      'container.sandbox-profile',
      'container.image',
      'container.engine',
      'container.compose-file',
      'runner.test-profile',
      'runner.test-image',
      'runner.test-script',
      'runner.stage-script',
      'runner.resolve-ambiguity',
      'runner.test-retries',
      'limits.max-attempts',
    ].sort();
    const actual = KNOWN_PHASE_CONFIG_FIELDS.map((f) => f.path).sort();
    expect(actual).toEqual(expected);
  });

  it('every field has a valid lifecycle level', () => {
    const validLevels = new Set(['1', '1.5', '2', '3', '4', 'loop']);
    for (const f of KNOWN_PHASE_CONFIG_FIELDS) {
      expect(validLevels.has(f.level)).toBe(true);
    }
  });

  it('every field declares which implementation phase ships its runtime support', () => {
    for (const f of KNOWN_PHASE_CONFIG_FIELDS) {
      expect(f.shipsIn.length).toBeGreaterThan(0);
    }
  });
});

describe('lookupKnownField', () => {
  it('returns the entry when the path is a known field', () => {
    const f = lookupKnownField('gate.script');
    expect(f).not.toBeNull();
    expect(f?.level).toBe('1');
  });

  it('returns null for unknown paths (existing v0 fields not gated)', () => {
    expect(lookupKnownField('critics')).toBeNull();
    expect(lookupKnownField('spec')).toBeNull();
    expect(lookupKnownField('tests.mutable')).toBeNull();
    expect(lookupKnownField('completely.invented.path')).toBeNull();
  });
});

describe('isFieldRuntimeSupported', () => {
  it('returns true for paths NOT in the known table (existing v0 fields not gated)', () => {
    // `critics`, `spec`, `tests.mutable`, etc. predate per-phase-config v1
    // and must continue to work without the gate firing.
    expect(isFieldRuntimeSupported('critics')).toBe(true);
    expect(isFieldRuntimeSupported('spec')).toBe(true);
    expect(isFieldRuntimeSupported('tests.mutable')).toBe(true);
    expect(isFieldRuntimeSupported('tests.fail2pass')).toBe(true);
  });

  it('returns true for the Level-1 fields shipped by phase 7.2', () => {
    // Pin the per-phase-config phase 7.2 contract: gate.script, gate.retries,
    // and agent.script must clear the §6.9.8 gate now that their threading
    // has shipped. If a future refactor accidentally drops them from the
    // supported set, the user-facing regression is "valid configs error
    // out as not-yet-implemented" — exactly the kind of silent breakage
    // an explicit per-field test catches early.
    expect(isFieldRuntimeSupported('gate.script')).toBe(true);
    expect(isFieldRuntimeSupported('gate.retries')).toBe(true);
    expect(isFieldRuntimeSupported('agent.script')).toBe(true);
  });

  it('returns true for the Level-4 + tests.none fields shipped by phase 7.3', () => {
    // Pin the per-phase-config phase 7.3 contract: every runner.* field
    // and tests.none must clear the §6.9.8 gate now that their threading
    // has shipped. Same regression rationale as the phase 7.2 pin above.
    expect(isFieldRuntimeSupported('tests.none')).toBe(true);
    expect(isFieldRuntimeSupported('runner.test-profile')).toBe(true);
    expect(isFieldRuntimeSupported('runner.test-image')).toBe(true);
    expect(isFieldRuntimeSupported('runner.test-script')).toBe(true);
    expect(isFieldRuntimeSupported('runner.stage-script')).toBe(true);
    expect(isFieldRuntimeSupported('runner.resolve-ambiguity')).toBe(true);
    expect(isFieldRuntimeSupported('runner.test-retries')).toBe(true);
  });

  it('returns true for the Level-1.5 fields shipped by phase 7.4', () => {
    // Pin the per-phase-config phase 7.4 contract: agent.env / .secrets /
    // .model / .base-url / .reviewer must clear the §6.9.8 gate. Same
    // regression rationale as the phase 7.2 / 7.3 pins above.
    expect(isFieldRuntimeSupported('agent.env')).toBe(true);
    expect(isFieldRuntimeSupported('agent.secrets')).toBe(true);
    expect(isFieldRuntimeSupported('agent.model')).toBe(true);
    expect(isFieldRuntimeSupported('agent.base-url')).toBe(true);
    expect(isFieldRuntimeSupported('agent.reviewer')).toBe(true);
  });

  it('returns true for the Level-2 fields cleared by phase 7.5', () => {
    // Phase 7.5 cleared the §6.9.8 gate for Level-2 fields. The runtime
    // doesn't yet honor cross-phase Level-2 transitions, but that's
    // enforced by a separate validator gate (see validate.ts
    // `checkLevel2TransitionGate`) — same shape as phase 7.3 / 7.4
    // contract pins above.
    expect(isFieldRuntimeSupported('agent.profile')).toBe(true);
    expect(isFieldRuntimeSupported('agent.install')).toBe(true);
    expect(isFieldRuntimeSupported('container.startup')).toBe(true);
    expect(isFieldRuntimeSupported('container.cedar')).toBe(true);
    expect(isFieldRuntimeSupported('container.no-leash')).toBe(true);
  });

  it('clears the §6.9.8 gate for Level-3 fields shipped by 7.5b (level-3-mirror)', () => {
    // Phase 7.5b cleared the §6.9.8 gate for Level-3 fields
    // (image / sandbox-profile / engine / compose-file). The schema
    // accepts uniform top-level declarations; the residual cross-phase
    // rejection moves to `validate.ts:checkLevel3TransitionGate` and
    // stays in place until phase 7.5e ships the image-pull /
    // engine-swap / compose-stack-swap machinery. Same contract shape
    // as Level-2 in phase 7.5 (see the Level-2 pin above).
    expect(isFieldRuntimeSupported('container.image')).toBe(true);
    expect(isFieldRuntimeSupported('container.sandbox-profile')).toBe(true);
    expect(isFieldRuntimeSupported('container.engine')).toBe(true);
    expect(isFieldRuntimeSupported('container.compose-file')).toBe(true);
  });

  it('every v1 field has shipped runtime support after phase 7.6', () => {
    // Phase 7.6 (per-phase-max-attempts) cleared the §6.9.8 gate for the
    // last gated field (`limits.max-attempts`). Every v1 field is now
    // runtime-supported. Use trailing hyphens so `7.5-` matches
    // `7.5-level-2-restart` but NOT `7.5b-level-3-mirror`, and `7.5b-`
    // matches `7.5b-level-3-mirror` but NOT a hypothetical `7.5bb-...`.
    const SHIPPED_PHASE_PREFIXES = ['7.1-', '7.2-', '7.3-', '7.4-', '7.5-', '7.5b-', '7.6-'];
    for (const f of KNOWN_PHASE_CONFIG_FIELDS) {
      const shipped = SHIPPED_PHASE_PREFIXES.some((p) => f.shipsIn.startsWith(p));
      expect(shipped).toBe(true);
      expect(isFieldRuntimeSupported(f.path)).toBe(true);
    }
  });

  it('clears the §6.9.8 gate for the loop-state field shipped by 7.6 (per-phase-max-attempts)', () => {
    // Phase 7.6 cleared the §6.9.8 gate for `limits.max-attempts` —
    // the per-phase analogue of the run-level `maxRuns`. Same contract
    // shape as the Level-2 / Level-3 pins above.
    expect(isFieldRuntimeSupported('limits.max-attempts')).toBe(true);
  });
});

describe('formatNotYetImplementedMessage', () => {
  it('names the exact field path so users can locate it in their config', () => {
    const f = lookupKnownField('agent.profile');
    expect(f).not.toBeNull();
    const msg = formatNotYetImplementedMessage(f!);
    expect(msg).toContain('`agent.profile`');
  });

  it('describes the lifecycle level so users understand the cost class', () => {
    const f = lookupKnownField('container.image');
    expect(f).not.toBeNull();
    expect(formatNotYetImplementedMessage(f!)).toContain('lifecycle-Level-3');
  });

  it('prompts the user to remove the field or wait for the next minor version', () => {
    const f = lookupKnownField('gate.retries');
    expect(f).not.toBeNull();
    const msg = formatNotYetImplementedMessage(f!);
    expect(msg).toContain('Remove the field, or wait for the next minor version.');
  });
});
