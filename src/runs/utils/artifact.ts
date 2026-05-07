/**
 * Builds a RunArtifact from loop state for persistence.
 */

import type { IterativeLoopOpts } from '../../orchestrator/loop.js';
import type {
  OuterAttemptSummary,
  RunArtifact,
  RunCommit,
  RunControlSignal,
  RunInspectSession,
  RunLiveInfra,
  RunRule,
  RunStatus,
  RunSubtask,
  RunTransitionInProgress,
} from '../types.js';
import { syncConfigSubtasksFromArtifact } from './normalize-artifact.js';
import { type PersistedScriptBundle, serializeArtifactConfig } from './serialize.js';

/** Loop options used to derive a {@link RunArtifact}'s persisted `config` — the full {@link IterativeLoopOpts} minus runtime-only fields, plus the script bundle. */
export type BuildRunArtifactOpts = Omit<
  IterativeLoopOpts,
  'registry' | 'runStorage' | 'runContext'
> &
  PersistedScriptBundle & {
    /** Loop-only; stripped before persistence */
    initialErrorFeedback?: string | null;
  };

/** Inputs for {@link buildRunArtifact}: the live loop snapshot (commits, subtasks, status, rules, infra) plus the loop options that get serialized into `config`. */
export interface BuildRunArtifactParams {
  runId: string;
  baseCommitSha: string;
  basePatchDiff: string | undefined;
  runCommits: RunCommit[];
  sandboxHostAppliedCommitCount: number;
  subtasks: RunSubtask[];
  currentSubtaskIndex: number;
  lastFeedback?: string;
  status: RunStatus;
  rules: RunRule[];
  opts: BuildRunArtifactOpts;
  roundSummaries?: OuterAttemptSummary[];
  controlSignal: RunControlSignal | null;
  pausedSandboxBasePath: string | null;
  liveInfra: RunLiveInfra | null;
  /** Omit or `null` for normal runs; only set when persisting an active inspect session. */
  inspectSession?: RunInspectSession | null;
  /**
   * per-phase-config phase 7.5d — set to a {@link RunTransitionInProgress}
   * snapshot while a Level-2/3 controlled coder-container restart is in
   * flight. `null` for runs that aren't transitioning. See
   * {@link RunArtifact#transitionInProgress}.
   */
  transitionInProgress?: RunTransitionInProgress | null;
  /**
   * per-phase-config phase 7.6 — per-phase outer-attempt counter. Empty
   * `{}` for fresh runs and for non-phased subtasks. See
   * {@link RunArtifact#phaseAttemptCount}.
   */
  phaseAttemptCount?: Record<string, number>;
}

/**
 * Constructs a RunArtifact for saving to run storage.
 */
export function buildRunArtifact(params: BuildRunArtifactParams): RunArtifact {
  const now = new Date().toISOString();
  const { initialErrorFeedback: _ignored, ...serializeOpts } = params.opts;
  const config = serializeArtifactConfig(serializeOpts);
  const art: RunArtifact = {
    runId: params.runId,
    baseCommitSha: params.baseCommitSha,
    basePatchDiff: params.basePatchDiff,
    runCommits: params.runCommits,
    sandboxHostAppliedCommitCount: params.sandboxHostAppliedCommitCount,
    subtasks: params.subtasks,
    currentSubtaskIndex: params.currentSubtaskIndex,
    lastFeedback: params.lastFeedback,
    config,
    status: params.status,
    startedAt: now,
    updatedAt: now,
    rules: params.rules ?? [],
    roundSummaries: params.roundSummaries,
    controlSignal: params.controlSignal ?? null,
    pausedSandboxBasePath: params.pausedSandboxBasePath ?? null,
    liveInfra: params.liveInfra ?? null,
    inspectSession: params.inspectSession ?? null,
    transitionInProgress: params.transitionInProgress ?? null,
    phaseAttemptCount: params.phaseAttemptCount ?? {},
  };
  return syncConfigSubtasksFromArtifact(art);
}
