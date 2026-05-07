/**
 * Serialization of IterativeLoopOpts for run storage.
 *
 * Converts non-JSON-serializable fields (gitProvider, testProfile, patchExclude RegExp)
 * to string/plain-object forms for persistence.
 */

import { resolveAgentProfile } from '../../agent-profiles/index.js';
import { snapshotProfileOptionsFromEnv } from '../../agent-profiles/options-bridge.js';
import type { SupportedAgentProfileId } from '../../agent-profiles/types.js';
import type {
  NormalizedCodingEnvironment,
  NormalizedStagingEnvironment,
} from '../../config/schema.js';
import { DEFAULT_ORCHESTRATOR_MAX_RUNS } from '../../constants.js';
import { getGitProvider } from '../../git/index.js';
import type { GitProvider } from '../../git/types.js';
import type { LlmOverrides } from '../../llm-config.js';
import type { IterativeLoopOpts } from '../../orchestrator/loop.js';
import type { PatchExcludeRule } from '../../orchestrator/sandbox.js';
import { resolveTestProfile, type TestProfile } from '../../test-profiles/index.js';
import type { RunSubtaskInput } from '../types.js';

/** JSON-serializable form of patch exclude rules (RegExp -> pattern string) */
export interface SerializedPatchExcludeRule {
  type: 'glob' | 'regex';
  pattern: string;
}

/**
 * Script bodies plus reporting paths — required when serializing opts for run storage.
 * Execution uses the script strings; *File fields are for artifacts / tooling only.
 */
export interface PersistedScriptBundle {
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
}

/**
 * JSON-serializable form of IterativeLoopOpts plus script bundle.
 * Used as RunArtifact.config for persistence.
 */
export type SerializedLoopOpts = {
  sandboxProfileId: string;
  agentProfileId: SupportedAgentProfileId;
  featureName: string;
  /** Repo-relative path to the feature directory (e.g. saifctl/features/my-feat). */
  featureRelativePath: string;
  projectDir: string;
  /** Max outer attempts per subtask (formerly `maxRuns` on persisted artifacts). */
  maxAttemptsPerSubtask: number;
  /** Subtask definitions (single-task runs use one element). */
  subtasks: RunSubtaskInput[];
  /** Effective LLM config (models + base URLs) for this run. */
  llm: LlmOverrides;
  saifctlDir: string;
  projectName: string;
  testImage: string;
  resolveAmbiguity: 'off' | 'prompt' | 'ai';
  /** Total wall-clock budget for the run, ms; `null` = unbounded. */
  runTimeoutMs: number | null;
  /** Per-subtask wall-clock budget, ms; `null` = disabled. */
  subtaskTimeoutMs: number | null;
  dangerousNoLeash: boolean;
  cedarPolicyPath: string;
  cedarScript: string;
  coderImage: string;
  push: string | null;
  pr: boolean;
  targetBranch?: string | null;
  gitProviderId: string;
  gateRetries: number;
  agentEnv: Record<string, string>;
  /** Host env var names only; values are re-read from `process.env` when starting from a Run. */
  agentSecretKeys: string[];
  /**
   * Project-relative secret file paths (`KEY=value` .env files). Re-read when starting from a Run; values are not
   * stored in the artifact.
   */
  agentSecretFiles?: string[];
  testScript: string;
  testProfileId: string;
  testRetries: number;
  reviewerEnabled: boolean;
  includeDirty: boolean;
  /** When true, saifctl/ paths are not stripped from run commit diffs (POC designer). */
  allowSaifctlInPatch?: boolean;
  /** When true, staging + tests are skipped (`saifctl sandbox` / POC designer). */
  skipStagingTests?: boolean;
  /** Host apply mode after sandbox agent when tests are skipped. */
  sandboxExtract?: 'none' | 'host-apply' | 'host-apply-filtered';
  sandboxExtractInclude?: string;
  sandboxExtractExclude?: string;
  patchExcludeStr?: SerializedPatchExcludeRule[];
  /**
   * Normalized staging environment — always present.
   * Contains `app` (with DEFAULT_STAGING_APP defaults), `appEnvironment`,
   * and the engine config (type, file/chart). Used to configure the staging
   * container and to instantiate the engine JIT when resuming a run.
   */
  stagingEnvironment: NormalizedStagingEnvironment;
  /**
   * Normalized coding environment — always present (defaults to `{ engine: 'docker' }`).
   * Persisted so that the coding engine stack can be re-used correctly when starting from a Run.
   */
  codingEnvironment: NormalizedCodingEnvironment;
  /** When true, verbose logs are enabled. */
  verbose?: boolean;
  /**
   * Snapshot of the agent profile's resolved options
   * (`--<id>-<name>` flags), captured at run-start time. Keyed by profile
   * id so the same artifact can carry options for past agent profiles
   * (e.g. after `run fork` switches `agentProfileId`). Each inner map's
   * keys are the option names declared by the profile; values are the
   * resolved scalars after applying the CLI > config > default chain.
   *
   * Used by `run start` / `run resume` / `run test` to replay the run
   * with the exact same profile options, independent of how
   * `saifctl/config.ts` has evolved since. CLI flags passed at replay
   * time still take precedence (artifact wins over config, not over
   * fresh CLI args).
   *
   * Optional for backwards compatibility: artifacts written before this
   * field landed will replay using whatever `saifctl/config.ts` contains
   * at replay time (the previous behavior).
   */
  agentOptions?: Record<string, Record<string, string | number | boolean>>;
} & PersistedScriptBundle;

/** Serializes loop options for persistence: drops ephemeral fields, replaces non-JSON values (gitProvider/testProfile/RegExp patches) with stable id/string forms. */
export function serializeArtifactConfig(
  opts: IterativeLoopOpts & PersistedScriptBundle,
): SerializedLoopOpts {
  // Ephemeral CLI mode — never persist (`run start` must run the full agent loop).
  const {
    feature,
    gitProvider,
    testProfile,
    patchExclude,
    testOnly: _testOnly,
    seedRunCommits: _seedRunCommits,
    seedRoundSummaries: _seedRoundSummaries,
    maxRuns,
    subtasks: optSubtasks,
    ...rest
  } = opts;

  const subtasks: RunSubtaskInput[] =
    optSubtasks && optSubtasks.length > 0
      ? optSubtasks
      : [{ content: `Implement feature: ${feature.name}`, title: feature.name }];

  // Snapshot resolved profile options from the env-var protocol so the
  // run replays with exactly the values it was started with. Agent
  // profiles only — designer/indexer profiles run at design time, not
  // run time, so they don't belong on the run artifact.
  const agentOptions = snapshotAgentOptionsForArtifact(opts.agentProfileId);

  return {
    ...rest,
    featureName: feature.name,
    featureRelativePath: feature.relativePath,
    maxAttemptsPerSubtask: maxRuns,
    subtasks,
    gitProviderId: gitProvider.id,
    testProfileId: testProfile.id,
    patchExcludeStr: patchExclude?.map((rule) => ({
      type: rule.type,
      pattern: rule.type === 'regex' ? (rule.pattern as RegExp).source : (rule.pattern as string),
    })),
    ...(agentOptions ? { agentOptions } : {}),
  };
}

/**
 * Snapshot the active agent profile's resolved options into the
 * `agentOptions` map shape expected by {@link SerializedLoopOpts}.
 * Returns `undefined` when the profile declares no options (so we don't
 * persist an empty record), or when the profile id can't be resolved
 * (defensive — should not happen in practice since the orchestrator
 * has already used the profile by serialize time).
 */
function snapshotAgentOptionsForArtifact(
  agentProfileId: SupportedAgentProfileId,
): SerializedLoopOpts['agentOptions'] {
  let profile;
  try {
    profile = resolveAgentProfile(agentProfileId);
  } catch {
    return undefined;
  }
  if (!profile.options || profile.options.length === 0) return undefined;
  const snap = snapshotProfileOptionsFromEnv(profile);
  if (Object.keys(snap).length === 0) return undefined;
  return { [agentProfileId]: snap };
}

/**
 * Converts SerializedLoopOpts (persisted config JSON) back to the shape
 * expected by runIterativeLoop.
 */
export type DeserializeArtifactConfigInput = SerializedLoopOpts & {
  maxRuns?: number;
};

/** Inverse of {@link serializeArtifactConfig}: rehydrates gitProvider/testProfile instances and `RegExp` patch rules from the persisted form. */
export function deserializeArtifactConfig(serialized: DeserializeArtifactConfigInput): Omit<
  SerializedLoopOpts,
  'gitProviderId' | 'testProfileId' | 'patchExcludeStr' | 'maxAttemptsPerSubtask' | 'subtasks'
> & {
  gitProvider: GitProvider;
  testProfile: TestProfile;
  patchExclude?: PatchExcludeRule[];
  /** Restored for {@link IterativeLoopOpts#maxRuns}. */
  maxRuns: number;
  subtasks: RunSubtaskInput[];
} {
  const maxRuns =
    typeof serialized.maxAttemptsPerSubtask === 'number'
      ? serialized.maxAttemptsPerSubtask
      : typeof serialized.maxRuns === 'number'
        ? serialized.maxRuns
        : DEFAULT_ORCHESTRATOR_MAX_RUNS;

  const featureName = String(serialized.featureName ?? '');
  const saifctlDir = String(serialized.saifctlDir ?? 'saifctl');
  const subtasks: RunSubtaskInput[] =
    Array.isArray(serialized.subtasks) && serialized.subtasks.length > 0
      ? serialized.subtasks
      : [
          {
            content: `Implement feature: ${featureName || 'run'}`,
            title: featureName || undefined,
          },
        ];

  const featureRelativePath =
    typeof serialized.featureRelativePath === 'string' && serialized.featureRelativePath.trim()
      ? serialized.featureRelativePath.trim()
      : `${saifctlDir}/features/${featureName}`;

  const {
    gitProviderId,
    testProfileId,
    patchExcludeStr,
    agentSecretFiles: _agentSecretFilesIn,
    llm,
    maxAttemptsPerSubtask: _m,
    maxRuns: _legacyMr,
    subtasks: _st,
    featureRelativePath: _frp,
    ...rest
  } = serialized;

  // Pre-timeouts artifacts won't have runTimeoutMs / subtaskTimeoutMs.
  // Backfill with the defaults: unbounded run / 1h subtask. Resuming an
  // older run keeps the same loose-bound semantics it had before this
  // patch landed (no AGENT_TIMEOUT_MS hardcap anymore).
  const runTimeoutMs =
    typeof serialized.runTimeoutMs === 'number' || serialized.runTimeoutMs === null
      ? serialized.runTimeoutMs
      : null;
  const subtaskTimeoutMs =
    typeof serialized.subtaskTimeoutMs === 'number' || serialized.subtaskTimeoutMs === null
      ? serialized.subtaskTimeoutMs
      : 60 * 60 * 1000;

  return {
    ...rest,
    featureRelativePath,
    llm,
    agentSecretKeys: serialized.agentSecretKeys ?? [],
    agentSecretFiles: serialized.agentSecretFiles ?? [],
    gitProvider: getGitProvider(gitProviderId),
    testProfile: resolveTestProfile(testProfileId),
    patchExclude: patchExcludeStr?.map((rule) =>
      rule.type === 'regex'
        ? { type: 'regex' as const, pattern: new RegExp(rule.pattern) }
        : { type: 'glob' as const, pattern: rule.pattern },
    ),
    maxRuns,
    runTimeoutMs,
    subtaskTimeoutMs,
    subtasks,
  };
}
