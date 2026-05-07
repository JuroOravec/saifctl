/**
 * Tests for the per-phase-config phase 7.6 per-phase outer-attempt
 * budget helpers.
 *
 * The loop's closure state for `phaseAttemptCount` is non-trivial:
 *  - Increment fires once per outer attempt that runs against a
 *    phase-bound subtask (legacy/non-phased subtasks don't tick).
 *  - Cap is per-active-subtask (`limits.maxAttempts` resolved at compile
 *    time). The same phase id can carry the same cap across many
 *    subtasks (impl + critic rounds), so the budget is shared across
 *    those subtasks of the same phase.
 *  - Phase advances do NOT decrement the counter — `phaseAttemptCount`
 *    is monotone within a single Run identity (resume must not reset
 *    the budget).
 *
 * These tests pin those rules without requiring a full coding-phase
 * harness; the loop in `loop.ts` calls these helpers from
 * `onSubtaskComplete` and the three retry-or-fail branches.
 */

import { describe, expect, it } from 'vitest';

import type { RunSubtask } from '../runs/types.js';
import { bumpPhaseAttemptCount, phaseBudgetExhaustedMessage } from './phase-budget.js';

/** Build a minimal RunSubtask shape. Defaults: phaseId 'phase-a' impl, no cap. */
function subtask(over: Partial<RunSubtask> = {}): RunSubtask {
  return {
    id: 's1',
    content: 'task',
    status: 'pending',
    createdAt: '2026-05-07T00:00:00Z',
    phaseId: 'phase-a',
    ...over,
  };
}

describe('bumpPhaseAttemptCount', () => {
  it("increments the counter for the active subtask's phaseId", () => {
    const counts: Record<string, number> = {};
    bumpPhaseAttemptCount({ subtask: subtask({ phaseId: 'phase-a' }), phaseAttemptCount: counts });
    expect(counts).toEqual({ 'phase-a': 1 });
    bumpPhaseAttemptCount({ subtask: subtask({ phaseId: 'phase-a' }), phaseAttemptCount: counts });
    expect(counts).toEqual({ 'phase-a': 2 });
  });

  it('keeps separate counters per phaseId (no cross-phase leak)', () => {
    const counts: Record<string, number> = {};
    bumpPhaseAttemptCount({ subtask: subtask({ phaseId: 'phase-a' }), phaseAttemptCount: counts });
    bumpPhaseAttemptCount({ subtask: subtask({ phaseId: 'phase-b' }), phaseAttemptCount: counts });
    bumpPhaseAttemptCount({ subtask: subtask({ phaseId: 'phase-a' }), phaseAttemptCount: counts });
    expect(counts).toEqual({ 'phase-a': 2, 'phase-b': 1 });
  });

  it('is a no-op when the subtask has no phaseId (legacy / non-phased path)', () => {
    const counts: Record<string, number> = {};
    bumpPhaseAttemptCount({
      subtask: subtask({ phaseId: undefined }),
      phaseAttemptCount: counts,
    });
    expect(counts).toEqual({});
  });

  it('is a no-op when the active subtask is undefined (cursor out of range)', () => {
    const counts: Record<string, number> = { 'phase-a': 5 };
    bumpPhaseAttemptCount({ subtask: undefined, phaseAttemptCount: counts });
    expect(counts).toEqual({ 'phase-a': 5 });
  });

  it('extends an existing seeded count (resume preserves the budget)', () => {
    // Resume seeds the counter from the persisted `phaseAttemptCount`;
    // subsequent attempts continue from the resumed value rather than
    // resetting to 0. This pins the monotone-within-a-Run-identity
    // contract from design.md §7.6.
    const counts: Record<string, number> = { 'phase-a': 3 };
    bumpPhaseAttemptCount({ subtask: subtask({ phaseId: 'phase-a' }), phaseAttemptCount: counts });
    expect(counts['phase-a']).toBe(4);
  });
});

describe('phaseBudgetExhaustedMessage', () => {
  it('returns null when the active subtask has no limits.maxAttempts cap', () => {
    const r = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a' }), // no `limits`
      phaseAttemptCount: { 'phase-a': 99 },
    });
    expect(r).toBeNull();
  });

  it('returns null when the active subtask has no phaseId (legacy / non-phased)', () => {
    const r = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: undefined, limits: { maxAttempts: 1 } }),
      phaseAttemptCount: {},
    });
    expect(r).toBeNull();
  });

  it('returns null when the count is below the cap (budget still in play)', () => {
    const r = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a', limits: { maxAttempts: 3 } }),
      phaseAttemptCount: { 'phase-a': 1 },
    });
    expect(r).toBeNull();
  });

  it('returns a message naming the phase and the cap when the count meets the cap', () => {
    // Increment fires AFTER attempt completion; a count of 3 for cap 3
    // means 3 attempts have been consumed → budget exhausted, no retry
    // allowed. Matches the design.md §7.6 "phase X exhausted N/N
    // attempts" wording.
    const r = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a', limits: { maxAttempts: 3 } }),
      phaseAttemptCount: { 'phase-a': 3 },
    });
    expect(r).not.toBeNull();
    expect(r).toContain("Phase 'phase-a'");
    expect(r).toContain('3/3 attempts');
    expect(r).toContain('limits.max-attempts');
  });

  it('pluralises correctly: "1/1 attempt." (cap === 1) vs "3/3 attempts." (review N6)', () => {
    // Singular-cap is "1/1 attempt" — without this branch the message
    // reads "1/1 attempt(s)" which is grammatically awkward in logs.
    const singular = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a', limits: { maxAttempts: 1 } }),
      phaseAttemptCount: { 'phase-a': 1 },
    });
    expect(singular).toContain('1/1 attempt.');
    // The "limits.max-attempts" in the action prompt does contain
    // "attempts"; assert specifically that the count noun is singular.
    expect(singular).not.toMatch(/\d+\/\d+ attempts/);

    const plural = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a', limits: { maxAttempts: 5 } }),
      phaseAttemptCount: { 'phase-a': 5 },
    });
    expect(plural).toContain('5/5 attempts.');
  });

  it('returns a message when the count exceeds the cap (defence in depth)', () => {
    // Should never happen with correct increment ordering, but the
    // helper must still surface exhaustion if the closure state slips
    // (e.g. a future refactor that double-bumps the counter).
    const r = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a', limits: { maxAttempts: 2 } }),
      phaseAttemptCount: { 'phase-a': 5 },
    });
    expect(r).not.toBeNull();
    expect(r).toContain('5/2');
  });

  it('uses 0 as the count when the phaseId has no entry in the map', () => {
    const r = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a', limits: { maxAttempts: 1 } }),
      phaseAttemptCount: {},
    });
    expect(r).toBeNull();
  });

  it("keys exclusively by the active subtask's phaseId — not affected by sibling phase counts", () => {
    // Pin that a saturated phase-b counter does not trigger an
    // exhaustion message for phase-a (the active phase). Without this,
    // a multi-phase run could fail-fast on the wrong phase.
    const r = phaseBudgetExhaustedMessage({
      subtask: subtask({ phaseId: 'phase-a', limits: { maxAttempts: 5 } }),
      phaseAttemptCount: { 'phase-a': 1, 'phase-b': 99 },
    });
    expect(r).toBeNull();
  });
});

describe("integration — increment-then-check (the loop's in-order pattern)", () => {
  // The loop calls `bumpPhaseAttemptCount` at the top of
  // `onSubtaskComplete`, then (in the failure branches) calls
  // `phaseBudgetExhaustedMessage` BEFORE the per-subtask `> maxRuns`
  // check. These tests pin that the two helpers compose correctly.

  it('attempts within budget pass through; the budget-exhausted attempt fires the message', () => {
    const counts: Record<string, number> = {};
    const cap = 3;
    const active = subtask({ phaseId: 'phase-a', limits: { maxAttempts: cap } });

    // Attempt 1 — bump → count=1, check → null.
    bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    expect(phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts })).toBeNull();
    // Attempt 2 — bump → count=2, check → null.
    bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    expect(phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts })).toBeNull();
    // Attempt 3 — bump → count=3, check → exhausted.
    bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    const msg = phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts });
    expect(msg).not.toBeNull();
    expect(msg).toContain('3/3');
  });

  it('phase budget is independent of run-level maxRuns (distinct from maxRuns clarification)', () => {
    // design.md §7.6: "a feature with `maxRuns: 5` and a phase with
    // `limits.max-attempts: 2` aborts after 2 attempts on the phase,
    // well before `maxRuns`". `maxRuns` lives on the run-level and is
    // checked by the loop's `subtaskAttemptNumber > maxRuns` gate; the
    // phase budget here doesn't see it. So a phase with `cap: 2` fires
    // the message after 2 attempts regardless of how many run-level
    // attempts remain.
    const counts: Record<string, number> = {};
    const phaseCap = 2;
    const active = subtask({ phaseId: 'phase-a', limits: { maxAttempts: phaseCap } });

    bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    expect(phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts })).toBeNull();
    bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    expect(
      phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts }),
    ).not.toBeNull();
    // Run-level `maxRuns` could be 5 here — irrelevant to the helper.
  });

  it('advancing to a new phase resets the counter to 0 for the new phase id', () => {
    // design.md §7.6 reset semantics: "when a phase's gate eventually
    // passes and the loop advances, the counter for the next phase
    // starts at 0". The "reset" here is implicit — the next phase's
    // key was never set in the map, so its initial check-with-no-bump
    // returns 0.
    const counts: Record<string, number> = { 'phase-a': 3 };
    const phaseB = subtask({ phaseId: 'phase-b', limits: { maxAttempts: 3 } });

    // Phase B's first attempt: cursor advanced, no prior bump for phase-b.
    expect(phaseBudgetExhaustedMessage({ subtask: phaseB, phaseAttemptCount: counts })).toBeNull();
    bumpPhaseAttemptCount({ subtask: phaseB, phaseAttemptCount: counts });
    expect(counts).toEqual({ 'phase-a': 3, 'phase-b': 1 });
    expect(phaseBudgetExhaustedMessage({ subtask: phaseB, phaseAttemptCount: counts })).toBeNull();
  });

  it('resume does not reset the counter (monotone within a Run identity)', () => {
    // Pin the design.md §7.6 clarification: "Per-phase counter does
    // NOT decrement when the same phase is re-entered after a failure
    // (e.g. via `run start <id>` after a crash) — that would
    // trivialise the budget. `phaseAttemptCount` is monotone within
    // a single Run identity."
    const persisted: Record<string, number> = { 'phase-a': 2 };
    const counts = { ...persisted }; // simulate the loop re-seeding from the artifact
    const active = subtask({ phaseId: 'phase-a', limits: { maxAttempts: 3 } });

    // Resumed attempt — bump → count=3, check → exhausted on the very
    // first attempt of the resumed run because 2 attempts were already
    // consumed on the prior run identity.
    bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    const msg = phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts });
    expect(msg).not.toBeNull();
    expect(msg).toContain('3/3');
  });
});
