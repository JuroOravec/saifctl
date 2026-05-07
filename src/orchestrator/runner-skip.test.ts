/**
 * Tests for the per-phase-config phase 7.3 runner short-circuit
 * (`shouldBypassRunner`).
 *
 * The §6.5(b) "tests.none" rule says: a phase with `tests.none: true`
 * should skip the staging runner UNLESS feature/project tests need to gate
 * (the last-phase exception). The compiler imprints feature/project paths
 * into the last phase's `testScope.include` so `scope.sources` is non-empty
 * there even with `noRunner: true` — no separate `lastPhaseInRun` flag is
 * needed at runtime.
 *
 * These tests pin that contract directly so a future regression to the
 * loop's bypass branch surfaces here, not via a missed-test feature run.
 */

import { describe, expect, it } from 'vitest';

import { shouldBypassRunner } from './runner-overrides.js';

describe('shouldBypassRunner', () => {
  it('bypasses when noRunner is true AND scope sources is empty (non-last phase with tests.none)', () => {
    expect(shouldBypassRunner({ noRunner: true, resolvedScopeSources: [] })).toBe(true);
  });

  it('does NOT bypass when noRunner is true but scope sources is non-empty (last phase with feature/project tests)', () => {
    // Compiler keeps the last phase's `testScope.include` populated with
    // feature/project test paths even when `tests.none: true`. The runtime
    // sees `sources` non-empty and runs the runner against those.
    expect(
      shouldBypassRunner({
        noRunner: true,
        resolvedScopeSources: ['/proj/saifctl/features/foo/tests', '/proj/saifctl/tests'],
      }),
    ).toBe(false);
  });

  it('does NOT bypass when noRunner is false (regular phase with own tests)', () => {
    expect(
      shouldBypassRunner({
        noRunner: false,
        resolvedScopeSources: ['/proj/saifctl/features/foo/phases/01/tests'],
      }),
    ).toBe(false);
  });

  it('does NOT bypass when noRunner is false even if scope sources is empty (legacy / no-tests run)', () => {
    // A run with no tests at all is the legacy "synthesized single-task"
    // path — the runner still spins up to satisfy the design's "always
    // gate at the terminal state" property; vacuous pass when no tests.
    expect(shouldBypassRunner({ noRunner: false, resolvedScopeSources: [] })).toBe(false);
  });
});
