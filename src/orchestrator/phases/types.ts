import type { LiveInfra } from '../../engines/types.js';
import type { RunCommit } from '../../runs/types.js';
import type { SubtaskCodingResult } from './subtask-driver-types.js';

export type {
  OnSubtaskComplete,
  SubtaskCodingResult,
  SubtaskDriverAction,
} from './subtask-driver-types.js';

/** Return shape of `runCodingPhase` (iterative loop coding round). */
export type CodingPhaseResult =
  | {
      outcome: 'completed';
      infra: LiveInfra;
      /** One entry per subtask inner loop that completed while the container was alive. */
      subtaskResults: SubtaskCodingResult[];
    }
  | { outcome: 'paused'; liveInfra: LiveInfra | null; commits: RunCommit[] }
  | { outcome: 'stopped'; commits: RunCommit[] }
  | { outcome: 'inspected' }
  /**
   * Per-phase-config phase 7.5e: the loop's `onSubtaskComplete` returned
   * `kind: 'transition'` because the next subtask requires a Level-2 / 3
   * controlled coder-container restart. The driver wrote the subtask-exit
   * signal (clean shell shutdown) and the engine's `finally` tore down the
   * coder + Leash containers; the sandbox dir is preserved. The outer
   * iterative loop reads this outcome and continues to the next outer
   * attempt, which boots a fresh coder container with the new active
   * subtask's Level-2/3 values (per-attempt opts derivation, also added
   * in 7.5e).
   *
   * `subtaskResults` carries every subtask completion that happened
   * before the transition fired so the loop's per-subtask state (round
   * counters, base-ref captures, etc.) is up-to-date.
   */
  | {
      outcome: 'transitioned';
      subtaskResults: SubtaskCodingResult[];
      /**
       * Field set / cost class echoed back from the
       * `'transition'` `SubtaskDriverAction`. The loop logs them and
       * doesn't otherwise re-derive — the helper in `phase-transition.ts`
       * already wrote them to the persisted `transitionInProgress`
       * snapshot before this outcome was returned.
       */
      fields: readonly string[];
      costClass: 'level-2' | 'level-3' | 'level-2-3';
    };
