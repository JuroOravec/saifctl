/**
 * File loading + inheritance resolution for `feature.yml` and `phase.yml`.
 *
 * - File-extension precedence: when multiple of `.yml` / `.yaml` / `.json` are
 *   present in the same dir, error (refuse to silently pick one). See §5.5.
 * - Inheritance resolution per §5.3 (most-specific wins; no key-level merge for
 *   list-valued keys like `critics`).
 *
 * Cross-file validation (referenced critic id exists, referenced phase id
 * matches a discovered phase dir) lives in discover.ts — load.ts is purely
 * file → typed config → resolved-per-phase config.
 */

import { join } from 'node:path';

import { cosmiconfig } from 'cosmiconfig';
import { type ZodError } from 'zod';

import { pathExists } from '../../utils/io.js';
import {
  type AgentConfig,
  type ContainerConfig,
  type CriticEntry,
  type FeatureConfig,
  featureConfigSchema,
  type GateConfig,
  type LimitsConfig,
  type PhaseConfig,
  phaseConfigSchema,
  type TestConfig,
  type TestsConfig,
} from './schema.js';

const CONFIG_EXTENSIONS = ['yml', 'yaml', 'json'] as const;

/**
 * cosmiconfig loader for parsing yml / yaml / json. We bypass `search()` and
 * use `load()` directly on a path we picked ourselves so we can detect
 * duplicate variants (which `search()` would silently resolve in favor of one).
 */
const FEATURE_LOADER = cosmiconfig('saifctl-feature', { searchPlaces: [] });
const PHASE_LOADER = cosmiconfig('saifctl-phase', { searchPlaces: [] });

/**
 * Locate a config file matching `<basename>.{yml,yaml,json}` in `dir`.
 *
 * Returns the path to the single existing file, or `null` when none exists.
 * Errors when multiple variants exist (the user must pick one).
 */
async function findSingleConfigVariant(dir: string, basename: string): Promise<string | null> {
  const candidates = CONFIG_EXTENSIONS.map((ext) => join(dir, `${basename}.${ext}`));
  const present = await Promise.all(
    candidates.map(async (p) => ((await pathExists(p)) ? p : null)),
  );
  const found = present.filter((p): p is string => p !== null);
  if (found.length === 0) return null;
  if (found.length > 1) {
    throw new MultipleConfigVariantsError({ basename, dir, variants: found });
  }
  return found[0]!;
}

/** Thrown when multiple file-extension variants exist for the same config. */
export class MultipleConfigVariantsError extends Error {
  readonly variants: readonly string[];
  constructor(opts: { basename: string; dir: string; variants: readonly string[] }) {
    super(
      `Multiple ${opts.basename}.{yml,yaml,json} variants in ${opts.dir}; pick one:\n  ${opts.variants.join('\n  ')}`,
    );
    this.name = 'MultipleConfigVariantsError';
    this.variants = opts.variants;
  }
}

/** Thrown when a config file fails Zod schema validation. */
export class PhaseConfigParseError extends Error {
  readonly filepath: string;
  readonly zodError: ZodError;
  constructor(filepath: string, zodError: ZodError) {
    super(`Invalid config at ${filepath}:\n${formatZodError(zodError)}`);
    this.name = 'PhaseConfigParseError';
    this.filepath = filepath;
    this.zodError = zodError;
  }
}

function formatZodError(err: ZodError): string {
  return err.issues
    .map((i) => `  - ${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`)
    .join('\n');
}

/**
 * Load and validate `feature.yml` (or `.yaml` / `.json`) from `featureDir`.
 *
 * Returns `null` when no file is present (the absence of feature.yml is fine —
 * everything is optional). Throws on multiple variants or invalid schema.
 */
export async function loadFeatureConfig(
  featureDir: string,
): Promise<{ config: FeatureConfig; filepath: string } | null> {
  const filepath = await findSingleConfigVariant(featureDir, 'feature');
  if (!filepath) return null;
  const result = await FEATURE_LOADER.load(filepath);
  if (!result?.config) return null;
  const parsed = featureConfigSchema.safeParse(result.config);
  if (!parsed.success) {
    throw new PhaseConfigParseError(filepath, parsed.error);
  }
  return { config: parsed.data, filepath };
}

/**
 * Load and validate `phase.yml` (or `.yaml` / `.json`) from `phaseDir`.
 *
 * Returns `null` when no file is present. Throws on multiple variants or
 * invalid schema.
 */
export async function loadPhaseConfig(
  phaseDir: string,
): Promise<{ config: PhaseConfig; filepath: string } | null> {
  const filepath = await findSingleConfigVariant(phaseDir, 'phase');
  if (!filepath) return null;
  const result = await PHASE_LOADER.load(filepath);
  if (!result?.config) return null;
  const parsed = phaseConfigSchema.safeParse(result.config);
  if (!parsed.success) {
    throw new PhaseConfigParseError(filepath, parsed.error);
  }
  return { config: parsed.data, filepath };
}

// ---------------------------------------------------------------------------
// Inheritance resolution
// ---------------------------------------------------------------------------

/**
 * Built-in defaults applied at the bottom of the inheritance chain.
 * Centralized here so changes are visible in one place.
 *
 * `tests.mutable`'s default is NOT here — it's derived per-resolver-call from
 * `projectDefaultStrict` (CLI `--strict`/`--no-strict` → `defaults.strict` →
 * built-in `true`) so a `--no-strict` invocation actually flips the floor.
 * See {@link resolvePhaseConfig}.
 */
export const BUILT_IN_DEFAULTS = {
  testsFail2pass: true,
  testsEnforce: 'diff-inspection' as const,
  testsImmutableFiles: [] as string[],
  defaultCriticRounds: 1,
} as const;

/**
 * Effective per-phase config after inheritance resolution.
 *
 * Distinct shape from `PhaseConfig` so callers can rely on every field being
 * populated (no optionals) and on the "undefined critics" sentinel being
 * resolved to a concrete decision (run-all vs run-specified vs run-none).
 *
 * The five v1 groups (`gate`, `agent`, `container`, `test`, `limits`) are
 * surfaced here as `Resolved*` shapes whose fields are still optional —
 * unset means "no per-phase override; fall back to run-level value at the
 * threading site." Each Level's runtime threading (per per-phase-config
 * design §7.2–7.6) reads from these fields when consuming a subtask.
 */
export interface ResolvedPhaseConfig {
  /** Phase id (matches dir name under phases/). */
  phaseId: string;
  /** Path to spec file relative to the phase dir. */
  spec: string;
  /**
   * Resolved critic list. `null` means "run all critics discovered in
   * critics/" — the resolver propagates `undefined` from the inheritance
   * chain to this sentinel; discover.ts expands it to the actual critic list.
   * `[]` means "run no critics."
   */
  critics: CriticEntry[] | null;
  tests: ResolvedTestsConfig;
  /** Per-phase gate (Level 1) — `script` content threaded by 7.2; `retries` already runtime-supported. */
  gate: ResolvedGateConfig;
  /** Per-phase agent identity & behaviour (mixed Level 1.5 / Level 2). */
  agent: ResolvedAgentConfig;
  /** Per-phase coder container shape (Level 2 / Level 3). */
  container: ResolvedContainerConfig;
  /** Per-phase test runner overrides (Level 4). */
  test: ResolvedTestConfig;
  /** Per-phase budgets (loop state). */
  limits: ResolvedLimitsConfig;
}

/** Effective tests config for one scope after inheritance + the mutable/fail2pass cross-rule (§5.6). */
export interface ResolvedTestsConfig {
  mutable: boolean;
  /**
   * Effective fail2pass after the "mutable=true ⇒ fail2pass=false unless
   * explicitly set" rule (per §9 / §5.6).
   */
  fail2pass: boolean;
  enforce: 'diff-inspection' | 'read-only';
  immutableFiles: string[];
  /**
   * Per-phase-config v1 (§6.5 option b): when `true`, this phase has no own
   * tests. The test runner is bypassed for the phase's subtasks;
   * feature/project tests still gate at the run's last phase. Threading
   * lands in 7.3.
   */
  none: boolean;
}

/**
 * Resolved gate config — sub-key by sub-key inheritance per design §4.2.
 * Both fields stay optional: unset means "use run-level value" (matches
 * the existing `RunSubtaskInput.gateScript ?? runGateScriptContent`
 * pattern at [`loop.ts:1783`](../../orchestrator/loop.ts#L1783)).
 */
export interface ResolvedGateConfig {
  script?: string;
  retries?: number;
}

/**
 * Resolved agent config — see {@link AgentConfig} for the YAML shape and
 * each field's lifecycle level / target threading phase.
 *
 * `env` merges by key across the inheritance chain (most-specific entry
 * wins per key). `secrets` REPLACES at the most-specific layer
 * (list-valued; no key-level merge per design §4.2).
 */
export interface ResolvedAgentConfig {
  profile?: string;
  script?: string;
  install?: string;
  env?: Record<string, string>;
  secrets?: string[];
  model?: string;
  baseUrl?: string;
  reviewer?: boolean;
}

/**
 * Resolved container config — see {@link ContainerConfig}. Every field
 * Level-2 or Level-3; threading lands in 7.5.
 */
export interface ResolvedContainerConfig {
  startup?: string;
  cedar?: string;
  noLeash?: boolean;
  sandboxProfile?: string;
  image?: string;
  engine?: 'docker' | 'helm' | 'local';
  composeFile?: string;
}

/**
 * Resolved test config — see {@link TestConfig}. All Level-4; threading
 * lands in 7.3 (test runner is recreated per outer attempt, so per-phase
 * is just routing).
 *
 * Sub-field names drop the redundant `test-` prefix the v0 schema carried
 * under `runner:` (now `test.profile` / `.image` / `.script` / `.retries`);
 * `stageScript` and `resolveAmbiguity` are unchanged.
 */
export interface ResolvedTestConfig {
  profile?: string;
  image?: string;
  script?: string;
  stageScript?: string;
  resolveAmbiguity?: 'off' | 'prompt' | 'ai';
  retries?: number;
}

/**
 * Resolved limits config. `max-attempts` runtime support shipped in
 * phase 7.6 (per-phase outer-attempt cap):
 *   - Compile threads `limits.maxAttempts` onto every subtask of a phase
 *     (`compile.ts:478`).
 *   - Loop bumps the per-phase counter and fail-fasts via
 *     `phase-budget.ts` (`loop.ts:1735` + the three retry-or-fail
 *     branches in `onSubtaskComplete`).
 *   - Resume preserves the counter via `RunArtifact#phaseAttemptCount`.
 */
export interface ResolvedLimitsConfig {
  maxAttempts?: number;
}

/**
 * Resolve the effective config for one phase per §5.3 (extended by §9 to
 * include the inline-phase layer):
 *   1. phase.yml
 *   2. feature.yml.phases.phases.<id>  (inline override)
 *   3. feature.yml.phases.defaults
 *   4. feature.yml top-level (only for keys defined at both scopes; today
 *      that's `critics:` and `tests:`)
 *   5. project default (for `tests.mutable` only — driven by
 *      `projectDefaultStrict`, i.e. `--strict`/`--no-strict`)
 *   6. built-in defaults
 *
 * No key-level merge for list-valued keys: a `critics:` (or `immutable-files:`)
 * declaration at any level REPLACES all lower levels. Object-valued `tests:`
 * resolves sub-key by sub-key (per §5.6 "first explicit declaration wins").
 *
 * `projectDefaultStrict` defaults to `true` (strict ⇒ default-immutable) when
 * the caller doesn't care about strict mode (e.g. compile.ts and validate.ts,
 * which only consume `critics`/`spec` from the resolved config). The classifier
 * MUST pass it through so `--no-strict` actually flips the phase-tests floor.
 */
export function resolvePhaseConfig(opts: {
  phaseId: string;
  phaseConfig: PhaseConfig | null;
  featureConfig: FeatureConfig | null;
  projectDefaultStrict?: boolean;
}): ResolvedPhaseConfig {
  const { phaseId, phaseConfig, featureConfig } = opts;
  const projectDefaultStrict = opts.projectDefaultStrict ?? true;

  const inlinePhase = featureConfig?.phases?.phases?.[phaseId] ?? null;
  const phaseDefaults = featureConfig?.phases?.defaults ?? null;

  // critics: most-specific defined wins; undefined propagates as "run all" sentinel.
  const critics = firstDefined<CriticEntry[]>(
    phaseConfig?.critics,
    inlinePhase?.critics,
    phaseDefaults?.critics,
    featureConfig?.critics,
  );

  // tests: resolve each sub-key independently (object keys CAN merge across layers).
  const tests = resolveTests({
    layers: [phaseConfig?.tests, inlinePhase?.tests, phaseDefaults?.tests, featureConfig?.tests],
    projectDefaultStrict,
  });

  // spec: phase.yml > inline > phases.defaults > built-in 'spec.md'.
  // (defaults.spec lets a project override the spec filename uniformly,
  // e.g. `defaults: { spec: SPEC.md }` for projects with uppercase naming.)
  const spec =
    firstDefined<string>(phaseConfig?.spec, inlinePhase?.spec, phaseDefaults?.spec) ?? 'spec.md';

  // v1 groups — same inheritance chain as `tests`. Each group resolves
  // sub-key by sub-key (most-specific defined wins per sub-key). The
  // feature top-level admits the same groups per per-phase-config design
  // §6.8, so they sit at the bottom of the chain alongside the existing
  // `tests` rule.
  const groupLayers = {
    gate: [phaseConfig?.gate, inlinePhase?.gate, phaseDefaults?.gate, featureConfig?.gate] as const,
    agent: [
      phaseConfig?.agent,
      inlinePhase?.agent,
      phaseDefaults?.agent,
      featureConfig?.agent,
    ] as const,
    container: [
      phaseConfig?.container,
      inlinePhase?.container,
      phaseDefaults?.container,
      featureConfig?.container,
    ] as const,
    test: [phaseConfig?.test, inlinePhase?.test, phaseDefaults?.test, featureConfig?.test] as const,
    limits: [
      phaseConfig?.limits,
      inlinePhase?.limits,
      phaseDefaults?.limits,
      featureConfig?.limits,
    ] as const,
  };

  return {
    phaseId,
    spec,
    critics: critics ?? null,
    tests,
    gate: resolveGate(groupLayers.gate),
    agent: resolveAgent(groupLayers.agent),
    container: resolveContainer(groupLayers.container),
    test: resolveTest(groupLayers.test),
    limits: resolveLimits(groupLayers.limits),
  };
}

/**
 * Returns the first non-undefined value (treating null as defined for
 * "explicitly absent"). Used for inheritance resolution where `undefined`
 * means "not set at this layer."
 */
function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (const v of values) if (v !== undefined) return v;
  return undefined;
}

/**
 * Resolve `tests` config across inheritance layers. Each sub-key resolves
 * independently (most-specific defined wins). Then the
 * "mutable=true ⇒ fail2pass=false unless explicit" rule fires.
 *
 * For the list-valued `immutable-files`, no key-level merge: a defined value
 * at any layer replaces all lower layers.
 *
 * `mutable`'s floor is `!projectDefaultStrict` rather than a hard-coded
 * built-in: strict ⇒ default-immutable, --no-strict ⇒ default-mutable. Per
 * §5.6 the project default applies only when nothing in the chain declares
 * `mutable`.
 */
function resolveTests(opts: {
  layers: (TestsConfig | undefined)[];
  projectDefaultStrict: boolean;
}): ResolvedTestsConfig {
  const { layers, projectDefaultStrict } = opts;
  const get = <K extends keyof TestsConfig>(key: K): TestsConfig[K] | undefined => {
    for (const l of layers) {
      if (l && l[key] !== undefined) return l[key];
    }
    return undefined;
  };

  const mutable = get('mutable') ?? !projectDefaultStrict;
  const explicitFail2pass = get('fail2pass');
  // Mutable=true auto-flips fail2pass to false UNLESS explicitly set (§9).
  const fail2pass = explicitFail2pass ?? (mutable ? false : BUILT_IN_DEFAULTS.testsFail2pass);
  const enforce = get('enforce') ?? BUILT_IN_DEFAULTS.testsEnforce;
  const immutableFiles = get('immutable-files') ?? BUILT_IN_DEFAULTS.testsImmutableFiles;
  const none = get('none') ?? false;

  return { mutable, fail2pass, enforce, immutableFiles, none };
}

// ---------------------------------------------------------------------------
// v1 group resolvers — `gate`, `agent`, `container`, `test`, `limits`.
//
// Each resolver follows the same shape as `resolveTests`: walk the layer
// list (most-specific first), pick the first defined value per sub-key.
// Object-valued sub-keys merge sub-key by sub-key (matches `tests`); the
// only list-valued sub-key in v1 is `agent.secrets`, which REPLACES at
// the most-specific layer (no key-level merge for lists, per design §4.2).
//
// `agent.env` is map-valued (`Record<string, string>`); we merge it by
// key across layers so a feature-level default (`AGENT_DEBUG: 1`) and a
// phase-level addition (`AGENT_FAST: 1`) coexist. Most-specific layer
// wins per key.
//
// All resolved fields stay optional. Unset means "no per-phase override;
// the threading site falls back to the run-level value."
// ---------------------------------------------------------------------------

/** Pick the first defined value at `key` across `layers` (most-specific first). */
function pick<L extends object, K extends keyof L>(
  layers: readonly (L | undefined | null)[],
  key: K,
): L[K] | undefined {
  for (const l of layers) {
    if (l != null && l[key] !== undefined) return l[key];
  }
  return undefined;
}

function resolveGate(layers: readonly (GateConfig | undefined)[]): ResolvedGateConfig {
  const out: ResolvedGateConfig = {};
  const script = pick(layers, 'script');
  if (script !== undefined) out.script = script;
  const retries = pick(layers, 'retries');
  if (retries !== undefined) out.retries = retries;
  return out;
}

function resolveAgent(layers: readonly (AgentConfig | undefined)[]): ResolvedAgentConfig {
  const out: ResolvedAgentConfig = {};
  const profile = pick(layers, 'profile');
  if (profile !== undefined) out.profile = profile;
  const script = pick(layers, 'script');
  if (script !== undefined) out.script = script;
  const install = pick(layers, 'install');
  if (install !== undefined) out.install = install;

  // env: merge by key across layers (most-specific wins per key).
  // Walk layers in REVERSE so least-specific writes first and is then
  // overwritten by more-specific. Result: each key gets its most-specific
  // value, but keys defined only at lower layers survive.
  let envMerged: Record<string, string> | undefined;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layerEnv = layers[i]?.env;
    if (layerEnv === undefined) continue;
    envMerged ??= {};
    Object.assign(envMerged, layerEnv);
  }
  if (envMerged !== undefined) out.env = envMerged;

  // secrets: list-valued, REPLACE at the most-specific layer.
  const secrets = pick(layers, 'secrets');
  if (secrets !== undefined) out.secrets = [...secrets];

  const model = pick(layers, 'model');
  if (model !== undefined) out.model = model;
  const baseUrl = pick(layers, 'base-url');
  if (baseUrl !== undefined) out.baseUrl = baseUrl;
  const reviewer = pick(layers, 'reviewer');
  if (reviewer !== undefined) out.reviewer = reviewer;
  return out;
}

function resolveContainer(
  layers: readonly (ContainerConfig | undefined)[],
): ResolvedContainerConfig {
  const out: ResolvedContainerConfig = {};
  const startup = pick(layers, 'startup');
  if (startup !== undefined) out.startup = startup;
  const cedar = pick(layers, 'cedar');
  if (cedar !== undefined) out.cedar = cedar;
  const noLeash = pick(layers, 'no-leash');
  if (noLeash !== undefined) out.noLeash = noLeash;
  const sandboxProfile = pick(layers, 'sandbox-profile');
  if (sandboxProfile !== undefined) out.sandboxProfile = sandboxProfile;
  const image = pick(layers, 'image');
  if (image !== undefined) out.image = image;
  const engine = pick(layers, 'engine');
  if (engine !== undefined) out.engine = engine;
  const composeFile = pick(layers, 'compose-file');
  if (composeFile !== undefined) out.composeFile = composeFile;
  return out;
}

function resolveTest(layers: readonly (TestConfig | undefined)[]): ResolvedTestConfig {
  const out: ResolvedTestConfig = {};
  const profile = pick(layers, 'profile');
  if (profile !== undefined) out.profile = profile;
  const image = pick(layers, 'image');
  if (image !== undefined) out.image = image;
  const script = pick(layers, 'script');
  if (script !== undefined) out.script = script;
  const stageScript = pick(layers, 'stage-script');
  if (stageScript !== undefined) out.stageScript = stageScript;
  const resolveAmbiguity = pick(layers, 'resolve-ambiguity');
  if (resolveAmbiguity !== undefined) out.resolveAmbiguity = resolveAmbiguity;
  const retries = pick(layers, 'retries');
  if (retries !== undefined) out.retries = retries;
  return out;
}

function resolveLimits(layers: readonly (LimitsConfig | undefined)[]): ResolvedLimitsConfig {
  const out: ResolvedLimitsConfig = {};
  const maxAttempts = pick(layers, 'max-attempts');
  if (maxAttempts !== undefined) out.maxAttempts = maxAttempts;
  return out;
}
