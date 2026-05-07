import type { InnerRoundSummary } from '../../runs/types.js';
import type { SubtaskEnvMap } from '../per-subtask-env.js';

/**
 * Result for one completed subtask inner loop (after `subtask-done` was observed).
 *
 * Lives in a standalone module so {@link ../loop.js} can import it without pulling in
 * types that participate in the `loop` ↔ `run-coding-phase` dependency cycle (which
 * confuses typed lint).
 */
export interface SubtaskCodingResult {
  /** 0-based index into the run's {@link RunArtifact#subtasks}. */
  subtaskIndex: number;
  /**
   * Exit code written by `coder-start.sh` for this subtask's inner loop.
   * `0` = gate (and reviewer if enabled) passed; non-zero = exhausted inner retries or agent failure.
   */
  innerExitCode: number;
  /** Inner round summaries read from `stats.jsonl` immediately after the done signal. */
  innerRounds: InnerRoundSummary[];
}

/**
 * What the host should do after {@link OnSubtaskComplete} runs.
 *
 * For `next` / `retry`, {@link writeSubtaskNextPrompt} is called with `prompt` (full task text for the container).
 */
export type SubtaskDriverAction =
  | {
      kind: 'next';
      /** Written to `saifctl/gate.sh` before the next subtask. */
      gateScript: string;
      /**
       * Written to `saifctl/agent.sh` before the next subtask. Always set —
       * the loop resolves the per-subtask override-or-run-level value, so
       * transitions between phases that don't share an `agent.script`
       * override correctly restore the run-level script.
       */
      agentScript: string;
      /**
       * Written to `saifctl/stage.sh` before the next subtask. Always set —
       * the loop resolves the per-subtask override-or-run-level value, so
       * transitions between phases that don't share a `runner.stage-script`
       * override correctly restore the run-level stage script. The staging
       * container is recreated per `runStagingTestVerification` call (per
       * subtask, not per outer attempt), so a stale `stage.sh` would leak
       * the previous phase's override into the next phase's tests
       * (per-phase-config phase 7.3, Level 4).
       */
      stageScript: string;
      /**
       * Written to `saifctl/subtask-env.sh` before the next subtask.
       * Always set — the loop computes the **full resolved** per-subtask
       * env (run-level baseline + active-row Level-1.5 overrides) plus
       * explicit `unset` directives for any shadow key the active
       * subtask doesn't own. Phase boundaries are idempotent
       * regardless of source order; a phase-only key added by a prior
       * subtask is unset on the way into the next subtask, and a phase
       * that overrides a baseline value reverts cleanly when the
       * subsequent phase doesn't override (per-phase-config 7.4
       * review F-A).
       */
      subtaskEnv: SubtaskEnvMap;
      /** Optional override read from workspace before the next inner loop. */
      gateRetries?: number;
      prompt: string;
    }
  | {
      kind: 'retry';
      prompt: string;
      gateRetries?: number;
    }
  | { kind: 'exit' }
  | { kind: 'abort' }
  /**
   * Per-phase-config phase 7.5e: the next subtask carries
   * `requiresLevel2RestartFromPrev` or `requiresLevel3RestartFromPrev`,
   * so the host wants the coder container to exit cleanly *and* the outer
   * iterative loop to spin up a fresh container against the same sandbox
   * dir for the next outer attempt. Same shell shutdown as `kind: 'exit'`
   * (the driver writes the subtask-exit signal and `coder-start.sh`
   * returns), but the runCodingPhase result is `outcome: 'transitioned'`
   * (not `'completed'`) so the outer loop knows to continue iterating
   * rather than mark the run done. The artifact-side bookkeeping (write
   * `transitionInProgress` → refresh sandbox scripts → clear flag) is
   * driven by the loop BEFORE returning this kind from
   * `onSubtaskComplete`; this signal just plumbs the cleanup back to
   * runCodingPhase.
   */
  | {
      kind: 'transition';
      /**
       * Field paths that triggered the transition (kebab-case YAML form,
       * e.g. `agent.profile`, `container.image`). Stable order matches
       * `phase-transition.ts:detectLevel{2,3}Transition`. Forwarded to
       * the `'transitioned'` `CodingPhaseResult` so the outer loop's
       * log message can name the cost-class fields without re-running
       * the diff.
       */
      fields: readonly string[];
      /** Cost class detected at the boundary; the loop persists this on the artifact snapshot. */
      costClass: 'level-2' | 'level-3' | 'level-2-3';
    };

/** Callback invoked by the subtask driver after each `subtask-done` signal; returns the next {@link SubtaskDriverAction}. */
export type OnSubtaskComplete = (result: SubtaskCodingResult) => Promise<SubtaskDriverAction>;
