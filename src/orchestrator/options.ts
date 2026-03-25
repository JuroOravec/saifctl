/**
 * Orchestrator option merge and resolution: CLI/artifact layers, model overrides, and full {@link OrchestratorOpts} resolution.
 */

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
  type NormalizedStagingEnvironment,
  type SaifacConfig,
  type StagingAppConfig,
} from '../config/schema.js';
import {
  DEFAULT_DANGEROUS_DEBUG,
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
import { isSupportedAgentName, type ModelOverrides, SUPPORTED_AGENT_NAMES } from '../llm-config.js';
import { consola } from '../logger.js';
import type { RunArtifact } from '../runs/types.js';
import { deserializeArtifactConfig } from '../runs/utils/serialize.js';
import { DEFAULT_SANDBOX_PROFILE, resolveSandboxProfile } from '../sandbox-profiles/index.js';
import type { SandboxProfile } from '../sandbox-profiles/types.js';
import type { Feature } from '../specs/discover.js';
import { DEFAULT_TEST_PROFILE, resolveTestProfile } from '../test-profiles/index.js';
import type { TestProfile } from '../test-profiles/types.js';
import { validateImageTag } from '../utils/docker.js';
import type { OrchestratorOpts } from './modes.js';
import { DEFAULT_SANDBOX_BASE_DIR } from './sandbox.js';

// ---------------------------------------------------------------------------
// Model overrides: config baseline → artifact → CLI delta
// ---------------------------------------------------------------------------

/** Agent name (key before =) must not contain comma, whitespace, or equals. */
const MODEL_AGENT_NAME_PATTERN = /^[^,\s=]+$/;

/** Order: config baseline → artifact → CLI delta (later wins per field / map merge). */
/* eslint-disable-next-line max-params -- three explicit layers */
export function mergeModelOverridesLayers(
  configBaseline: ModelOverrides,
  artifact?: ModelOverrides,
  cliDelta?: ModelOverrides,
): ModelOverrides {
  const out: ModelOverrides = { ...configBaseline };

  const apply = (layer?: ModelOverrides) => {
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
export function modelOverridesFromSaifacConfig(config?: SaifacConfig): ModelOverrides {
  const overrides: ModelOverrides = {};
  const d = config?.defaults;
  if (d?.globalModel) overrides.globalModel = d.globalModel;
  if (d?.globalBaseUrl) overrides.globalBaseUrl = d.globalBaseUrl;
  if (d?.agentModels) overrides.agentModels = { ...d.agentModels };
  if (d?.agentBaseUrls) overrides.agentBaseUrls = { ...d.agentBaseUrls };
  return overrides;
}

/**
 * Parses **only** `--model` / `--base-url` from the current CLI invocation — the “CLI delta” layer.
 *
 * Unlike {@link mergeModelOverridesLayers} with a config baseline, this does **not** merge `config.defaults` model fields.
 * That matters for **resume** and **test-from-run**: final LLM overrides are built in
 * {@link mergeModelOverridesLayers} as **config baseline → stored run artifact → CLI delta**.
 * If the user omits both flags here, returning `undefined` means the delta layer adds nothing.
 */
export function parseModelOverridesCliDelta(args: {
  model?: string;
  'base-url'?: string;
}): ModelOverrides | undefined {
  const overrides: ModelOverrides = {};
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
  'saifDir',
  'sandboxBaseDir',
  'projectName',
  'testImage',
  'resolveAmbiguity',
  'testRetries',
  'dangerousDebug',
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
  'agentLogFormat',
  'gateRetries',
  'reviewerEnabled',
  'push',
  'pr',
  'gitProvider',
  'runStorage',
  'stagingEnvironment',
  'codingEnvironment',
  'patchExclude',
  'resume',
  'verbose',
] as const satisfies readonly (keyof OrchestratorOpts)[];

/** CLI payload: every key may appear; `undefined` means “do not override” (resume / merge). */
export type OrchestratorCliInput = {
  [K in keyof OrchestratorOpts]: OrchestratorOpts[K] | undefined;
};

/**
 * Shallow merge: `overlay` keys that are not `undefined` replace `base`.
 * Does not touch `overrides` — resolved separately via {@link mergeModelOverridesLayers}.
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

export interface OrchestratorBaselineContext {
  feature: Feature;
  projectDir: string;
  saifDir: string;
  config: SaifacConfig;
}

/**
 * Baseline {@link OrchestratorOpts}: `config.defaults` + package constants + profile defaults.
 * No feat-run CLI flags — those are merged later via {@link mergeDefinedOrchestratorOpts}.
 */
async function applyOrchestratorBaseline(
  ctx: OrchestratorBaselineContext,
): Promise<OrchestratorOpts> {
  const { feature, projectDir, saifDir, config } = ctx;
  const noCli = undefined;

  const maxRuns = config?.defaults?.maxRuns ?? DEFAULT_ORCHESTRATOR_MAX_RUNS;
  const overrides = mergeModelOverridesLayers(
    modelOverridesFromSaifacConfig(config),
    undefined,
    undefined,
  );
  const sandboxBaseDir = resolveSandboxBaseDir(config);
  const projectName = await resolveProjectName({ projectDir, config });
  const testProfile = pickTestProfile(noCli, config);
  const testImage = resolveTestImageTag(noCli, testProfile.id, config);
  const resolveAmbiguity = config?.defaults?.resolveAmbiguity ?? DEFAULT_RESOLVE_AMBIGUITY;
  const testRetries = config?.defaults?.testRetries ?? DEFAULT_ORCHESTRATOR_TEST_RETRIES;
  const dangerousDebug = config?.defaults?.dangerousDebug ?? DEFAULT_DANGEROUS_DEBUG;
  const dangerousNoLeash = config?.defaults?.dangerousNoLeash ?? DEFAULT_DANGEROUS_NO_LEASH;
  const cedarPolicyPath = config?.defaults?.cedarPolicyPath ?? defaultCedarPolicyPath();
  const sandboxProfile = pickSandboxProfile(noCli, config);
  const agentProfile = pickAgentProfile(noCli, config);
  const coderImage = resolveCoderImage(config, sandboxProfile);

  const startupPick = pickStartupScript(noCli, config);
  const gatePick = pickGateScript(noCli, config);
  const stagePick = pickStageScript(noCli, config);
  const testScriptPick = pickTestScript(noCli, config);
  const agentInstallPick = pickAgentInstallScript(noCli);
  const agentRunScriptPick = pickAgentScript(noCli);

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

  const gateRetries = config?.defaults?.gateRetries ?? DEFAULT_ORCHESTRATOR_GATE_RETRIES;
  const reviewerEnabled = config?.defaults?.reviewerEnabled ?? DEFAULT_REVIEWER_ENABLED;
  const agentEnv = await mergeAgentEnvFromReads({
    projectDir,
    config,
    fileRaw: undefined,
    pairSegments: [],
  });
  const agentLogFormat = resolveAgentLogFormat(noCli, agentProfile, config);
  const push = config?.defaults?.push ?? null;
  const pr = resolvePr(config, push);
  const gitProvider = resolveGitProvider(config);
  const runStorage = resolveRunStorage(noCli, projectDir, config);
  const stagingEnvironment = resolveStagingEnvironment(config);
  const codingEnvironment = config?.environments?.coding ?? { provisioner: 'docker' as const };

  return {
    sandboxProfileId: sandboxProfile.id,
    agentProfileId: agentProfile.id,
    feature,
    projectDir,
    maxRuns,
    overrides,
    saifDir,
    sandboxBaseDir,
    projectName,
    testImage,
    resolveAmbiguity,
    testRetries,
    dangerousDebug,
    dangerousNoLeash,
    cedarPolicyPath,
    coderImage,
    startupScript: startupR.startupScript,
    startupScriptFile: startupR.startupScriptFile,
    gateScript: gateR.gateScript,
    gateScriptFile: gateR.gateScriptFile,
    agentInstallScript: agentR.agentInstallScript,
    agentInstallScriptFile: agentR.agentInstallScriptFile,
    agentScript: agentR.agentScript,
    agentScriptFile: agentR.agentScriptFile,
    stageScript: stageR.stageScript,
    stageScriptFile: stageR.stageScriptFile,
    testScript: testR.testScript,
    testScriptFile: testR.testScriptFile,
    testProfile,
    agentEnv,
    agentLogFormat,
    gateRetries,
    reviewerEnabled,
    push,
    pr,
    gitProvider,
    runStorage,
    stagingEnvironment,
    codingEnvironment,
    resume: null,
    verbose: false,
    testOnly: false,
  };
}

// ---------------------------------------------------------------------------
// Resolve defaults → artifact → CLI
// ---------------------------------------------------------------------------

export interface ResolveOrchestratorOptsParams {
  projectDir: string;
  saifDir: string;
  config: SaifacConfig;
  /** Resolved feature (prompt/CLI for start; from artifact for resume/test-from-run). */
  feature: Feature;
  cli: OrchestratorCliInput;
  cliModelDelta: ModelOverrides | undefined;
  artifact: RunArtifact | null;
}

/**
 * `defaults → artifact (when present) → cli (defined fields only)`; `overrides` use
 * `config → artifact → cliModelDelta`.
 */
export async function resolveOrchestratorOpts(
  params: ResolveOrchestratorOptsParams,
): Promise<OrchestratorOpts> {
  const { projectDir, saifDir, config, feature, cli, cliModelDelta, artifact } = params;

  const defaults = await applyOrchestratorBaseline({
    feature,
    projectDir,
    saifDir,
    config,
  });

  let base = defaults;
  if (artifact) {
    base = await mergeArtifactOntoDefaults(defaults, artifact, {
      projectDir,
      feature: params.feature,
    });
  }

  const merged = mergeDefinedOrchestratorOpts(base, cli);

  const artifactOverrides = artifact
    ? deserializeArtifactConfig(artifact.config).overrides
    : undefined;
  merged.overrides = mergeModelOverridesLayers(
    modelOverridesFromSaifacConfig(config),
    artifactOverrides,
    cliModelDelta,
  );

  if (cli.runStorage !== undefined) {
    merged.runStorage = cli.runStorage;
  }

  if (merged.pr && !merged.push) {
    consola.error('Error: --pr requires --push <target>.');
    process.exit(1);
  }

  if (merged.dangerousDebug && merged.dangerousNoLeash) {
    consola.error('Error: --dangerous-debug and --dangerous-no-leash cannot be used together.');
    process.exit(1);
  }

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
    saifDir: d.saifDir,
    resume: null,
    testOnly: false,
    runStorage: defaults.runStorage,
    sandboxBaseDir: defaults.sandboxBaseDir,
    sandboxProfileId: d.sandboxProfileId as OrchestratorOpts['sandboxProfileId'],
    agentProfileId: d.agentProfileId as OrchestratorOpts['agentProfileId'],
  };
  delete (merged as { featureName?: string }).featureName;
  return merged;
}

////////////////////////////////////////////////////////////
// FIELD RESOLVERS
////////////////////////////////////////////////////////////

function resolveCoderImage(
  config: SaifacConfig | undefined,
  sandboxProfile: SandboxProfile,
): string {
  if (config?.defaults?.coderImage) {
    validateImageTag(config.defaults.coderImage, 'config coderImage');
    return config.defaults.coderImage;
  }
  return sandboxProfile.coderImageTag;
}

function resolvePr(config: SaifacConfig | undefined, push: string | null): boolean {
  const fromConfig = config?.defaults?.pr ?? false;
  const effective = fromConfig;
  if (effective && !push) {
    consola.error('Error: --pr requires --push <target>.');
    process.exit(1);
  }
  return effective;
}

function resolveGitProvider(config?: SaifacConfig): GitProvider {
  const id = config?.defaults?.gitProvider ?? 'github';
  try {
    return getGitProvider(id);
  } catch (err) {
    consola.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}

export function resolveSandboxBaseDir(config?: SaifacConfig): string {
  return config?.defaults?.sandboxBaseDir ?? DEFAULT_SANDBOX_BASE_DIR;
}

/** Test profile id from CLI + config.defaults, falling back to package default. */
export function pickTestProfile(cliId: string | undefined, config?: SaifacConfig): TestProfile {
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

export function pickSandboxProfile(
  cliId: string | undefined,
  config?: SaifacConfig,
): SandboxProfile {
  const raw = (cliId ?? '').trim();
  const id = raw || config?.defaults?.sandboxProfile || '';
  if (!id) return DEFAULT_SANDBOX_PROFILE;
  try {
    return resolveSandboxProfile(id);
  } catch (err) {
    consola.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}

export function pickAgentProfile(cliId: string | undefined, config?: SaifacConfig): AgentProfile {
  const raw = (cliId ?? '').trim();
  const id = raw || config?.defaults?.agentProfile || '';
  if (!id) return DEFAULT_AGENT_PROFILE;
  try {
    return resolveAgentProfile(id);
  } catch (err) {
    consola.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}

/* eslint-disable-next-line max-params */
export function resolveTestImageTag(
  cliTag: string | undefined,
  profileId: string,
  config?: SaifacConfig,
): string {
  const trimmed = cliTag?.trim();
  const tag =
    (trimmed ? trimmed : null) ?? config?.defaults?.testImage ?? `saifac-test-${profileId}:latest`;
  validateImageTag(tag, '--test-image');
  return tag;
}

/* eslint-disable-next-line max-params */
export function resolveAgentLogFormat(
  cliRaw: string | undefined,
  agentProfile: AgentProfile,
  config?: SaifacConfig,
): 'openhands' | 'raw' {
  const raw = cliRaw?.trim();
  if (raw === 'raw') return 'raw';
  if (raw === 'openhands') return 'openhands';
  if (raw) {
    consola.warn(
      `[cli] Unknown --agent-log-format "${raw}"; falling back to profile default (${agentProfile.defaultLogFormat}).`,
    );
  }
  return config?.defaults?.agentLogFormat ?? agentProfile.defaultLogFormat;
}

/** Bundled profile script vs project-relative path (CLI + `config.defaults`). */
export type OrchestratorScriptPick = { mode: 'profile' } | { mode: 'path'; relativePath: string };

function coalesceScriptPath(
  cliPath: string | undefined,
  configPath: string | undefined,
): OrchestratorScriptPick {
  const fromCli = cliPath !== undefined ? cliPath.trim() : '';
  const fromCfg = configPath?.trim() ?? '';
  const raw = fromCli || fromCfg;
  if (!raw) return { mode: 'profile' };
  return { mode: 'path', relativePath: raw };
}

export function pickStartupScript(
  cliPath: string | undefined,
  config: SaifacConfig | undefined,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.startupScript);
}

export function pickGateScript(
  cliPath: string | undefined,
  config: SaifacConfig | undefined,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.gateScript);
}

export function pickStageScript(
  cliPath: string | undefined,
  config: SaifacConfig | undefined,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.stageScript);
}

export function pickTestScript(
  cliPath: string | undefined,
  config: SaifacConfig | undefined,
): OrchestratorScriptPick {
  return coalesceScriptPath(cliPath, config?.defaults?.testScript);
}

export function pickAgentInstallScript(cliPath: string | undefined): OrchestratorScriptPick {
  const raw = cliPath !== undefined ? cliPath.trim() : '';
  if (!raw) return { mode: 'profile' };
  return { mode: 'path', relativePath: raw };
}

export function pickAgentScript(cliPath: string | undefined): OrchestratorScriptPick {
  const raw = cliPath !== undefined ? cliPath.trim() : '';
  if (!raw) return { mode: 'profile' };
  return { mode: 'path', relativePath: raw };
}

export function resolveStagingEnvironment(
  config: SaifacConfig | undefined,
): NormalizedStagingEnvironment {
  const raw = config?.environments?.staging ?? { provisioner: 'docker' as const };
  const app: StagingAppConfig = {
    ...DEFAULT_STAGING_APP,
    ...('app' in raw ? raw.app : undefined),
  };
  const appEnvironment: Record<string, string> =
    ('appEnvironment' in raw ? raw.appEnvironment : undefined) ?? {};
  return { ...raw, app, appEnvironment };
}
