import type { LiveInfra } from '../../engines/types.js';
import type { InnerRoundSummary, RunCommit } from '../../runs/types.js';

/** Return shape of `runCodingPhase` (iterative loop coding round). */
export type CodingPhaseResult =
  | { outcome: 'completed'; infra: LiveInfra; innerRounds: InnerRoundSummary[] }
  | { outcome: 'paused'; liveInfra: LiveInfra | null; commits: RunCommit[] }
  | { outcome: 'stopped'; commits: RunCommit[] }
  | { outcome: 'inspected' };
