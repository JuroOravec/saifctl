/**
 * Run storage types for persisting agent run artifacts.
 *
 * Persisted for every run when storage is enabled (completed or failed) for `run ls`, resume, and tests.
 */

import type { SerializedLoopOpts } from './utils/serialize.js';

export type RunStatus = 'failed' | 'completed';

/**
 * One incremental commit in the sandbox / resume worktree (message + unified diff + optional author).
 * Diffs apply in order on top of `baseCommitSha` + optional `basePatchDiff` + prior steps.
 */
export interface RunPatchStep {
  message: string;
  diff: string;
  /** Git author line, e.g. `Name <email>`. Defaults to saifac when omitted on apply. */
  author?: string;
}

/** Options for {@link RunStorage.saveRun} compare-and-swap updates. */
export interface RunSaveOptions {
  /**
   * When set, the save succeeds only if the stored artifact's
   * {@link RunArtifact#artifactRevision} (missing treated as 0) equals this value.
   * Used by `run inspect` and other concurrent writers to avoid clobbering.
   */
  ifRevisionEquals?: number;
}

export class StaleArtifactError extends Error {
  override readonly name = 'StaleArtifactError';

  constructor(opts: {
    readonly runId: string;
    readonly expectedRevision: number;
    readonly actualRevision: number;
  }) {
    const { runId, expectedRevision, actualRevision } = opts;
    super(
      `Run "${runId}" artifact revision mismatch: expected ${expectedRevision}, stored ${actualRevision}. ` +
        `Another process may have updated this run; reload the artifact and retry.`,
    );
  }
}

export interface RunArtifact {
  runId: string;
  taskId?: string;

  /**
   * Monotonic counter (only goes up) incremented on every successful {@link RunStorage.saveRun}.
   * Assigned by storage (callers should omit when building a new artifact).
   */
  artifactRevision?: number;

  /** Git commit SHA when the run started */
  baseCommitSha: string;
  /** Uncommitted changes at run start (git diff + git diff --cached) */
  basePatchDiff?: string;
  /** Incremental coding rounds / inspect sessions (apply in order; each diff is one replayed commit; one outer round may add several). */
  runPatchSteps: RunPatchStep[];

  /** Feature path, e.g. saifac/features/feat-stripe-webhooks */
  specRef: string;
  /** Sanitized test failure summary for Ralph Wiggum feedback */
  lastFeedback?: string;

  /** Serialized CLI config used for this run */
  config: SerializedLoopOpts;

  status: RunStatus;
  startedAt: string;
  updatedAt: string;
}

/** Domain interface for run storage. Implemented by RunsStorage. */
export interface RunStorage {
  /** The URI used to create this storage instance (e.g. "local", "s3://bucket/prefix"). */
  readonly uri: string;
  /**
   * Persists the artifact and sets {@link RunArtifact#artifactRevision} to (previous revision ?? 0) + 1.
   * Preserves `startedAt` and `taskId` from an existing record when appropriate (fresh builds often reset `startedAt`).
   */
  saveRun(runId: string, artifact: RunArtifact, options?: RunSaveOptions): Promise<void>;
  getRun(runId: string): Promise<RunArtifact | null>;
  listRuns(filter?: { taskId?: string; status?: RunStatus }): Promise<RunArtifact[]>;
  deleteRun(runId: string): Promise<void>;
  clearRuns(filter?: { taskId?: string; status?: RunStatus }): Promise<void>;
}
