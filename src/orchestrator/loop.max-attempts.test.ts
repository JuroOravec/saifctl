/**
 * Per-phase-config phase 7.6 — loop-level wiring tests for `limits.max-attempts`.
 *
 * The 7.6 spec named this file by name. The pure-helper contract is
 * pinned by `phase-budget.test.ts`; this file pins the *loop* contract
 * — specifically, the call patterns the loop uses around the helpers
 * across the three retry-or-fail branches:
 *
 *   1. immutable-test violation     (impl persistently modified pinned tests)
 *   2. no-changes patch              (agent produced an empty patch)
 *   3. staging-test failure          (tests failed against the staged patch)
 *
 * For each branch the loop:
 *   - bumps the per-phase counter at the top of `onSubtaskComplete`
 *     (regardless of the eventual outcome),
 *   - calls `checkPhaseBudgetExhausted(subtaskIndex)` BEFORE the
 *     per-subtask `subtaskAttemptNumber > maxRuns` gate so the
 *     phase-specific failure mode wins when both fire,
 *   - formats the run-terminal message as
 *     `${phaseBudgetMsg}\nLast error: ${msg}` so the user sees both
 *     the phase budget context and the underlying failure.
 *
 * Earlier revisions of this file referenced the loop-branch line
 * numbers; the 7.5e and 7.6 fix waves shifted those, so the comments
 * now name the branches by their failure mode. The
 * `loop.ts has the per-phase-budget marker on each retry-or-fail
 * branch` test below pins the marker comment count so a regression
 * that drops the budget check from one branch is caught even though
 * this file doesn't drive the loop directly.
 *
 * A full `runIterativeLoop` test would require a docker / engine
 * harness; instead, this file exercises the helpers in the order the
 * loop calls them and pins the message shape the loop emits. A
 * regression that reorders the calls (e.g., checks `> maxRuns` before
 * the phase budget) won't break this file directly — but a regression
 * that BREAKS the helpers' contract will, and the spec-named file
 * gives future maintainers a single place to extend with full-loop
 * coverage if a docker harness lands.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { RunSubtask } from '../runs/types.js';
import { bumpPhaseAttemptCount, phaseBudgetExhaustedMessage } from './phase-budget.js';

/** Minimal RunSubtask: phase-bound impl row with an optional cap. */
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

/**
 * Mirror of the loop's failure-branch flow: bump the per-phase counter,
 * check exhaustion, format the run-terminal message the loop emits.
 * Returns the message that would land on `runTerminal.result.message`,
 * or `null` when the phase budget is still in play.
 */
function simulateFailureBranch(opts: {
  active: RunSubtask;
  phaseAttemptCount: Record<string, number>;
  /** "Last error" text passed to controlResult (varies per branch). */
  lastError: string;
}): string | null {
  bumpPhaseAttemptCount({ subtask: opts.active, phaseAttemptCount: opts.phaseAttemptCount });
  const budgetMsg = phaseBudgetExhaustedMessage({
    subtask: opts.active,
    phaseAttemptCount: opts.phaseAttemptCount,
  });
  if (budgetMsg === null) return null;
  // Matches `loop.ts` immutable-test / empty-patch / staging-test branches.
  return `${budgetMsg}\nLast error: ${opts.lastError}`;
}

describe('loop wiring — per-phase max-attempts (phase 7.6)', () => {
  it('immutable-test failure branch: 2nd failure on cap=2 produces a phase-named terminal message', () => {
    // Mirrors the loop's immutable-test-violation failure branch.
    const counts: Record<string, number> = {};
    const active = subtask({ phaseId: 'phase-a', limits: { maxAttempts: 2 } });

    expect(
      simulateFailureBranch({
        active,
        phaseAttemptCount: counts,
        lastError: 'agent persistently modified immutable test files.',
      }),
    ).toBeNull();

    const terminalMsg = simulateFailureBranch({
      active,
      phaseAttemptCount: counts,
      lastError: 'agent persistently modified immutable test files.',
    });
    expect(terminalMsg).not.toBeNull();
    expect(terminalMsg).toContain("Phase 'phase-a' exhausted 2/2 attempts.");
    expect(terminalMsg).toContain('Last error: agent persistently modified immutable test files.');
  });

  it('empty-patch retry branch: cap=3 fires on the 3rd no-changes attempt', () => {
    // Mirrors the loop's no-changes-patch failure branch.
    const counts: Record<string, number> = {};
    const active = subtask({ phaseId: 'phase-empty', limits: { maxAttempts: 3 } });
    const lastError =
      'External service attempted to use this project and failed. Re-read the spec.';

    expect(simulateFailureBranch({ active, phaseAttemptCount: counts, lastError })).toBeNull();
    expect(simulateFailureBranch({ active, phaseAttemptCount: counts, lastError })).toBeNull();
    const terminal = simulateFailureBranch({ active, phaseAttemptCount: counts, lastError });
    expect(terminal).not.toBeNull();
    expect(terminal).toContain("Phase 'phase-empty' exhausted 3/3 attempts.");
  });

  it('staging-test failure branch: cap=1 fires on the very first failure', () => {
    // Mirrors the loop's staging-test-failure branch — `max-attempts: 1`
    // is "must succeed first try" semantic; spike phases use this.
    const counts: Record<string, number> = {};
    const active = subtask({ phaseId: 'phase-spike', limits: { maxAttempts: 1 } });
    const terminal = simulateFailureBranch({
      active,
      phaseAttemptCount: counts,
      lastError: 'External service attempted to use this project and failed.',
    });
    expect(terminal).not.toBeNull();
    expect(terminal).toContain("Phase 'phase-spike' exhausted 1/1 attempt.");
    expect(terminal).not.toContain('1/1 attempts'); // singular pluralisation
  });

  it('phase budget is independent of run-level maxRuns (the design.md §7.6 distinct-from-maxRuns clarification)', () => {
    // The loop checks the phase budget BEFORE `subtaskAttemptNumber >
    // maxRuns`, so a phase with `cap: 2` aborts after 2 attempts even
    // when maxRuns is 5 (spec's worked example). Pin the helper-level
    // composition that backs that ordering: even though the spec's
    // maxRuns is irrelevant to `phaseBudgetExhaustedMessage`, the
    // helper's exhaustion is reachable on the 2nd attempt.
    const counts: Record<string, number> = {};
    const active = subtask({ phaseId: 'phase-a', limits: { maxAttempts: 2 } });

    expect(
      simulateFailureBranch({ active, phaseAttemptCount: counts, lastError: 'failure' }),
    ).toBeNull();
    expect(
      simulateFailureBranch({ active, phaseAttemptCount: counts, lastError: 'failure' }),
    ).not.toBeNull();
    // counts now at 2 = cap; the loop's separate `subtaskAttemptNumber
    // > maxRuns` gate (with maxRuns=5) hasn't fired and is unreachable.
    expect(counts['phase-a']).toBe(2);
  });

  it('counter is preserved across resume — a resumed run with persisted count picks up where it left off', () => {
    // The loop seeds `phaseAttemptCounts` from the artifact's
    // `phaseAttemptCount` on resume (see the closure-state declaration
    // near the top of `runIterativeLoop` in `loop.ts`). Pin that the
    // resumed flow runs the same bump-then-check pattern starting
    // from the persisted count rather than 0.
    const persisted: Record<string, number> = { 'phase-a': 2 };
    const counts = { ...persisted };
    const active = subtask({ phaseId: 'phase-a', limits: { maxAttempts: 3 } });

    // Resumed attempt #1 → bump 2→3 → exhausted (cap=3). The user can't
    // bypass the budget by `run start <id>` after a crash.
    const terminal = simulateFailureBranch({
      active,
      phaseAttemptCount: counts,
      lastError: 'failure',
    });
    expect(terminal).not.toBeNull();
    expect(terminal).toContain('3/3 attempts');
  });

  it('phase advances do NOT decrement (next phase starts at 0; previous phase counter persists in the map)', () => {
    // Two phases share the counter map. After phase A succeeds and the
    // loop advances to phase B, phase B's first attempt bumps from 0 →
    // 1; phase A's count persists in the map (so a future re-entry of
    // phase A — e.g., a critic-fix subtask within phase A — continues
    // from the persisted count).
    const counts: Record<string, number> = { 'phase-a': 3 };
    const phaseB = subtask({ phaseId: 'phase-b', limits: { maxAttempts: 5 } });
    bumpPhaseAttemptCount({ subtask: phaseB, phaseAttemptCount: counts });
    expect(counts).toEqual({ 'phase-a': 3, 'phase-b': 1 });
    expect(phaseBudgetExhaustedMessage({ subtask: phaseB, phaseAttemptCount: counts })).toBeNull();
  });

  it('non-phased subtasks (no `phaseId`) bypass the budget entirely (legacy / single-task runs)', () => {
    // Pin the no-phaseId guard from `bumpPhaseAttemptCount` +
    // `phaseBudgetExhaustedMessage`. A run with no phase-bound subtasks
    // (e.g., the bare `feat run` non-phased path) doesn't tick the
    // counter and never fires the budget message.
    const counts: Record<string, number> = {};
    const legacyActive = subtask({ phaseId: undefined, limits: { maxAttempts: 1 } });

    expect(
      simulateFailureBranch({
        active: legacyActive,
        phaseAttemptCount: counts,
        lastError: 'failure',
      }),
    ).toBeNull();
    expect(counts).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Per-phase-config phase 7.6 review L3 — branch-coverage marker count.
  //
  // The helper-level tests above mirror the loop's three failure
  // branches (immutable-test / no-changes / staging-test) but don't
  // drive the loop directly, so a regression that drops the budget
  // check from one branch wouldn't show up. Pin the count of
  // `checkPhaseBudgetExhausted(subtaskIndex)` call sites in `loop.ts`
  // so the omission is caught at test time.
  //
  // The check fires from EXACTLY 3 retry-or-fail branches; a 4th
  // failure mode introduced later should add to this count
  // intentionally. A drop to 2 means a regression.
  // -------------------------------------------------------------------------
  it('loop.ts has the per-phase-budget check on each retry-or-fail branch (3 call sites)', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const loopSrc = await readFile(join(here, 'loop.ts'), 'utf8');
    const callSiteRegex = /checkPhaseBudgetExhausted\(subtaskIndex\)/g;
    const matches = loopSrc.match(callSiteRegex) ?? [];
    expect(matches.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Per-phase-config phase 7.6 review L1 — "success-past-cap" semantic pin.
  //
  // `phaseBudgetExhaustedMessage` is consulted ONLY from the loop's
  // failure branches (immutable-test violation / no-changes patch /
  // tests-failed). The success-advance paths bump the counter but do
  // NOT gate on it. Result: a phase with `cap: 2` and 5 first-try-
  // success subtasks completes successfully (counter=5, cap=2) — the
  // budget message NEVER fires because no failure path enters the
  // helper.
  //
  // This is the documented behaviour (`phase-budget.ts:32-39`,
  // "Success-at-cap is allowed"). A future maintainer who reads
  // `phaseBudgetExhaustedMessage` in isolation might "fix" the loop
  // to invoke it on every advance, silently changing the user-visible
  // outcome of every config that the validator's tight-budget info
  // currently warns about. This test pins the contract so that
  // regression is caught.
  // -------------------------------------------------------------------------
  it("success-past-cap: a phase whose subtasks all succeed first-try completes even when the counter overshoots the cap (success path doesn't consult the helper)", () => {
    // Phase has 5 subtasks (impl + 2 critic rounds × 2 = 5) and cap=2.
    // Simulate every subtask completing successfully — the loop's
    // success branch ticks the counter but doesn't call
    // `phaseBudgetExhaustedMessage`. The counter overshoots cap; the
    // phase still completes.
    const counts: Record<string, number> = {};
    const cap = 2;
    const active = subtask({ phaseId: 'phase-overshoot', limits: { maxAttempts: cap } });

    // 5 first-try-success subtask completions, each ticking the counter
    // without consulting the failure helper:
    for (let i = 0; i < 5; i++) {
      bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    }
    expect(counts['phase-overshoot']).toBe(5);
    // Counter is well past cap, but no failure branch was reached, so
    // the helper was never invoked — no exhaustion message produced.
    // This pins the "success path does NOT consult the helper" contract:
    // calling it AT THIS POINT would surface a message, but the loop
    // does NOT call it on success. The existence of this test plus the
    // simulator-only test below documents that gap.
    expect(
      phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts }),
    ).not.toBeNull();
    // The user-visible behaviour: had the 6th attempt failed, THEN the
    // helper would be consulted and the message produced. Pin that
    // fail-after-overshoot still names the cap correctly.
    bumpPhaseAttemptCount({ subtask: active, phaseAttemptCount: counts });
    const msg = phaseBudgetExhaustedMessage({ subtask: active, phaseAttemptCount: counts });
    expect(msg).toContain('6/2');
  });
});
