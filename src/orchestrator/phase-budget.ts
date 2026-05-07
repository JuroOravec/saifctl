/**
 * per-phase-config phase 7.6 — per-phase outer-attempt budget helper.
 *
 * The orchestrator loop tracks per-phase attempts in
 * `RunArtifact#phaseAttemptCount`, keyed by `RunSubtask.phaseId`, and
 * fail-fasts the run when the active subtask's `limits.maxAttempts` is
 * exhausted. This module owns the pure helpers so the loop's closure
 * state can be unit-tested without standing up a full coding-phase
 * harness.
 */

import type { RunSubtask } from '../runs/types.js';

/**
 * Returns the user-visible budget-exhaustion message when the active
 * phase has met or exceeded its `limits.maxAttempts` cap, or `null` when
 * the phase budget is still in play (no cap declared, no `phaseId`, or
 * count below the cap).
 *
 * Called by `loop.ts:onSubtaskComplete` from each retry-or-fail branch
 * (immutable-test violation, no-changes patch, tests-failed) BEFORE the
 * per-subtask `subtaskAttemptNumber > maxRuns` check so the phase-
 * specific failure mode wins when both fire on the same attempt.
 *
 * The check uses `>=` (not `>`): the increment in `onSubtaskComplete`
 * fires AFTER an attempt completes, so a count of N means N attempts
 * have already been consumed. If `cap === N`, the budget is exhausted —
 * no retry allowed. This matches the design.md §7.6 contract: "phase X
 * exhausted N/N attempts".
 *
 * **Success-at-cap is allowed (review N7).** This helper is only called
 * from FAILURE branches; the success path (gate passed → cursor
 * advances) does NOT consult it. So a successful attempt that ticks
 * the counter to exactly `cap` is allowed to commit and advance to the
 * next phase (per design.md §7.6 reset clarification: "when a phase's
 * gate eventually passes and the loop advances, the counter for the
 * next phase starts at 0"). The fail-fast only fires when an attempt
 * at count >= cap ALSO fails — which is the user-visible meaning of
 * "exhausted the budget."
 */
export function phaseBudgetExhaustedMessage(opts: {
  subtask: RunSubtask | undefined;
  phaseAttemptCount: Readonly<Record<string, number>>;
}): string | null {
  const phaseId = opts.subtask?.phaseId;
  const cap = opts.subtask?.limits?.maxAttempts;
  if (!phaseId || cap === undefined) return null;
  const used = opts.phaseAttemptCount[phaseId] ?? 0;
  if (used < cap) return null;
  // Pluralisation (review N6): "1/1 attempt." vs. "3/3 attempts." —
  // pluralise on the cap rather than the count so a defence-in-depth
  // overshoot ("5/2 attempts.") still reads naturally.
  const noun = cap === 1 ? 'attempt' : 'attempts';
  return (
    `Phase '${phaseId}' exhausted ${used}/${cap} ${noun}. ` +
    `Increase \`limits.max-attempts\` for this phase or fix the underlying failure.`
  );
}

/**
 * Increment the per-phase counter for the active subtask's phase.
 * No-op when the subtask has no `phaseId` (legacy / non-phased path)
 * or is `undefined` (cursor out of range — defensive).
 *
 * Mutates `phaseAttemptCount` in place. The loop's closure variable is
 * the single source of truth for the live count; the persist site
 * `loop.ts:persistArtifact` takes a defensive `{...}` copy when writing
 * to the artifact so concurrent callers (today: none; tomorrow:
 * possible) cannot observe a torn state. Callers that want to defend
 * against shared mutation should clone before passing the map in.
 *
 * **Engine-crash semantic (review N2).** The bump fires from
 * `loop.ts:onSubtaskComplete`, which is only invoked when the engine
 * driver receives a clean `subtask-done` signal. An engine container
 * that exits without that signal (the `SAIFCTL_ENGINE_EXITED_REASON`
 * abort path in `runCodingPhase`) does NOT tick the counter — and
 * symmetrically does not tick the run-level `attempts++` either, so the
 * two stay in sync. The trade-off: a flaky engine that crashes
 * repeatedly mid-attempt can consume wall-clock without burning
 * `limits.max-attempts`. Acceptable in v1 because (a) engine crashes
 * are rare and visible (the loop logs them loudly), (b) counting them
 * would require threading the bump through `runCodingPhase`'s
 * post-engine path, which couples this module to the engine layer.
 * Revisit if engine-crash budgets become a real concern.
 *
 * **Host-crash / silent-persist-failure semantic (review M2).** The
 * bump mutates `phaseAttemptCount` in memory; the persisted increment
 * lands on disk only when a subsequent `saveRunningArtifact` /
 * `saveRoundProgress` succeeds. Two windows leave the budget tick
 * unrecorded:
 *   - Host process killed (SIGKILL / OOM / power-off) between the
 *     bump and the next save.
 *   - `persistArtifact` catches a non-stale storage error silently
 *     (the default warn-and-continue path; the H1 fix from 7.5e
 *     opted-in `transitionInProgress` to `throwOnError` but
 *     `phaseAttemptCount` writes still go through the warn path).
 * Either case lets `run resume` re-seed from the pre-bump count and
 * effectively re-run the subtask without burning a budget point. This
 * is consistent with the engine-crash semantic above (host crash and
 * engine crash both produce a free retry) and is acceptable in v1
 * because the budget is a soft cap on agent-driven work, not a
 * security boundary — a user who can already kill the orchestrator
 * process can also wipe the run artifact entirely. If "host-crash =
 * free retry" becomes a tampering concern, route budget-bearing
 * `saveRoundProgress` calls through `throwOnError` the same way 7.5e
 * does for the transition snapshot.
 */
export function bumpPhaseAttemptCount(opts: {
  subtask: RunSubtask | undefined;
  phaseAttemptCount: Record<string, number>;
}): void {
  const phaseId = opts.subtask?.phaseId;
  if (!phaseId) return;
  opts.phaseAttemptCount[phaseId] = (opts.phaseAttemptCount[phaseId] ?? 0) + 1;
}
