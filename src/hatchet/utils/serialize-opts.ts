/**
 * Serialization / deserialization of OrchestratorOpts for Hatchet workflow I/O.
 *
 * Hatchet requires all workflow inputs/outputs to be JSON-serializable (JsonObject).
 * OrchestratorOpts contains non-serializable values (gitProvider class instance,
 * testProfile class instance, patchExclude RegExp). This module converts to/from
 * plain objects that can cross the Hatchet wire protocol.
 *
 * The pattern mirrors `serializeArtifactConfig` / `deserializeArtifactConfig` in
 * src/runs/utils/serialize.ts but includes the extra OrchestratorOpts fields.
 */

import { getGitProvider } from '../../git/index.js';
import type { OrchestratorOpts } from '../../orchestrator/modes.js';
import type { PatchExcludeRule } from '../../orchestrator/sandbox.js';
import { createRunStorage } from '../../runs/storage.js';
import type {
  OuterAttemptSummary,
  RunCommit,
  RunRule,
  RunSubtask,
  RunSubtaskInput,
  RunTransitionInProgress,
} from '../../runs/types.js';
import type { SerializedPatchExcludeRule } from '../../runs/utils/serialize.js';
import { resolveTestProfile } from '../../test-profiles/index.js';

/**
 * JSON-serializable wire form of `OrchestratorOpts` for Hatchet workflow I/O.
 * Class instances (gitProvider, testProfile) become ids; RegExp `patchExclude`
 * becomes a string spec; `runStorage` becomes its URI.
 */
export interface SerializedOrchestratorOpts extends Record<string, unknown> {
  sandboxProfileId: string;
  agentProfileId: string;
  featureName: string;
  featureAbsolutePath: string;
  featureRelativePath: string;
  projectDir: string;
  maxRuns: number;
  /** Same as {@link maxRuns} — per-subtask outer attempts (stored explicitly for artifact parity). */
  maxAttemptsPerSubtask?: number;
  llm: Record<string, unknown>;
  saifctlDir: string;
  projectName: string;
  testImage: string;
  resolveAmbiguity: 'off' | 'prompt' | 'ai';
  /** Total wall-clock budget for the run, ms; `null` = unbounded. */
  runTimeoutMs: number | null;
  /** Per-subtask wall-clock budget, ms; `null` = disabled. */
  subtaskTimeoutMs: number | null;
  dangerousNoLeash?: boolean;
  cedarPolicyPath: string;
  cedarScript: string;
  coderImage: string;
  push: string | null;
  pr: boolean;
  targetBranch?: string | null;
  gitProviderId: string;
  gateRetries: number;
  agentEnv: Record<string, string>;
  agentSecretKeys: string[];
  agentSecretFiles?: string[];
  testScript: string;
  testProfileId: string;
  testRetries: number;
  reviewerEnabled: boolean;
  allowSaifctlInPatch: boolean;
  subtasks?: RunSubtaskInput[];
  currentSubtaskIndex?: number;
  patchExcludeStr?: SerializedPatchExcludeRule[];
  stagingEnvironment: Record<string, unknown>;
  codingEnvironment: Record<string, unknown>;
  // OrchestratorOpts-specific
  sandboxBaseDir: string;
  gateScript: string;
  startupScript: string;
  agentInstallScript: string;
  agentScript: string;
  stageScript: string;
  startupScriptFile: string;
  gateScriptFile: string;
  stageScriptFile: string;
  testScriptFile: string;
  agentInstallScriptFile: string;
  agentScriptFile: string;
  fromArtifact: {
    sandboxSourceDir: string;
    baseSnapshotPath?: string;
    seedRunCommits?: RunCommit[];
    seedRoundSummaries?: OuterAttemptSummary[];
    initialErrorFeedback?: string;
    persistedRunId?: string;
    artifactRevisionWhenFromArtifact?: number;
    seedSubtasks?: RunSubtask[];
    currentSubtaskIndex?: number;
    sandboxHostAppliedCommitCount: number;
    /**
     * per-phase-config phase 7.6 — per-phase outer-attempt counter seed.
     * Distributed-mode `run start <id>` MUST carry this across the
     * Hatchet wire so the worker re-seeds the loop's closure from the
     * persisted artifact. Dropping it here lets the user reset the
     * budget by re-running, which violates the design.md §7.6 monotone-
     * within-Run-identity contract.
     */
    seedPhaseAttemptCount?: Record<string, number>;
    /**
     * per-phase-config phases 7.5d / 7.5e — crashed-mid-transition
     * recovery seed. When set, the worker's first outer-iteration pass
     * runs `completeControlledRestart` BEFORE booting the next coder
     * container so a Hatchet-dispatched resume after a crashed transition
     * recovers idempotently rather than activating the new active
     * subtask against stale bind-mounted scripts.
     */
    transitionInProgress?: RunTransitionInProgress | null;
    runContext: {
      baseCommitSha: string;
      basePatchDiff?: string;
      lastErrorFeedback?: string;
      rules?: RunRule[];
    };
  } | null;
  /** URI passed to createRunStorage, or null when storage is disabled. */
  runStorageUri: string | null;
  /** When true, verbose logs are enabled. */
  verbose?: boolean;
  /** When true, sandbox includes uncommitted/untracked files. */
  includeDirty?: boolean;
  /** Block 7: project-wide default for `tests.mutable`. */
  strict?: boolean;
  skipStagingTests?: boolean;
  sandboxExtract?: 'none' | 'host-apply' | 'host-apply-filtered';
  sandboxExtractInclude?: string;
  sandboxExtractExclude?: string;
}

/**
 * Convert in-memory `OrchestratorOpts` into the JSON-only shape Hatchet can
 * carry across worker boundaries. The reverse is {@link deserializeOrchestratorOpts}.
 */
export function serializeOrchestratorOpts(opts: OrchestratorOpts): SerializedOrchestratorOpts {
  const {
    feature,
    gitProvider,
    testProfile,
    patchExclude,
    runStorage: _rs,
    fromArtifact,
    ...rest
  } = opts;
  return {
    ...rest,
    maxAttemptsPerSubtask: rest.maxRuns,
    featureName: feature.name,
    featureAbsolutePath: feature.absolutePath,
    featureRelativePath: feature.relativePath,
    gitProviderId: gitProvider.id,
    testProfileId: testProfile.id,
    patchExcludeStr: patchExclude?.map((rule) => ({
      type: rule.type,
      pattern: rule.type === 'regex' ? (rule.pattern as RegExp).source : (rule.pattern as string),
    })),
    fromArtifact: fromArtifact
      ? {
          sandboxSourceDir: fromArtifact.sandboxSourceDir,
          baseSnapshotPath: fromArtifact.baseSnapshotPath,
          seedRunCommits: fromArtifact.seedRunCommits,
          seedRoundSummaries: fromArtifact.seedRoundSummaries,
          initialErrorFeedback: fromArtifact.initialErrorFeedback,
          persistedRunId: fromArtifact.persistedRunId,
          artifactRevisionWhenFromArtifact: fromArtifact.artifactRevisionWhenFromArtifact,
          seedSubtasks: fromArtifact.seedSubtasks,
          currentSubtaskIndex: fromArtifact.currentSubtaskIndex,
          sandboxHostAppliedCommitCount: fromArtifact.sandboxHostAppliedCommitCount,
          // per-phase-config phase 7.6 review H1: thread the per-phase
          // budget seed across the Hatchet wire. Without this, distributed-
          // mode `run start <id>` resets the counter to `{}` and the
          // user has bypassed `limits.max-attempts` by re-dispatching.
          seedPhaseAttemptCount: fromArtifact.seedPhaseAttemptCount,
          // per-phase-config 7.5d/7.5e — crashed-transition recovery
          // seed (sister field to `transitionInProgress` on the artifact).
          // Dropping this in distributed mode breaks crash recovery for
          // Level-2/3 boundaries.
          transitionInProgress: fromArtifact.transitionInProgress,
          runContext: {
            baseCommitSha: fromArtifact.runContext.baseCommitSha,
            basePatchDiff: fromArtifact.runContext.basePatchDiff,
            lastErrorFeedback: fromArtifact.runContext.lastErrorFeedback,
            rules: fromArtifact.runContext.rules,
          },
        }
      : null,
    runStorageUri: opts.runStorage?.uri ?? null,
  } as unknown as SerializedOrchestratorOpts;
}

/**
 * Reconstruct OrchestratorOpts from the serialized form.
 * All fields are derived purely from the serialized wire data — no ambient
 * in-process object is needed, making this safe to call in a remote worker.
 */
export function deserializeOrchestratorOpts(serialized: Record<string, unknown>): OrchestratorOpts {
  const s = serialized as SerializedOrchestratorOpts;

  const patchExclude: PatchExcludeRule[] | undefined = s.patchExcludeStr?.map((rule) =>
    rule.type === 'regex'
      ? { type: 'regex' as const, pattern: new RegExp(rule.pattern) }
      : { type: 'glob' as const, pattern: rule.pattern },
  );

  const subtasks: RunSubtaskInput[] =
    Array.isArray(s.subtasks) && s.subtasks.length > 0
      ? s.subtasks
      : [{ content: `Implement feature: ${s.featureName}`, title: s.featureName }];

  const currentSubtaskIndex =
    typeof s.currentSubtaskIndex === 'number' && Number.isFinite(s.currentSubtaskIndex)
      ? Math.max(0, Math.floor(s.currentSubtaskIndex))
      : 0;

  return {
    sandboxProfileId: s.sandboxProfileId as OrchestratorOpts['sandboxProfileId'],
    agentProfileId: s.agentProfileId as OrchestratorOpts['agentProfileId'],
    feature: {
      name: s.featureName,
      absolutePath: s.featureAbsolutePath,
      relativePath: s.featureRelativePath,
    },
    projectDir: s.projectDir,
    maxRuns:
      typeof s.maxAttemptsPerSubtask === 'number' && Number.isFinite(s.maxAttemptsPerSubtask)
        ? Math.max(1, Math.floor(s.maxAttemptsPerSubtask))
        : typeof s.maxRuns === 'number' && Number.isFinite(s.maxRuns)
          ? Math.max(1, Math.floor(s.maxRuns))
          : 5,
    llm: s.llm,
    saifctlDir: s.saifctlDir,
    projectName: s.projectName,
    testImage: s.testImage,
    resolveAmbiguity: s.resolveAmbiguity,
    runTimeoutMs: s.runTimeoutMs,
    subtaskTimeoutMs: s.subtaskTimeoutMs,
    dangerousNoLeash: s.dangerousNoLeash ?? false,
    cedarPolicyPath: s.cedarPolicyPath,
    cedarScript: s.cedarScript,
    coderImage: s.coderImage,
    push: s.push,
    pr: s.pr,
    targetBranch: s.targetBranch ?? null,
    gitProvider: getGitProvider(s.gitProviderId),
    gateRetries: s.gateRetries,
    agentEnv: s.agentEnv,
    agentSecretKeys: s.agentSecretKeys ?? [],
    agentSecretFiles: s.agentSecretFiles ?? [],
    testScript: s.testScript,
    testProfile: resolveTestProfile(s.testProfileId),
    testRetries: s.testRetries,
    reviewerEnabled: s.reviewerEnabled,
    allowSaifctlInPatch: !!s.allowSaifctlInPatch,
    subtasks,
    currentSubtaskIndex,
    enableSubtaskSequence: subtasks.length > 1,
    patchExclude,
    stagingEnvironment: s.stagingEnvironment as OrchestratorOpts['stagingEnvironment'],
    codingEnvironment: s.codingEnvironment as OrchestratorOpts['codingEnvironment'],
    sandboxBaseDir: s.sandboxBaseDir,
    gateScript: s.gateScript,
    startupScript: s.startupScript,
    agentInstallScript: s.agentInstallScript,
    agentScript: s.agentScript,
    stageScript: s.stageScript,
    startupScriptFile: s.startupScriptFile,
    gateScriptFile: s.gateScriptFile,
    stageScriptFile: s.stageScriptFile,
    testScriptFile: s.testScriptFile,
    agentInstallScriptFile: s.agentInstallScriptFile,
    agentScriptFile: s.agentScriptFile,
    fromArtifact: s.fromArtifact
      ? {
          sandboxSourceDir: s.fromArtifact.sandboxSourceDir,
          baseSnapshotPath: s.fromArtifact.baseSnapshotPath,
          seedRunCommits: s.fromArtifact.seedRunCommits ?? [],
          seedRoundSummaries: s.fromArtifact.seedRoundSummaries,
          initialErrorFeedback: s.fromArtifact.initialErrorFeedback,
          persistedRunId: s.fromArtifact.persistedRunId,
          artifactRevisionWhenFromArtifact: s.fromArtifact.artifactRevisionWhenFromArtifact,
          seedSubtasks: s.fromArtifact.seedSubtasks,
          currentSubtaskIndex: s.fromArtifact.currentSubtaskIndex,
          sandboxHostAppliedCommitCount: s.fromArtifact.sandboxHostAppliedCommitCount ?? 0,
          // per-phase-config phase 7.6 review H1: restore the per-phase
          // budget seed on the worker side so the loop's closure starts
          // from the persisted count rather than `{}`. Defaults to `{}`
          // for back-compat with workers that received pre-7.6 wire forms.
          seedPhaseAttemptCount: s.fromArtifact.seedPhaseAttemptCount ?? {},
          // per-phase-config 7.5d/7.5e — restore the crashed-transition
          // recovery seed. `null` is the "no transition in flight" state.
          transitionInProgress: s.fromArtifact.transitionInProgress ?? null,
          runContext: {
            ...s.fromArtifact.runContext,
            rules: s.fromArtifact.runContext.rules ?? [],
          },
          // NOTE: The stored "infra" is not passed through here.
          // It's serialized as part of the RunArtifact and deserialized separately.
          // This field is included only for completeness.
          resumedCodingInfra: null,
        }
      : null,
    runStorage: s.runStorageUri ? createRunStorage(s.runStorageUri, s.projectDir) : null,
    verbose: !!s.verbose,
    includeDirty: s.includeDirty ?? false,
    strict: s.strict ?? true,
    testOnly: false,
    skipStagingTests: s.skipStagingTests ?? false,
    sandboxExtract: s.sandboxExtract ?? 'none',
    sandboxExtractInclude: s.sandboxExtractInclude,
    sandboxExtractExclude: s.sandboxExtractExclude,
  };
}
