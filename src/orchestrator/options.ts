/**
 * Orchestrator option merge and resolution: CLI/artifact layers, LLM config, and full {@link OrchestratorOpts} resolution.
 */

import { isAbsolute, resolve } from 'node:path';

import { DEFAULT_AGENT_PROFILE, resolveAgentProfile } from '../agent-profiles/index.js';
import type { AgentProfile } from '../agent-profiles/types.js';
import {
  KEY_EQ_PATTERN,
  loadAgentScriptsFromPicks,
  loadGateScriptFromPick,
  loadStageScriptFromPick,
  loadStartupScriptFromPick,
  loadTestScriptFromPick,
  mergeAgentEnvFromReads,
  parseCommaSeparatedOverrides,
  resolveProjectName,
  resolveRunStorage,
} from '../cli/utils.js';
import {
  DEFAULT_STAGING_APP,
  type NormalizedCodingEnvironment,
  type NormalizedStagingEnvironment,
  type SaifctlConfig,
  type StagingAppConfig,
} from '../config/schema.js';
import {
  DEFAULT_DANGEROUS_NO_LEASH,
  DEFAULT_ORCHESTRATOR_GATE_RETRIES,
  DEFAULT_ORCHESTRATOR_MAX_RUNS,
  DEFAULT_ORCHESTRATOR_TEST_RETRIES,
  DEFAULT_RESOLVE_AMBIGUITY,
  DEFAULT_REVIEWER_ENABLED,
  defaultCedarPolicyPath,
} from '../constants.js';
import { getGitProvider } from '../git/index.js';
import type { GitProvider } from '../git/types.js';
import { isSupportedAgentName, type LlmOverrides, SUPPORTED_AGENT_NAMES } from '../llm-config.js';
import { consola } from '../logger.js';
import type { RunArtifact, RunSubtaskInput } from '../runs/types.js';
import { deserializeArtifactConfig } from '../runs/utils/serialize.js';
import { runSubtasksToInputs } from '../runs/utils/subtasks.js';
import { DEFAULT_SANDBOX_PROFILE, resolveSandboxProfile } from '../sandbox-profiles/index.js';
import type { SandboxProfile } from '../sandbox-profiles/types.js';
import type { Feature } from '../specs/discover.js';
import { loadFeatureConfig } from '../specs/phases/load.js';
import type { AgentConfig, ContainerConfig, FeatureConfig } from '../specs/phases/schema.js';
import {
  resolveFeatureLevelScriptPath,
  ScriptNotARegularFileError,
  ScriptNotFoundError,
  ScriptOutsideProjectError,
} from '../specs/phases/script-resolver.js';
import { DEFAULT_TEST_PROFILE, resolveTestProfile } from '../test-profiles/index.js';
import type { TestProfile } from '../test-profiles/types.js';
import { validateImageTag } from '../utils/docker.js';
import { readUtf8 } from '../utils/io.js';
import { mergeAgentSecretKeysFromReads } from './agent-env.js';
import type { OrchestratorOpts } from './modes.js';
import { loadSubtasksFromFile, resolveSubtasks } from './resolve-subtasks.js';
import { DEFAULT_SANDBOX_BASE_DIR } from './sandbox.js';
import { resolveTimeouts } from './timeouts.js';

// ---------------------------------------------------------------------------
// LLM overrides: config baseline → artifact → CLI delta
// ---------------------------------------------------------------------------

/** Agent name (key before =) must not contain comma, whitespace, or equals. */
const MODEL_AGENT_NAME_PATTERN = /^[^,\s=]+$/;

/**
 * Merges LLM overrides layers in order — config baseline, then artifact, then CLI delta —
 * with later layers winning per-field. Field maps (`agentModels`, `agentBaseUrls`) merge by key.
 */
export function mergeLlmOverridesLayers( // eslint-disable-line max-params -- three explicit layers
  configBaseline: LlmOverrides,
  artifact?: LlmOverrides,
  cliDelta?: LlmOverrides,
): LlmOverrides {
  const out: LlmOverrides = { ...configBaseline };

  const apply = (layer?: LlmOverrides) => {
    if (!layer) return;
    if (layer.globalModel !== undefined) out.globalModel = layer.globalModel;
    if (layer.globalBaseUrl !== undefined) out.globalBaseUrl = layer.globalBaseUrl;
    if (layer.agentModels) out.agentModels = { ...out.agentModels, ...layer.agentModels };
    if (layer.agentBaseUrls) out.agentBaseUrls = { ...out.agentBaseUrls, ...layer.agentBaseUrls };
  };

  apply(artifact);
  apply(cliDelta);
  return out;
}

/** `config.defaults` model fields only (baseline before artifact / CLI deltas). */
export function llmOverridesFromSaifctlConfig(config?: SaifctlConfig): LlmOverrides {
  const llm: LlmOverrides = {};
  const d = config?.defaults;
  if (d?.globalModel) llm.globalModel = d.globalModel;
  if (d?.globalBaseUrl) llm.globalBaseUrl = d.globalBaseUrl;
  if (d?.agentModels) llm.agentModels = { ...d.agentModels };
  if (d?.agentBaseUrls) llm.agentBaseUrls = { ...d.agentBaseUrls };
  return llm;
}

/**
 * Parses **only** `--model` / `--base-url` from the current CLI invocation — the “CLI delta” layer.
 *
 * Unlike {@link mergeLlmOverridesLayers} with a config baseline, this does **not** merge `config.defaults` model fields.
 * That matters for **from-artifact** and **test-from-run**: final LLM overrides are built in
 * {@link mergeLlmOverridesLayers} as **config baseline → Run artifact → CLI delta**.
 * If the user omits both flags here, returning `undefined` means the delta layer adds nothing.
 */
export function parseLlmOverridesCliDelta(args: {
  model?: string;
  'base-url'?: string;
}): LlmOverrides | undefined {
  const overrides: LlmOverrides = {};
  const modelRaw = typeof args.model === 'string' ? args.model.trim() : '';
  if (modelRaw) {
    const parsed = parseCommaSeparatedOverrides({
      raw: modelRaw,
      isKeyValue: (p) => p.includes('='),
      /* eslint-disable-next-line max-params */
      validateKeyValue: (key, value, exit) => {
        if (!key || !MODEL_AGENT_NAME_PATTERN.test(key)) {
          exit(
            'malformed part: expected model or agent=model (agent name must not contain comma, whitespace, or equals).',
          );
        }
        if (!isSupportedAgentName(key)) {
          exit(`unknown agent "${key}". Supported: ${SUPPORTED_AGENT_NAMES.join(', ')}.`);
        }
        if (!value) {
          exit('malformed part: expected agent=model (model value must not be empty).');
        }
      },
      errorPrefix: '--model',
    });
    if (parsed.global) overrides.globalModel = parsed.global;
    if (parsed.keys && Object.keys(parsed.keys).length > 0) {
      overrides.agentModels = { ...parsed.keys };
    }
  }

  const baseUrlRaw = typeof args['base-url'] === 'string' ? args['base-url'].trim() : '';
  if (baseUrlRaw) {
    const parsed = parseCommaSeparatedOverrides({
      raw: baseUrlRaw,
      isKeyValue: (p) => KEY_EQ_PATTERN.test(p),
      /* eslint-disable-next-line max-params */
      validateKeyValue: (key, value, exit) => {
        if (!key || !MODEL_AGENT_NAME_PATTERN.test(key)) {
          exit(
            'malformed part: expected base-url or agent=url (agent name must not contain comma, whitespace, or equals).',
          );
        }
        if (!isSupportedAgentName(key)) {
          exit(`unknown agent "${key}". Supported: ${SUPPORTED_AGENT_NAMES.join(', ')}.`);
        }
        if (!value) {
          exit('malformed part: expected agent=url (URL value must not be empty).');
        }
      },
      errorPrefix: '--base-url',
    });
    if (parsed.global) overrides.globalBaseUrl = parsed.global;
    if (parsed.keys && Object.keys(parsed.keys).length > 0) {
      overrides.agentBaseUrls = { ...parsed.keys };
    }
  }

  if (
    overrides.globalModel === undefined &&
    overrides.globalBaseUrl === undefined &&
    !overrides.agentModels &&
    !overrides.agentBaseUrls
  ) {
    return undefined;
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Merge (CLI overlay + model override layers)
// ---------------------------------------------------------------------------

const ORCHESTRATOR_MERGE_KEYS = [
  'sandboxProfileId',
  'agentProfileId',
  'feature',
  'projectDir',
  'maxRuns',
  'saifctlDir',
  'sandboxBaseDir',
  'projectName',
  'testImage',
  'resolveAmbiguity',
  'runTimeoutMs',
  'subtaskTimeoutMs',
  'testRetries',
  'dangerousNoLeash',
  'cedarPolicyPath',
  'coderImage',
  'startupScript',
  'startupScriptFile',
  'gateScript',
  'gateScriptFile',
  'agentInstallScript',
  'agentInstallScriptFile',
  'agentScript',
  'agentScriptFile',
  'stageScript',
  'stageScriptFile',
  'testScript',
  'testScriptFile',
  'testProfile',
  'agentEnv',
  'agentSecretKeys',
  'agentSecretFiles',
  'gateRetries',
  'reviewerEnabled',
  'includeDirty',
  'strict',
  'push',
  'pr',
  'targetBranch',
  'gitProvider',
  'runStorage',
  'stagingEnvironment',
  'codingEnvironment',
  'patchExclude',
  'allowSaifctlInPatch',
  'subtasks',
  'currentSubtaskIndex',
  'fromArtifact',
  'verbose',
  'skipStagingTests',
  'sandboxExtract',
  'sandboxExtractInclude',
  'sandboxExtractExclude',
] as const satisfies readonly (keyof OrchestratorOpts)[];

/**
 * CLI payload: every {@link OrchestratorOpts} key may appear; `undefined` means “do not override” (merge).
 * {@link subtasksFilePath} is handled in {@link resolveOrchestratorOpts} and is not part of merged opts.
 */
export type OrchestratorCliInput = {
  [K in keyof OrchestratorOpts]: OrchestratorOpts[K] | undefined;
} & {
  /** When set, replaces resolved subtasks from this path (relative to project dir or absolute). */
  subtasksFilePath?: string;
};

/**
 * Shallow merge: `overlay` keys that are not `undefined` replace `base`.
 * Does not touch `llm` — resolved separately via {@link mergeLlmOverridesLayers}.
 */
function mergeDefinedOrchestratorOpts(
  base: OrchestratorOpts,
  overlay: OrchestratorCliInput,
): OrchestratorOpts {
  const out = { ...base };
  for (const key of ORCHESTRATOR_MERGE_KEYS) {
    const v = overlay[key];
    if (v !== undefined) {
      (out as Record<string, unknown>)[key as string] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Default baseline from config + profiles (no feat-run CLI; merge applies deltas)
// ---------------------------------------------------------------------------

/** Inputs to {@link applyOrchestratorBaseline} — feature, project paths, config, and resume hints. */
export interface OrchestratorBaselineContext {
  feature: Feature;
  projectDir: string;
  saifctlDir: string;
  config: SaifctlConfig;
  /**
   * Fallback project name used when no explicit `--project`, config default, or `package.json`
   * name is found. When omitted, missing project name throws. Used by `saifctl sandbox` where
   * the project directory may not be a Node package.
   */
  projectNameFallback?: string;
  /**
   * Whether an artifact will overwrite `subtasks` after baseline (`run resume` / fork).
   * When true, baseline skips phase compilation entirely — recompiling the feature dir
   * is wasted work and (more importantly) must not exit-1 on a stale `feature.yml`
   * when the artifact already carries authoritative subtasks.
   */
  artifactWillOverride?: boolean;
  /**
   * Path passed via `--subtasks <file>` (relative to project dir or absolute).
   * When set, baseline loads that file directly instead of compiling phases /
   * reading subtasks.json — matching the documented escape-hatch precedence
   * (Block 3 of TODO_phases_and_critics §3).
   */
  subtasksFilePath?: string;
  /**
   * CLI overrides. Threaded into baseline so values that get baked into per-subtask
   * records (level2/level3 baseline, per-subtask gate/agent/stage scripts via
   * {@link resolveSubtasks}) reflect the CLI choice. The post-baseline
   * `mergeDefinedOrchestratorOpts` only updates top-level fields and cannot reach
   * inside already-compiled `subtasks[]`, so without this any phased-feature run
   * that overrides agent/sandbox/script flags would compile subtasks against the
   * saifctl/profile defaults.
   */
  cli: OrchestratorCliInput;
  /** `--engine` CLI string. Applied to `codingEnvironment`/`stagingEnvironment` here so
   *  level3Baseline (containerEngine / containerComposeFile) reflects the override. */
  engineCli: string | undefined;
}

/**
 * Baseline {@link OrchestratorOpts}: `config.defaults` + package constants + profile defaults,
 * with `cli` overrides applied to every value that flows into per-subtask compilation
 * (level2Baseline, level3Baseline, the gate/agent/stage script bytes baked into each
 * compiled subtask). The post-baseline `mergeDefinedOrchestratorOpts` only updates
 * top-level fields; without applying CLI here, a phased-feature run would compile
 * subtasks against the saifctl/profile defaults regardless of what the user passed.
 */
async function applyOrchestratorBaseline(
  ctx: OrchestratorBaselineContext,
): Promise<OrchestratorOpts> {
  const {
    feature,
    projectDir,
    saifctlDir,
    config,
    projectNameFallback,
    artifactWillOverride,
    subtasksFilePath,
    cli,
    engineCli,
  } = ctx;

  // per-phase-config phase 7.5c: load `feature.yml` so the run-level
  // baseline pickers can honour top-level / `phases.defaults`
  // declarations of the eight Level-2/3 fields. `null` when the
  // feature has no `feature.yml` (single-task synthesised path) — the
  // pickers fall through to saifctl-global / package defaults
  // unchanged.
  //
  // Review N6: the validator (`validatePhasedFeature`) also loads this
  // file in the typical `feat run` flow, but the validation context
  // isn't threaded down here, so we end up doing a second read. The
  // double-read is acceptable (one small YAML parse) but the error UX
  // wasn't: the validator wraps load failures with a `[feature 'X']`
  // prefix, and a raw throw here would surface without that context.
  // Catch + re-emit with the same prefix shape so flows that bypass
  // validation (e.g. `--subtasks`) still get a useful error.
  const featureLabel = `[feature '${feature.name}']`;
  let featureConfig: FeatureConfig | null = null;
  try {
    const featureLoad = await loadFeatureConfig(feature.absolutePath);
    featureConfig = featureLoad?.config ?? null;
  } catch (err) {
    consola.error(`${featureLabel} ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const maxRuns = config?.defaults?.maxRuns ?? DEFAULT_ORCHESTRATOR_MAX_RUNS;
  const llm = mergeLlmOverridesLayers(llmOverridesFromSaifctlConfig(config), undefined, undefined);
  const sandboxBaseDir = resolveSandboxBaseDir(config);
  const projectName = await resolveProjectName({
    projectDir,
    config,
    fallback: projectNameFallback,
  });
  const testProfile = pickTestProfile(cli.testProfile?.id, config);
  const testImage = resolveTestImageTag(cli.testImage, testProfile.id, config);
  const resolveAmbiguity = config?.defaults?.resolveAmbiguity ?? DEFAULT_RESOLVE_AMBIGUITY;
  const { runMs: runTimeoutMs, subtaskMs: subtaskTimeoutMs } = resolveTimeouts({
    configRun: config?.defaults?.timeouts?.run ?? undefined,
    configSubtask: config?.defaults?.timeouts?.subtask ?? undefined,
  });
  const testRetries = config?.defaults?.testRetries ?? DEFAULT_ORCHESTRATOR_TEST_RETRIES;
  // per-phase-config phase 7.5c: featureConfig top-level / phases.defaults
  // is consulted before saifctl-global for the Level-2/3 fields.
  // CLI override (`--no-leash` / `--leash`) wins so the per-subtask
  // level2Baseline below sees the user's choice.
  const dangerousNoLeash = cli.dangerousNoLeash ?? pickDangerousNoLeash(config, featureConfig);
  // per-phase-config phase 7.5c hardening (review H1+H2): pre-resolve the
  // three script-path fields sourced from `feature.yml` /
  // `phases.defaults` BEFORE handing them to the pickers. The relative
  // paths the schema admits (`relativePathSchema`) are documented per
  // design.md §4.3 to resolve via the script-resolver's
  // phase → feature → project chain. The run-level baseline path doesn't
  // have a "phase" (it's by definition above any one phase), so we use
  // {@link resolveFeatureLevelScriptPath} which searches feature → project.
  // Without this pre-resolution, the pickers would emit the raw YAML
  // string (`'./strict.cedar'`) as a project-rooted relative path, and a
  // file at the natural feature-dir location would be either missed or —
  // worse for `container.cedar` — silently substituted by an unrelated
  // file at `<projectDir>/strict.cedar`.
  const featureScriptAbs = await resolveFeatureLevelScriptPaths({
    featureConfig,
    featureAbsolutePath: feature.absolutePath,
    projectDir,
  });
  // per-phase-config phase 7.5c hardening (review N5): pre-resolve the
  // saifctl-global cedar path the same way the feature-yml cedar is
  // pre-resolved (review H1). Pre-7.5c, a relative `defaults.cedarPolicyPath`
  // in `saifctl/config.yml` was passed straight to `readUtf8`, which
  // resolved against process cwd — same silent-fallthrough trap as H1,
  // just one layer up. Absolute paths still pass through to preserve the
  // historical contract.
  const saifctlGlobalCedarResolvedAbs = await resolveSaifctlGlobalCedarPath({
    rawValue: config?.defaults?.cedarPolicyPath,
    projectDir,
  });
  // CLI `--cedar-policy-path` overrides the feature/saifctl-global pick.
  // The path is read here so the resulting `cedarScript` content reaches
  // level2Baseline below. After baseline, `resolveOrchestratorOpts` may
  // re-read this same content if the merged path is unchanged — that's a
  // no-op duplicate read, safe.
  const baselineCedarPolicyPath = pickCedarPolicyPath({
    featureValueResolvedAbs: featureScriptAbs.cedar,
    saifctlGlobalResolvedAbs: saifctlGlobalCedarResolvedAbs,
  });
  const cedarPolicyPath =
    cli.cedarPolicyPath !== undefined
      ? isAbsolute(cli.cedarPolicyPath)
        ? cli.cedarPolicyPath
        : resolve(projectDir, cli.cedarPolicyPath)
      : baselineCedarPolicyPath;
  const cedarScript = await readUtf8(cedarPolicyPath);
  const sandboxProfile = pickSandboxProfile(cli.sandboxProfileId, config, featureConfig);
  const agentProfile = pickAgentProfile(cli.agentProfileId, config, featureConfig);
  const coderImage = cli.coderImage ?? resolveCoderImage(config, sandboxProfile, featureConfig);

  const startupPick = pickStartupScript(undefined, config, featureScriptAbs.startup);
  const gatePick = pickGateScript(undefined, config);
  const stagePick = pickStageScript(undefined, config);
  const testScriptPick = pickTestScript(undefined, config);
  const agentInstallPick = pickAgentInstallScript(undefined, config, featureScriptAbs.install);
  const agentRunScriptPick = pickAgentScript(undefined, config);

  const [startupR, gateR, agentR, stageR, testR] = await Promise.all([
    loadStartupScriptFromPick({
      pick: startupPick,
      sandboxProfileId: sandboxProfile.id,
      projectDir,
    }),
    loadGateScriptFromPick({ pick: gatePick, sandboxProfileId: sandboxProfile.id, projectDir }),
    loadAgentScriptsFromPicks({
      installPick: agentInstallPick,
      scriptPick: agentRunScriptPick,
      agentProfileId: agentProfile.id,
      projectDir,
    }),
    loadStageScriptFromPick({ pick: stagePick, sandboxProfileId: sandboxProfile.id, projectDir }),
    loadTestScriptFromPick({
      pick: testScriptPick,
      testProfileId: testProfile.id,
      projectDir,
    }),
  ]);

  // CLI script content (already loaded by `buildOrchestratorCliInputFromFeatArgs`,
  // either from `--agent <id>` profile bundling or from explicit `--*-script <path>`)
  // wins over the baseline. Used both at top level AND inside `resolveSubtasks` so
  // per-phase compilation bakes the right content into every subtask.
  const startupScript = cli.startupScript ?? startupR.startupScript;
  const startupScriptFile = cli.startupScriptFile ?? startupR.startupScriptFile;
  const gateScript = cli.gateScript ?? gateR.gateScript;
  const gateScriptFile = cli.gateScriptFile ?? gateR.gateScriptFile;
  const agentInstallScript = cli.agentInstallScript ?? agentR.agentInstallScript;
  const agentInstallScriptFile = cli.agentInstallScriptFile ?? agentR.agentInstallScriptFile;
  const agentScript = cli.agentScript ?? agentR.agentScript;
  const agentScriptFile = cli.agentScriptFile ?? agentR.agentScriptFile;
  const stageScript = cli.stageScript ?? stageR.stageScript;
  const stageScriptFile = cli.stageScriptFile ?? stageR.stageScriptFile;
  const testScript = cli.testScript ?? testR.testScript;
  const testScriptFile = cli.testScriptFile ?? testR.testScriptFile;

  const gateRetries = config?.defaults?.gateRetries ?? DEFAULT_ORCHESTRATOR_GATE_RETRIES;
  const reviewerEnabled = config?.defaults?.agent?.reviewer ?? DEFAULT_REVIEWER_ENABLED;
  const includeDirty = config?.defaults?.includeDirty ?? false;
  // Block 7: project-wide test mutability default. CLI delta (`--strict` /
  // `--no-strict`) is merged in later via `mergeDefinedOrchestratorOpts`;
  // here we only resolve baseline → config → built-in default `true`.
  const strict = config?.defaults?.strict ?? true;

  // per-phase-config phase 7.5c: layer feature.yml `container.engine` /
  // `container.compose-file` over `config.environments.coding`. The
  // `environments.coding` shape is a discriminated union on `engine`,
  // and feature-config carries only the two fields above (no
  // `agentEnvironment` / `chart` / `namespacePrefix`), so we preserve
  // those carry-overs from the saifctl-global config when feature.yml
  // doesn't override the engine kind.
  //
  // Hoisted above subtask compilation (was below) so the level3Baseline
  // baked into each compiled subtask reflects `--engine`. Without this,
  // the late `applyEngineCliToOrchestratorOpts` in `resolveOrchestratorOpts`
  // would only update the top-level fields and per-subtask
  // `containerEngine` / `containerComposeFile` would stay stale.
  let codingEnvironment = resolveCodingEnvironment(config, featureConfig);
  let stagingEnvironment = resolveStagingEnvironment(config);
  const engineTrimmed = engineCli?.trim();
  if (engineTrimmed) {
    const tmp = { codingEnvironment, stagingEnvironment } as Pick<
      OrchestratorOpts,
      'codingEnvironment' | 'stagingEnvironment'
    > as OrchestratorOpts;
    applyEngineCliToOrchestratorOpts(tmp, config, engineTrimmed);
    codingEnvironment = tmp.codingEnvironment;
    stagingEnvironment = tmp.stagingEnvironment;
  }

  // Subtasks priority (Block 3 of TODO_phases_and_critics):
  //   1. `--subtasks <file>` (escape hatch) — loaded directly here so the
  //      mutual-exclusion check in `resolveSubtasks` is bypassed.
  //   2. Artifact resume (`run resume` / fork) — baseline returns a placeholder
  //      that `mergeArtifactOntoDefaults` overwrites with the artifact's
  //      authoritative subtasks. Skips phase compilation entirely so a stale
  //      `feature.yml` can't fail-fast a resume that wouldn't have used it.
  //   3. Otherwise — `resolveSubtasks` chooses between phases/, subtasks.json,
  //      or the synthesized plan-only path.
  let subtasks: RunSubtaskInput[];
  const subtasksFileRaw = subtasksFilePath?.trim();
  if (subtasksFileRaw) {
    subtasks = await loadSubtasksFromFile(resolve(projectDir, subtasksFileRaw));
  } else if (artifactWillOverride) {
    subtasks = [];
  } else {
    const codingEnvForLevel3 = codingEnvironment;
    subtasks = await resolveSubtasks({
      subtasksFlag: undefined,
      featureAbsolutePath: feature.absolutePath,
      featureName: feature.name,
      saifctlDir,
      gateScript,
      agentScript,
      stageScript,
      // Per-phase-config phase 7.5 first half (review F-C): the run-level
      // Level-2 baseline flows into the phase compiler so every emitted
      // subtask carries fully resolved Level-2 values (override OR
      // baseline). Same idempotency contract as `agentScript` / `stageScript`
      // above.
      level2Baseline: {
        agentProfileId: agentProfile.id,
        agentInstallScript,
        startupScript,
        cedarScript,
        dangerousNoLeash,
      },
      // Per-phase-config phase 7.5b (level-3-mirror): Level-3 baseline.
      // `containerComposeFile` is undefined when the run uses an engine
      // other than `docker` or when `environments.coding.file` is omitted —
      // a phase that overrides with a value still produces a transition
      // diff against an undefined baseline, which is the right behaviour.
      level3Baseline: {
        containerImage: coderImage,
        containerSandboxProfileId: sandboxProfile.id,
        containerEngine: codingEnvForLevel3.engine,
        containerComposeFile:
          codingEnvForLevel3.engine === 'docker' ? codingEnvForLevel3.file : undefined,
      },
      projectDir,
    });
  }
  const currentSubtaskIndex = 0;

  const agentEnv = await mergeAgentEnvFromReads({
    projectDir,
    config,
    fileRaw: undefined,
    pairSegments: [],
  });
  const agentSecretKeys = await mergeAgentSecretKeysFromReads({
    config,
    extraSecretKeys: [],
  });
  const push = config?.defaults?.push ?? null;
  const pr = resolvePr(config, push);
  const targetBranch = null;
  const gitProvider = resolveGitProvider(config);
  // runStorage isn't part of subtask compilation, so the post-baseline merge
  // in `resolveOrchestratorOpts` (which directly assigns `cli.runStorage`)
  // is sufficient — keep the baseline call signature untouched.
  const runStorage = resolveRunStorage(undefined, projectDir, config);

  return {
    sandboxProfileId: sandboxProfile.id,
    agentProfileId: agentProfile.id,
    feature,
    projectDir,
    maxRuns,
    llm,
    saifctlDir,
    sandboxBaseDir,
    projectName,
    testImage,
    resolveAmbiguity,
    runTimeoutMs,
    subtaskTimeoutMs,
    testRetries,
    dangerousNoLeash,
    cedarPolicyPath,
    cedarScript,
    coderImage,
    startupScript,
    startupScriptFile,
    gateScript,
    gateScriptFile,
    agentInstallScript,
    agentInstallScriptFile,
    agentScript,
    agentScriptFile,
    stageScript,
    stageScriptFile,
    testScript,
    testScriptFile,
    testProfile,
    agentEnv,
    agentSecretKeys,
    agentSecretFiles: [],
    gateRetries,
    reviewerEnabled,
    includeDirty,
    strict,
    push,
    pr,
    targetBranch,
    gitProvider,
    runStorage,
    stagingEnvironment,
    codingEnvironment,
    fromArtifact: null,
    verbose: false,
    testOnly: false,
    allowSaifctlInPatch: false,
    skipStagingTests: false,
    sandboxExtract: 'none',
    subtasks,
    currentSubtaskIndex,
    enableSubtaskSequence: subtasks.length > 1,
  };
}

// ---------------------------------------------------------------------------
// Resolve defaults → artifact → CLI
// ---------------------------------------------------------------------------

/** Inputs to {@link resolveOrchestratorOpts}: project, config, feature, CLI overrides, and an optional artifact to layer on top of defaults. */
export interface ResolveOrchestratorOptsParams {
  projectDir: string;
  saifctlDir: string;
  config: SaifctlConfig;
  /** Resolved feature (prompt/CLI for start; from artifact for from-artifact/test-from-run). */
  feature: Feature;
  cli: OrchestratorCliInput;
  cliModelDelta: LlmOverrides | undefined;
  artifact: RunArtifact | null;
  /**
   * Optional `--engine` string: global `docker` | `helm` | `local`, or `coding=…,staging=…`.
   * Overrides `codingEnvironment` / `stagingEnvironment` after config/artifact/CLI merge;
   * reuses file config for a phase when its engine matches the target.
   */
  engineCli: string | undefined;
  /**
   * Fallback project name when no explicit `--project`, config default, or `package.json`
   * name is found. When omitted, missing project name throws. Used by `saifctl sandbox` where
   * the project directory may not be a Node package.
   */
  projectNameFallback?: string;
}

/**
 * `defaults → artifact (when present) → cli (defined fields only)`; `llm` uses
 * `config → artifact → cliModelDelta`.
 */
export async function resolveOrchestratorOpts(
  params: ResolveOrchestratorOptsParams,
): Promise<OrchestratorOpts> {
  const {
    projectDir,
    saifctlDir,
    config,
    feature,
    cli,
    cliModelDelta,
    artifact,
    engineCli,
    projectNameFallback,
  } = params;

  const defaults = await applyOrchestratorBaseline({
    feature,
    projectDir,
    saifctlDir,
    config,
    projectNameFallback,
    artifactWillOverride: artifact !== null,
    subtasksFilePath: cli.subtasksFilePath,
    cli,
    engineCli,
  });

  let base = defaults;
  if (artifact) {
    base = await mergeArtifactOntoDefaults(defaults, artifact, {
      projectDir,
      feature: params.feature,
    });
  }

  const merged = mergeDefinedOrchestratorOpts(base, cli);

  const artifactLlm = artifact ? deserializeArtifactConfig(artifact.config).llm : undefined;
  merged.llm = mergeLlmOverridesLayers(
    llmOverridesFromSaifctlConfig(config),
    artifactLlm,
    cliModelDelta,
  );

  if (cli.runStorage !== undefined) {
    merged.runStorage = cli.runStorage;
  }

  const engineTrimmed = engineCli?.trim();
  if (engineTrimmed) {
    applyEngineCliToOrchestratorOpts(merged, config, engineTrimmed);
  }

  if (merged.codingEnvironment.engine === 'local') {
    merged.dangerousNoLeash = false;
    merged.reviewerEnabled = false;
  }

  if (merged.pr && !merged.push) {
    consola.error('Error: --pr requires --push <target>.');
    process.exit(1);
  }

  // `--subtasks` was already consumed by `applyOrchestratorBaseline` above
  // (the file is loaded directly there to bypass phase compilation entirely).
  // No re-loading needed here; merged.subtasks already reflects it.

  const keepArtifactCedar = artifact !== null && cli.cedarPolicyPath === undefined;
  if (!keepArtifactCedar) {
    merged.cedarScript = await readUtf8(merged.cedarPolicyPath);
  }

  merged.enableSubtaskSequence = merged.subtasks.length > 1;

  return merged;
}

/* eslint-disable-next-line max-params -- (defaults, artifact, ctx) */
async function mergeArtifactOntoDefaults(
  defaults: OrchestratorOpts,
  artifact: RunArtifact,
  ctx: { projectDir: string; feature: Feature },
): Promise<OrchestratorOpts> {
  const d = deserializeArtifactConfig(artifact.config);
  const merged: OrchestratorOpts = {
    ...defaults,
    ...d,
    feature: ctx.feature,
    projectDir: ctx.projectDir,
    saifctlDir: d.saifctlDir,
    fromArtifact: null,
    testOnly: false,
    runStorage: defaults.runStorage,
    sandboxBaseDir: defaults.sandboxBaseDir,
    sandboxProfileId: d.sandboxProfileId as OrchestratorOpts['sandboxProfileId'],
    agentProfileId: d.agentProfileId as OrchestratorOpts['agentProfileId'],
  };
  delete (merged as { featureName?: string }).featureName;
  delete (merged as { featureRelativePath?: string }).featureRelativePath;

  if (artifact.subtasks?.length) {
    merged.subtasks = runSubtasksToInputs(artifact.subtasks);
  }
  merged.currentSubtaskIndex = artifact.currentSubtaskIndex ?? 0;
  merged.enableSubtaskSequence = merged.subtasks.length > 1;

  return merged;
}

////////////////////////////////////////////////////////////
// FIELD RESOLVERS
////////////////////////////////////////////////////////////

/**
 * Resolve the effective `codingEnvironment` (per-phase-config phase 7.5c)
 * by layering feature.yml `container.engine` / `container.compose-file`
 * over `config.environments.coding`.
 *
 * Behaviour by case:
 * - When feature-config doesn't set `container.engine` and `container.compose-file`,
 *   the saifctl-global `config.environments.coding` is returned untouched
 *   (this preserves `agentEnvironment` / `chart` / `namespacePrefix`).
 * - When feature-config sets only `compose-file` and the effective engine
 *   is `docker`, the file is layered onto the docker shape. `agentEnvironment`
 *   from saifctl-global is carried over.
 * - When feature-config changes the engine kind, the carried-over fields
 *   from the saifctl-global config are kept only if the engine kinds
 *   match. Otherwise we emit a minimal `{ engine }` shape — feature.yml
 *   doesn't carry helm `chart` / `namespacePrefix` etc., so we can't
 *   synthesise them.
 *
 * Discriminated-union: returned value matches the `coding` field of
 * `EnvironmentsConfig`.
 */
export function resolveCodingEnvironment(
  config: SaifctlConfig | undefined,
  featureConfig: FeatureConfig | null | undefined,
): NonNullable<NonNullable<SaifctlConfig['environments']>['coding']> {
  const baseEnv = config?.environments?.coding ?? { engine: 'docker' as const };
  const fcEngine = featureContainerValue(featureConfig, 'engine');
  const fcFile = featureContainerValue(featureConfig, 'compose-file');
  if (fcEngine === undefined && fcFile === undefined) return baseEnv;

  const effectiveEngine = fcEngine ?? baseEnv.engine;
  if (effectiveEngine === 'docker') {
    const carryAgentEnv = baseEnv.engine === 'docker' ? baseEnv.agentEnvironment : undefined;
    const file = fcFile ?? (baseEnv.engine === 'docker' ? baseEnv.file : undefined);
    return {
      engine: 'docker' as const,
      ...(file !== undefined ? { file } : {}),
      ...(carryAgentEnv !== undefined ? { agentEnvironment: carryAgentEnv } : {}),
    };
  }
  if (effectiveEngine === 'helm') {
    return baseEnv.engine === 'helm' ? baseEnv : { engine: 'helm' as const };
  }
  // 'local'
  return baseEnv.engine === 'local' ? baseEnv : { engine: 'local' as const };
}

// eslint-disable-next-line max-params -- (saifctl-global, sandbox-profile, featureConfig) layer chain
export function resolveCoderImage(
  config: SaifctlConfig | undefined,
  sandboxProfile: SandboxProfile,
  featureConfig?: FeatureConfig | null,
): string {
  // CLI is plumbed via `applyCliOverlayToOpts`, not here; precedence below
  // is feature.yml top-level / phases.defaults > saifctl-global config >
  // sandbox-profile-bundled tag.
  const fromFeature = featureContainerValue(featureConfig, 'image');
  if (fromFeature) {
    validateImageTag(fromFeature, 'feature.yml container.image');
    return fromFeature;
  }
  if (config?.defaults?.coderImage) {
    validateImageTag(config.defaults.coderImage, 'config coderImage');
    return config.defaults.coderImage;
  }
  return sandboxProfile.coderImageTag;
}

function resolvePr(config: SaifctlConfig | undefined, push: string | null): boolean {
  const fromConfig = config?.defaults?.pr ?? false;
  const effective = fromConfig;
  if (effective && !push) {
    consola.error('Error: --pr requires --push <target>.');
    process.exit(1);
  }
  return effective;
}

function resolveGitProvider(config?: SaifctlConfig): GitProvider {
  const id = config?.defaults?.gitProvider ?? 'github';
  try {
    return getGitProvider(id);
  } catch (err) {
    consola.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}

/** Returns `config.defaults.sandboxBaseDir` or the package default `/tmp/saifctl/sandboxes`. */
export function resolveSandboxBaseDir(config?: SaifctlConfig): string {
  return config?.defaults?.sandboxBaseDir ?? DEFAULT_SANDBOX_BASE_DIR;
}

/** Test profile id from CLI + config.defaults, falling back to package default. */
export function pickTestProfile(cliId: string | undefined, config?: SaifctlConfig): TestProfile {
  const raw = (cliId ?? '').trim();
  const id = raw || config?.defaults?.testProfile || '';
  if (!id) return DEFAULT_TEST_PROFILE;
  try {
    return resolveTestProfile(id);
  } catch (err) {
    consola.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}

/** Sandbox profile id from CLI + `config.defaults.sandboxProfile`, falling back to the package default. */
// eslint-disable-next-line max-params -- (cli, saifctl-global, featureConfig) layer chain
export function pickSandboxProfile(
  cliId: string | undefined,
  config?: SaifctlConfig,
  featureConfig?: FeatureConfig | null,
): SandboxProfile {
  const raw = (cliId ?? '').trim();
  // CLI > feature.yml top-level / phases.defaults > saifctl-global > package default.
  const id =
    raw ||
    featureContainerValue(featureConfig, 'sandbox-profile') ||
    config?.defaults?.sandboxProfile ||
    '';
  if (!id) return DEFAULT_SANDBOX_PROFILE;
  try {
    return resolveSandboxProfile(id);
  } catch (err) {
    consola.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}

/** Agent profile id from CLI + featureConfig + `config.defaults.agentProfile`, falling back to the package default. */
// eslint-disable-next-line max-params -- (cli, saifctl-global, featureConfig) layer chain
export function pickAgentProfile(
  cliId: string | undefined,
  config?: SaifctlConfig,
  featureConfig?: FeatureConfig | null,
): AgentProfile {
  const raw = (cliId ?? '').trim();
  const id =
    raw || featureAgentValue(featureConfig, 'profile') || config?.defaults?.agentProfile || '';
  if (!id) return DEFAULT_AGENT_PROFILE;
  try {
    return resolveAgentProfile(id);
  } catch (err) {
    consola.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}

/** Resolves the staging test image tag from `--test-image`, `config.defaults.testImage`, or `saifctl-test-<profileId>:latest`. */
export function resolveTestImageTag( // eslint-disable-line max-params
  cliTag: string | undefined,
  profileId: string,
  config?: SaifctlConfig,
): string {
  const trimmed = cliTag?.trim();
  const tag =
    (trimmed ? trimmed : null) ?? config?.defaults?.testImage ?? `saifctl-test-${profileId}:latest`;
  validateImageTag(tag, '--test-image');
  return tag;
}

/** Bundled profile script vs project-relative path (CLI + `config.defaults`). */
export type OrchestratorScriptPick = { mode: 'profile' } | { mode: 'path'; relativePath: string };

// eslint-disable-next-line max-params -- (cli, saifctl-global, featureConfig) layer chain
function coalesceScriptPath(
  cliPath: string | undefined,
  configPath: string | undefined,
  featureValue?: string,
): OrchestratorScriptPick {
  const fromCli = cliPath !== undefined ? cliPath.trim() : '';
  const fromCfg = configPath?.trim() ?? '';
  const fromFeature = featureValue?.trim() ?? '';
  // Precedence (per per-phase-config phase 7.5c): CLI > feature.yml top-level
  // / phases.defaults > saifctl-global config defaults > package default
  // (signalled by `mode: 'profile'`). The featureConfig layer is sourced
  // before the call (see `featureAgent` / `featureContainer` helpers).
  const raw = fromCli || fromFeature || fromCfg;
  if (!raw) return { mode: 'profile' };
  return { mode: 'path', relativePath: raw };
}

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5c — featureConfig top-level / phases.defaults
// readers. Closes the F-A silent-fallthrough trap recorded in design.md
// §7.5: the run-level baseline pickers used to read CLI flags +
// saifctl-global only, so YAML-only top-level / `phases.defaults`
// declarations were silently ignored at the runtime baseline. These
// helpers project the matching feature.yml fields onto the picker
// signature (everything is `undefined` when not declared, so existing
// fallthrough chains pick up the next layer untouched).
//
// Top-level wins over `phases.defaults` per design §4.2 inheritance —
// the more-specific scope wins. Both are below the CLI flag and above
// the saifctl-global `defaults.*` config.
// ---------------------------------------------------------------------------

/**
 * Read an `agent.<key>` value from `featureConfig` with the precedence
 * `featureConfig.agent[key]` > `featureConfig.phases.defaults.agent[key]`.
 * Returns `undefined` when neither layer set the key.
 */
function featureAgentValue<K extends keyof AgentConfig>(
  fc: FeatureConfig | null | undefined,
  key: K,
): AgentConfig[K] | undefined {
  return fc?.agent?.[key] ?? fc?.phases?.defaults?.agent?.[key];
}

/**
 * Resolves the `dangerousNoLeash` flag from CLI / featureConfig / saifctl-
 * global / package default. CLI is plumbed via `applyCliOverlayToOpts`
 * after `applyOrchestratorBaseline`, so this helper covers the baseline
 * layers only.
 *
 * Uses `??` rather than `||` so an explicit `false` in YAML correctly wins
 * over a saifctl-global `true`. That's the safe direction: a feature that
 * tightens leash enforcement should not be silently overridden by a
 * permissive saifctl-global default.
 */
export function pickDangerousNoLeash(
  config: SaifctlConfig | undefined,
  featureConfig: FeatureConfig | null | undefined,
): boolean {
  return (
    featureContainerValue(featureConfig, 'no-leash') ??
    config?.defaults?.dangerousNoLeash ??
    DEFAULT_DANGEROUS_NO_LEASH
  );
}

/**
 * Resolves the Cedar policy file path from feature-resolved abs >
 * saifctl-global > bundled default.
 *
 * `featureValueResolvedAbs` is the **already script-resolver-resolved**
 * absolute path for the `feature.yml` `container.cedar` declaration
 * (see {@link resolveFeatureLevelScriptPaths}). The picker itself does
 * NOT read the YAML raw — that's the H1 silent-fallthrough trap: the
 * raw schema-relative path passed straight to `readUtf8` resolves
 * relative to the process cwd, which may legitimately not exist or —
 * worse — silently hit a coincidentally-named file at the cwd, causing
 * Leash to enforce the wrong policy. We require the caller to do the
 * design.md §4.3 phase/feature/project chain resolution first.
 *
 * `saifctlGlobalResolvedAbs` is the same shape for the saifctl-global
 * `defaults.cedarPolicyPath` value: the caller pre-resolves it via
 * {@link resolveSaifctlGlobalCedarPath} so a relative value in
 * `saifctl/config.yml` is anchored at the project root with the same
 * containment guard the per-feature path uses (review N5 — closes the
 * parallel-H1 trap for the saifctl-global layer). Absolute paths
 * pass through to preserve the historical contract.
 *
 * Falls back to the bundled `defaultCedarPolicyPath()` when neither
 * layer set a value.
 */
/**
 * Resolve the saifctl-global `defaults.cedarPolicyPath` value to an
 * absolute path with a project-containment guard for relative inputs
 * (review N5).
 *
 * Pre-7.5c: a relative value in `saifctl/config.yml` (`defaults.cedarPolicyPath:
 * ./policies/strict.cedar`) was passed straight to `readUtf8`, which
 * resolved against **process cwd** — same silent-fallthrough trap as
 * H1, one layer up. A user could legitimately not understand that the
 * path was cwd-relative; in the worst case a coincidentally-named file
 * at the cwd silently substituted as the Leash policy.
 *
 * Behaviour:
 *   - `undefined` input → `undefined` output (caller falls through to
 *     bundled default).
 *   - Absolute input → returned as-is. Preserves the historical contract
 *     (pre-7.5c users wrote absolute paths there). The cross-project
 *     containment hardening for absolute paths is documented as a
 *     future-phase concern; relative paths are the more common foot-gun.
 *   - Relative input → resolved against `projectDir` and validated via
 *     {@link resolveFeatureLevelScriptPath} (existence + symlink-resolved
 *     project containment). On failure, exits with a clear error so
 *     the user knows their `saifctl/config.yml` value is wrong.
 */
export async function resolveSaifctlGlobalCedarPath(opts: {
  rawValue: string | undefined;
  projectDir: string;
}): Promise<string | undefined> {
  const { rawValue, projectDir } = opts;
  if (rawValue === undefined) return undefined;
  if (isAbsolute(rawValue)) return rawValue;
  try {
    const resolved = await resolveFeatureLevelScriptPath(rawValue, {
      featureAbsolutePath: projectDir,
      projectDir,
      fieldPath: 'defaults.cedarPolicyPath',
      sourceLabel: 'saifctl/config.yml',
    });
    return resolved.absolutePath;
  } catch (err) {
    if (
      err instanceof ScriptNotFoundError ||
      err instanceof ScriptOutsideProjectError ||
      err instanceof ScriptNotARegularFileError
    ) {
      consola.error(`Error: ${err.message}`);
    } else {
      consola.error(
        `Error: failed to resolve saifctl/config.yml \`defaults.cedarPolicyPath\`: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(1);
  }
}

export function pickCedarPolicyPath(opts: {
  featureValueResolvedAbs?: string;
  saifctlGlobalResolvedAbs?: string;
}): string {
  return opts.featureValueResolvedAbs ?? opts.saifctlGlobalResolvedAbs ?? defaultCedarPolicyPath();
}

/**
 * Pre-resolved absolute paths for the three feature.yml-sourced
 * script-path fields covered by per-phase-config phase 7.5c.
 *
 * `undefined` when the corresponding field is not declared anywhere in
 * `feature.yml` top-level / `phases.defaults`. The pickers fall through
 * to saifctl-global / package defaults in that case.
 */
export interface FeatureLevelScriptPathsResolved {
  cedar?: string;
  startup?: string;
  install?: string;
}

/**
 * Resolve the three `feature.yml`-sourced script-path fields against the
 * design.md §4.3 search chain (`feature → project`; "phase" doesn't apply
 * at the run-level baseline) before they reach the picker layer.
 *
 * **Why this exists.** Without it, the run-level baseline pickers would
 * pass the raw schema-relative path (`'./strict.cedar'`) downstream where
 * either:
 *
 *   - `readUtf8` resolves it relative to **process cwd** (cedar — H1 in
 *     review). At best the user gets a confusing ENOENT; at worst, an
 *     unrelated file at `<cwd>/strict.cedar` silently substitutes the
 *     intended Cedar policy.
 *   - `resolve(projectDir, ...)` resolves it relative to **project root**
 *     (startup, install — H2 in review). Inconsistent with the per-phase
 *     compile path, where the script-resolver searches feature first.
 *     A path that works inside a phase's `phase.yml` fails at top-level.
 *
 * Applies the same symlink + project-containment + regular-file guards
 * the per-phase compile path uses (via {@link resolveFeatureLevelScriptPath}).
 *
 * Throws via `consola.error` + `process.exit(1)` on resolver errors —
 * matches how the rest of `applyOrchestratorBaseline` surfaces fatal
 * input problems. The user's `feature.yml` declared a path; the file
 * doesn't resolve; we refuse the run rather than fall through to a
 * bundled default that would mask the mistake.
 */
export async function resolveFeatureLevelScriptPaths(opts: {
  featureConfig: FeatureConfig | null | undefined;
  featureAbsolutePath: string;
  projectDir: string;
}): Promise<FeatureLevelScriptPathsResolved> {
  const { featureConfig, featureAbsolutePath, projectDir } = opts;
  const out: FeatureLevelScriptPathsResolved = {};

  const fields: {
    fieldPath: string;
    relativePath: string | undefined;
    key: keyof FeatureLevelScriptPathsResolved;
  }[] = [
    {
      fieldPath: 'container.cedar',
      relativePath: featureContainerValue(featureConfig, 'cedar'),
      key: 'cedar',
    },
    {
      fieldPath: 'container.startup',
      relativePath: featureContainerValue(featureConfig, 'startup'),
      key: 'startup',
    },
    {
      fieldPath: 'agent.install',
      relativePath: featureAgentValue(featureConfig, 'install'),
      key: 'install',
    },
  ];

  for (const f of fields) {
    if (f.relativePath === undefined) continue;
    try {
      const resolved = await resolveFeatureLevelScriptPath(f.relativePath, {
        featureAbsolutePath,
        projectDir,
        fieldPath: f.fieldPath,
        sourceLabel: 'feature.yml',
      });
      out[f.key] = resolved.absolutePath;
    } catch (err) {
      if (
        err instanceof ScriptNotFoundError ||
        err instanceof ScriptOutsideProjectError ||
        err instanceof ScriptNotARegularFileError
      ) {
        consola.error(`Error: ${err.message}`);
      } else {
        consola.error(
          `Error: failed to resolve feature.yml \`${f.fieldPath}\`: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      process.exit(1);
    }
  }
  return out;
}

/**
 * Read a `container.<key>` value from `featureConfig` with the precedence
 * `featureConfig.container[key]` >
 * `featureConfig.phases.defaults.container[key]`. Returns `undefined`
 * when neither layer set the key.
 */
function featureContainerValue<K extends keyof ContainerConfig>(
  fc: FeatureConfig | null | undefined,
  key: K,
): ContainerConfig[K] | undefined {
  return fc?.container?.[key] ?? fc?.phases?.defaults?.container?.[key];
}

/**
 * Picks the startup script source: CLI > pre-resolved feature value >
 * `config.defaults.startupScript`, or the bundled profile script.
 *
 * `featureValueResolvedAbs` is the **already script-resolver-resolved**
 * absolute path for the `feature.yml` `container.startup` declaration
 * (see {@link resolveFeatureLevelScriptPaths} in `options.ts`). The picker
 * itself is sync and doesn't read the schema-relative path raw — that
 * would skip the design.md §4.3 phase/feature/project chain and leave
 * the file lookup at the wrong root (review H2).
 */
// eslint-disable-next-line max-params -- (cli, saifctl-global, feature-resolved) layer chain
export function pickStartupScript(
  cliPath: string | undefined,
  config: SaifctlConfig | undefined,
  featureValueResolvedAbs?: string,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.startupScript, featureValueResolvedAbs);
}

/** Picks the gate script source: explicit `--gate-script` / `config.defaults.gateScript`, or the bundled profile script. */
export function pickGateScript(
  cliPath: string | undefined,
  config: SaifctlConfig | undefined,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.gateScript);
}

/** Picks the staging script source: explicit `--stage-script` / `config.defaults.stageScript`, or the bundled profile script. */
export function pickStageScript(
  cliPath: string | undefined,
  config: SaifctlConfig | undefined,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.stageScript);
}

/** Picks the test runner script source: explicit `--test-script` / `config.defaults.testScript`, or the bundled profile script. */
export function pickTestScript(
  cliPath: string | undefined,
  config: SaifctlConfig | undefined,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.testScript);
}

/**
 * Picks the agent-install script source: CLI > pre-resolved feature value
 * > saifctl-global `config.defaults.agentInstallScript`, otherwise the
 * bundled agent profile script.
 *
 * Same script-resolver pre-resolution rule as {@link pickStartupScript}: the
 * caller pre-resolves the `feature.yml` `agent.install` value via
 * {@link resolveFeatureLevelScriptPaths} and passes the absolute path here.
 *
 * The saifctl-global config layer (review N4) was previously unwired —
 * `config.defaults.agentInstallScript` is admitted by the schema but no
 * picker read it before phase 7.5c, so users setting it in
 * `saifctl/config.yml` got the bundled profile script instead. The
 * picker now consults the config layer between feature-value and the
 * bundled fallback, matching `pickStartupScript`'s precedence.
 */
// eslint-disable-next-line max-params -- (cli, saifctl-global, feature-resolved) layer chain
export function pickAgentInstallScript(
  cliPath: string | undefined,
  config?: SaifctlConfig,
  featureValueResolvedAbs?: string,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.agentInstallScript, featureValueResolvedAbs);
}

/**
 * Picks the agent run script source: CLI > saifctl-global
 * `config.defaults.agentScript`, otherwise the bundled agent profile
 * script. Review N4: the saifctl-global config layer was previously
 * unwired; now matches the rest of the script pickers.
 */
export function pickAgentScript(
  cliPath: string | undefined,
  config?: SaifctlConfig,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.agentScript);
}

/** Resolves and normalises the staging environment from `config.environments.staging`, defaulting to `{ engine: 'docker' }`. */
export function resolveStagingEnvironment(
  config: SaifctlConfig | undefined,
): NormalizedStagingEnvironment {
  const raw = config?.environments?.staging ?? { engine: 'docker' as const };
  return normalizeStagingEnvironmentRaw(raw);
}

// ---------------------------------------------------------------------------
// Engine resolution
// ---------------------------------------------------------------------------

/** Coding phases allowed in --engine coding=.. */
export type EngineCliCodingKind = 'docker' | 'helm' | 'local';

/** Staging phases allowed in --engine staging=.. */
export type EngineCliStagingKind = 'docker' | 'helm';

/** Parsed `--engine` CLI value: optional coding and staging engine selection. */
export interface EngineCliSpec {
  coding?: EngineCliCodingKind;
  staging?: EngineCliStagingKind;
}

const ENGINE_CLI_CODING_SET = new Set<string>(['docker', 'helm', 'local']);
const ENGINE_CLI_STAGING_SET = new Set<string>(['docker', 'helm']);

/** Applies parsed `--engine` spec to merged opts using file config for reuse vs minimal environment objects. */
export function applyEngineCliToOrchestratorOpts( // eslint-disable-line max-params -- (merged, config, engine string)
  merged: OrchestratorOpts,
  config: SaifctlConfig,
  engineRaw: string,
): void {
  const spec = parseEngineCliSpec(engineRaw);
  if (spec.coding !== undefined) {
    merged.codingEnvironment = pickCodingEnvironmentForEngineCli(spec.coding, config);
  }
  if (spec.staging !== undefined) {
    merged.stagingEnvironment = pickStagingEnvironmentForEngineCli(spec.staging, config);
  }
}

/**
 * Parses `--engine docker` or `--engine coding=docker,staging=helm`.
 * Global `local` sets coding=local and staging=docker (staging cannot be local).
 */
export function parseEngineCliSpec(raw: string, errorPrefix = '--engine'): EngineCliSpec {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const parts = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasKv = parts.some((p) => KEY_EQ_PATTERN.test(p));

  // Single global value (docker, local, helm)
  if (!hasKv) {
    if (parts.length !== 1) {
      consola.error(
        `${errorPrefix} expected a single value (e.g. docker) or comma-separated coding=…,staging=… pairs.`,
      );
      process.exit(1);
    }
    const g = parts[0];
    if (g === 'local') {
      return { coding: 'local', staging: 'docker' };
    }
    if (!ENGINE_CLI_CODING_SET.has(g) || !ENGINE_CLI_STAGING_SET.has(g)) {
      consola.error(
        `${errorPrefix} unknown engine "${g}". Use 'docker', 'helm', or 'local' (use coding=staging form for mixed).`,
      );
      process.exit(1);
    }
    return { coding: g as EngineCliCodingKind, staging: g as EngineCliStagingKind };
  }

  // Key-value pairs (coding=docker,staging=helm)
  const parsed = parseCommaSeparatedOverrides({
    raw: trimmed,
    isKeyValue: (p) => KEY_EQ_PATTERN.test(p),
    /* eslint-disable-next-line max-params -- matches parseCommaSeparatedOverrides callback shape */
    validateKeyValue: (key, value, exit) => {
      const v = value.trim();
      if (!v) exit('empty value; expected e.g. coding=docker.');
      if (key !== 'coding' && key !== 'staging') {
        exit(`unknown phase "${key}". Use coding or staging.`);
      }
      if (key === 'staging' && v === 'local') {
        exit('staging cannot use "local"; use docker or helm.');
      }
      if (key === 'coding' && !ENGINE_CLI_CODING_SET.has(v)) {
        exit(`unknown engine "${v}". Use docker, helm, or local.`);
      }
      if (key === 'staging' && !ENGINE_CLI_STAGING_SET.has(v)) {
        exit(`unknown engine "${v}". Use docker or helm.`);
      }
    },
    errorPrefix,
  });

  const out: EngineCliSpec = {
    coding: parsed.keys?.coding as EngineCliCodingKind,
    staging: parsed.keys?.staging as EngineCliStagingKind,
  };
  return out;
}

/**
 * Picks coding environment from config using file config.
 * If provider came from CLI, use minimal environment object.
 */
function pickCodingEnvironmentForEngineCli(
  target: EngineCliCodingKind,
  config: SaifctlConfig,
): NormalizedCodingEnvironment {
  // If the config has a coding environment that matches the target engine,
  // (e.g. 'docker'), use it.
  const fromFile = config.environments?.coding;
  if (fromFile && fromFile.engine === target) {
    return { ...fromFile };
  }
  // If user has e.g. 'docker' in config, but they want to run 'local',
  // use a minimal object (e.g. { engine: 'local' })
  return { engine: target };
}

/**
 * Picks staging environment from config using file config.
 * If provider came from CLI, use minimal environment object.
 */
function pickStagingEnvironmentForEngineCli(
  target: EngineCliStagingKind,
  config: SaifctlConfig,
): NormalizedStagingEnvironment {
  const fromFile = config.environments?.staging;
  if (fromFile && fromFile.engine === target) {
    return normalizeStagingEnvironmentRaw(fromFile);
  }
  if (target === 'docker') {
    return normalizeStagingEnvironmentRaw({ engine: 'docker' });
  }
  consola.error(
    'Error: --engine staging=helm requires environments.staging with engine "helm" and chart in saifctl config.',
  );
  process.exit(1);
}

type StagingConfigRaw =
  | NonNullable<NonNullable<SaifctlConfig['environments']>['staging']>
  | {
      engine: 'docker';
    };

/** Normalize staging env (defaults for `app` / `appEnvironment`) from a raw config object. */
export function normalizeStagingEnvironmentRaw(
  raw: StagingConfigRaw,
): NormalizedStagingEnvironment {
  const app: StagingAppConfig = {
    ...DEFAULT_STAGING_APP,
    ...('app' in raw && raw.app ? raw.app : {}),
  };
  const appEnvironment =
    ('appEnvironment' in raw && raw.appEnvironment ? raw.appEnvironment : undefined) ?? {};
  return { ...raw, app, appEnvironment };
}
