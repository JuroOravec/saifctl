/**
 * Standalone phased-feature validator (Block 6).
 *
 * Loads `feature.yml` + per-phase `phase.yml`, discovers `phases/` and
 * `critics/` on disk, runs the same cross-file structural checks as
 * `validatePhaseGraph` (discover.ts), then layers on file-existence checks
 * the compiler doesn't currently do (each phase's resolved spec file must
 * exist).
 *
 * Returns a {@link ValidationReport} (errors + warnings) — never throws
 * for routine validation failures, so `feat phases validate` can print
 * every problem at once instead of bailing on the first parse error.
 *
 * Two callers:
 *   - `compilePhasesToSubtasks` runs validation up-front and aborts on
 *     errors; the returned `context` lets compile reuse the loaded data.
 *   - `feat phases validate` and the `feat run` pre-flight call this
 *     directly to surface errors before the orchestrator boots.
 */

import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { pathExists } from '../../utils/io.js';
import { findUnusedImmutableFileGlobs } from '../tests/mutability.js';
import { countPhaseSubtasks } from './compile.js';
import {
  discoverCritics,
  type DiscoveredCritic,
  type DiscoveredPhase,
  discoverPhases,
  effectivePhaseOrder,
  validatePhaseGraph,
  type ValidationReport,
} from './discover.js';
import {
  loadFeatureConfig,
  loadPhaseConfig,
  MultipleConfigVariantsError,
  PhaseConfigParseError,
  type ResolvedPhaseConfig,
  resolvePhaseConfig,
} from './load.js';
import {
  formatNotYetImplementedMessage,
  isFieldRuntimeSupported,
  KNOWN_PHASE_CONFIG_FIELDS,
  lookupKnownField,
} from './runtime-support.js';
import type {
  AgentConfig,
  ContainerConfig,
  FeatureConfig,
  GateConfig,
  LimitsConfig,
  PhaseConfig,
  TestConfig,
  TestsConfig,
} from './schema.js';
import {
  resolveScriptPath,
  ScriptNotARegularFileError,
  ScriptNotFoundError,
  ScriptOutsideProjectError,
} from './script-resolver.js';

/** Loaded + discovered state shared between validate and compile. */
export interface PhasedFeatureContext {
  featureConfig: FeatureConfig | null;
  phases: DiscoveredPhase[];
  critics: DiscoveredCritic[];
  /** phaseId → loaded phase.yml (null when no file or when its load failed). */
  phaseConfigs: Map<string, PhaseConfig | null>;
  /** Whether `subtasks.json` is present alongside `phases/` (cross-check). */
  subtasksJsonPresent: boolean;
}

/** Inputs to {@link validatePhasedFeature}: feature dir and project root. */
export interface ValidatePhasedFeatureOptions {
  /** Absolute path to the feature directory. */
  featureAbsolutePath: string;
  /**
   * Absolute path to the project root. Required so the validator can
   * resolve per-phase script paths (`gate.script`, `agent.script`, …)
   * via the same phase → feature → project precedence the compiler
   * uses. Used by the per-phase-config phase 7.2 existence checks.
   */
  projectDir: string;
}

/**
 * Load → discover → validate. Always returns a report; only throws on
 * unexpected I/O errors (which surface as the underlying error type so the
 * caller can decide what to do). Parse and schema errors are folded into
 * `report.errors`.
 *
 * `context` is `null` when the report has errors — callers that need to do
 * further work (compile) should treat any error as a hard stop and not
 * try to use partial data.
 */
export async function validatePhasedFeature(opts: ValidatePhasedFeatureOptions): Promise<{
  report: ValidationReport;
  context: PhasedFeatureContext | null;
}> {
  const { featureAbsolutePath, projectDir } = opts;
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  const featureLabel = `[feature '${basename(featureAbsolutePath)}']`;

  const subtasksJsonPath = join(featureAbsolutePath, 'subtasks.json');
  const subtasksJsonPresent = await pathExists(subtasksJsonPath);

  let featureConfig: FeatureConfig | null = null;
  try {
    const result = await loadFeatureConfig(featureAbsolutePath);
    featureConfig = result?.config ?? null;
  } catch (err) {
    errors.push(`${featureLabel} ${formatLoadError(err)}`);
  }

  const { phases, invalidIds: invalidPhaseIds } = await discoverPhases(featureAbsolutePath);
  const { critics, invalidIds: invalidCriticIds } = await discoverCritics(featureAbsolutePath);

  const phaseConfigs = new Map<string, PhaseConfig | null>();
  for (const p of phases) {
    try {
      const loaded = await loadPhaseConfig(p.absolutePath);
      phaseConfigs.set(p.id, loaded?.config ?? null);
    } catch (err) {
      // Don't abort — record and move on so the user sees every parse
      // error in one pass. Other phases may still have valid configs.
      errors.push(`${featureLabel} ${formatLoadError(err)}`);
      phaseConfigs.set(p.id, null);
    }
  }

  // Cross-file structural checks.
  const cross = validatePhaseGraph({
    featureDir: featureAbsolutePath,
    featureConfig,
    phaseConfigs,
    discoveredPhases: phases,
    discoveredCritics: critics,
    invalidPhaseIds,
    invalidCriticIds,
    subtasksJsonPresent,
  });
  errors.push(...cross.errors);
  warnings.push(...cross.warnings);

  // File existence: each phase's resolved spec file must be on disk.
  // Per Block 5, the implementer prompt's "MUST read <spec>" directive must
  // never point at a missing file — that invites the agent to fabricate
  // content. The compiler bakes the resolved spec path into the prompt
  // verbatim, so this check belongs at validate time, before compile runs.
  //
  // Also caches the resolved per-phase configs for reuse below in the
  // adjacent-phase transition checks (§6.9.6 / §6.9.7).
  const resolvedByPhaseId = new Map<string, ResolvedPhaseConfig>();
  for (const p of phases) {
    const cfg = resolvePhaseConfig({
      phaseId: p.id,
      phaseConfig: phaseConfigs.get(p.id) ?? null,
      featureConfig,
    });
    resolvedByPhaseId.set(p.id, cfg);
    const specPath = join(p.absolutePath, cfg.spec);
    if (!(await pathExists(specPath))) {
      errors.push(
        `${featureLabel} phase '${p.id}' is missing its spec file '${cfg.spec}' (expected at ${specPath})`,
      );
    }
  }

  // Per-phase-config v1 lockstep validators (per per-phase-config design
  // §6.9). All checks run on the on-disk config sources rather than the
  // resolved per-phase config so the user sees the message at the source
  // location they need to edit. Adjacent-phase transition infos
  // (§6.9.6 / §6.9.7) use the resolved configs above.
  const sources = gatherConfigSources({ featureConfig, phaseConfigs, featureLabel });
  for (const source of sources) {
    checkLockstepRules({ source, errors, warnings });
    checkRuntimeSupport({ source, errors });
  }
  if (phases.length > 1) {
    const order = effectivePhaseOrder({ featureConfig, discoveredPhases: phases });
    checkAdjacentPhaseTransitions({ order, resolvedByPhaseId, featureLabel, infos });
  }
  // Per-phase-config 7.6 review N4: emit info when a phase declares
  // `limits.max-attempts` smaller than the minimum number of outer
  // attempts the phase will consume (1 per subtask, assuming first-try
  // success on each). Catches the common typo where a user expected
  // "give the phase N retries" but actually configured "abort the phase
  // after N total subtask completions."
  for (const p of phases) {
    const cfg = resolvedByPhaseId.get(p.id);
    if (!cfg) continue;
    checkPhaseBudgetVsSubtaskCount({
      phaseId: p.id,
      resolved: cfg,
      discoveredCritics: critics,
      featureLabel,
      infos,
    });
  }

  // Per-phase-config phase 7.2: existence check for runtime-supported
  // script-path fields (`gate.script`, `agent.script`). Surfaces missing
  // files at validate time so users see them before the orchestrator
  // boots. Skipped when the field hasn't shipped runtime support yet
  // (§6.9.8 will already error for unshipped fields).
  for (const p of phases) {
    const cfg = resolvedByPhaseId.get(p.id);
    if (!cfg) continue;
    await checkPhaseScriptPaths({
      resolved: cfg,
      phase: p,
      featureAbsolutePath,
      projectDir,
      featureLabel,
      errors,
    });
  }

  // per-phase-config phase 7.5e — Level-2/3 transition gates removed.
  // The runtime restart machinery (loop hook + per-attempt opts
  // derivation in `loop.ts`) ships in 7.5e, so cross-phase Level-2 / 3
  // transitions are now driven by `runIterativeLoop` at outer-attempt
  // boundaries instead of being rejected at validate time. The
  // §6.9.7 transition INFO message above still surfaces "this phase
  // boundary will trigger a controlled coder-container restart" so
  // users see the cost — but it's an info, not an error.

  // (No silent-fallthrough warning here — the F-A trap that warning
  // surfaced is closed; the run-level baseline pickers in `options.ts`
  // now read `featureConfig` directly. The previous companion gates
  // `checkLevel2TransitionGate` / `checkLevel3TransitionGate` and their
  // `toLevel{2,3}Snapshot` projection helpers were removed in 7.5e.)

  // Block 7 (§5.5): warn when a `feature.yml.tests.immutable-files` glob
  // matches no file on disk. Per the spec this is a *warning*, not an error
  // — the user may have declared the glob in anticipation of a phase that
  // hasn't written the test yet. We collect the on-disk feature-relative
  // test paths (under `tests/` and `phases/<id>/tests/`) and ask the
  // mutability module which globs went unused.
  const declaredGlobs = featureConfig?.tests?.['immutable-files'] ?? [];
  if (declaredGlobs.length > 0) {
    const featureRelativeTestPaths = await collectFeatureRelativeTestPaths({
      featureAbsolutePath,
      phases,
    });
    const unused = findUnusedImmutableFileGlobs({
      featureConfig,
      featureRelativeTestPaths,
    });
    for (const g of unused) {
      warnings.push(
        `${featureLabel} feature.yml.tests.immutable-files glob '${g}' matched zero files on disk (may match files added later)`,
      );
    }
  }

  const report: ValidationReport = { errors, warnings, infos };
  const context: PhasedFeatureContext | null =
    errors.length === 0
      ? { featureConfig, phases, critics, phaseConfigs, subtasksJsonPresent }
      : null;
  return { report, context };
}

// ---------------------------------------------------------------------------
// Per-phase-config v1 validators (§6.9.1–6.9.8)
// ---------------------------------------------------------------------------

/**
 * One source of per-phase config — the location string that anchors error
 * messages, plus the relevant sub-objects pulled out of the source.
 *
 * Sources include the four layers a setting can be declared at:
 * - `feature.yml` top-level (admitted at §6.8)
 * - `feature.yml.phases.defaults`
 * - `feature.yml.phases.phases.<id>` (inline)
 * - `phases/<id>/phase.yml`
 *
 * The lockstep validators (§6.9.1–6.9.5) and the runtime-support gate
 * (§6.9.8) walk these sources independently so the user sees the message
 * at the source location they need to edit.
 */
interface ConfigSource {
  /** Source label used as the error-message anchor (e.g. `feature.yml#agent.profile`). */
  from: string;
  /** Source label without a field anchor (e.g. `feature.yml`). */
  fromBase: string;
  tests?: TestsConfig;
  gate?: GateConfig;
  agent?: AgentConfig;
  container?: ContainerConfig;
  test?: TestConfig;
  limits?: LimitsConfig;
}

function gatherConfigSources(opts: {
  featureConfig: FeatureConfig | null;
  phaseConfigs: Map<string, PhaseConfig | null>;
  featureLabel: string;
}): ConfigSource[] {
  const out: ConfigSource[] = [];
  const { featureConfig, phaseConfigs, featureLabel } = opts;

  if (featureConfig) {
    out.push({
      from: `${featureLabel} feature.yml`,
      fromBase: 'feature.yml',
      tests: featureConfig.tests,
      gate: featureConfig.gate,
      agent: featureConfig.agent,
      container: featureConfig.container,
      test: featureConfig.test,
      limits: featureConfig.limits,
    });
  }
  if (featureConfig?.phases?.defaults) {
    const d = featureConfig.phases.defaults;
    out.push({
      from: `${featureLabel} feature.yml.phases.defaults`,
      fromBase: 'feature.yml.phases.defaults',
      tests: d.tests,
      gate: d.gate,
      agent: d.agent,
      container: d.container,
      test: d.test,
      limits: d.limits,
    });
  }
  for (const [pid, p] of Object.entries(featureConfig?.phases?.phases ?? {})) {
    if (!p) continue;
    out.push({
      from: `${featureLabel} feature.yml.phases.phases.${pid}`,
      fromBase: `feature.yml.phases.phases.${pid}`,
      tests: p.tests,
      gate: p.gate,
      agent: p.agent,
      container: p.container,
      test: p.test,
      limits: p.limits,
    });
  }
  for (const [pid, pc] of phaseConfigs) {
    if (!pc) continue;
    out.push({
      from: `${featureLabel} phases/${pid}/phase.yml`,
      fromBase: `phases/${pid}/phase.yml`,
      tests: pc.tests,
      gate: pc.gate,
      agent: pc.agent,
      container: pc.container,
      test: pc.test,
      limits: pc.limits,
    });
  }
  return out;
}

/**
 * Lockstep validators 6.9.1–6.9.5. See per-phase-config design §6.9 for the
 * exact message contract — these strings are pinned by tests and any change
 * is a contract change.
 */
function checkLockstepRules(opts: {
  source: ConfigSource;
  errors: string[];
  warnings: string[];
}): void {
  const { source, errors, warnings } = opts;

  // 6.9.1 — cedar + no-leash: hard error.
  // Cedar policy is meaningless without Leash to enforce it; emitting the
  // policy with `no-leash: true` produces a misleading audit trail (the
  // policy is in the artifact but never applied).
  if (source.container?.cedar !== undefined && source.container?.['no-leash'] === true) {
    errors.push(
      `${source.from}: has both \`container.cedar\` and \`container.no-leash: true\` set. Cedar policy is meaningless without Leash. Either remove \`container.cedar\` or set \`container.no-leash: false\`.`,
    );
  }

  // 6.9.2 — tests.none + other tests.* keys: warn.
  // Other tests.* keys configure runner behaviour that's bypassed when
  // tests.none is true; warn so the user knows the fields are inert.
  if (source.tests?.none === true) {
    const inertKeys: string[] = [];
    if (source.tests.mutable !== undefined) inertKeys.push('mutable');
    if (source.tests.fail2pass !== undefined) inertKeys.push('fail2pass');
    if (source.tests.enforce !== undefined) inertKeys.push('enforce');
    if (source.tests['immutable-files'] !== undefined) inertKeys.push('immutable-files');
    if (inertKeys.length > 0) {
      warnings.push(
        `${source.from}: sets \`tests.none: true\` alongside \`tests.${joinKeysForMessage(inertKeys)}\`. When \`tests.none: true\`, those fields are inert because the runner is bypassed for this phase.`,
      );
    }
  }

  // 6.9.3 — tests.none + test.* keys: warn.
  if (source.tests?.none === true && source.test) {
    const testKeys = listSetKeys(source.test);
    if (testKeys.length > 0) {
      warnings.push(
        `${source.from}: sets \`tests.none: true\` alongside \`test.${joinKeysForMessage(testKeys)}\`. The test runner is bypassed for this phase, so \`test.*\` is inert.`,
      );
    }
  }

  // 6.9.4 — agent.profile + explicit agent.script / agent.install: warn.
  if (source.agent?.profile !== undefined) {
    const explicit: string[] = [];
    if (source.agent.script !== undefined) explicit.push('script');
    if (source.agent.install !== undefined) explicit.push('install');
    if (explicit.length > 0) {
      warnings.push(
        `${source.from}: sets \`agent.profile\` and also explicitly sets \`agent.${joinKeysForMessage(explicit)}\`. The explicit value takes precedence over the profile defaults; this is unusual and may indicate a configuration mistake. To inherit the profile's defaults, omit \`agent.${joinKeysForMessage(explicit)}\`.`,
      );
    }
  }

  // 6.9.5 — container.sandbox-profile + container.image: warn.
  if (
    source.container?.['sandbox-profile'] !== undefined &&
    source.container?.image !== undefined
  ) {
    warnings.push(
      `${source.from}: sets \`container.sandbox-profile\` and also explicitly sets \`container.image\`. The explicit value takes precedence. To inherit the profile's image, omit \`container.image\`.`,
    );
  }

  // 6.9.10 (review L2 from phase 7.5c) — container.compose-file is only
  // meaningful when the coding engine is `docker`. The schema admits both
  // fields together, but `resolveCodingEnvironment` silently drops the
  // compose-file when the resolved engine is `helm` / `local`. Warn so
  // the user knows their declaration is inert (or so they know to also
  // declare `container.engine: docker` to make the compose-file
  // effective).
  if (
    source.container?.['compose-file'] !== undefined &&
    source.container?.engine !== undefined &&
    source.container.engine !== 'docker'
  ) {
    warnings.push(
      `${source.from}: sets \`container.compose-file\` alongside \`container.engine: ${source.container.engine}\`. \`compose-file\` is only meaningful when \`engine: docker\` — for the \`${source.container.engine}\` engine the compose file is ignored. Either remove \`container.compose-file\` or set \`container.engine: docker\`.`,
    );
  }
}

/**
 * §6.9.8 — emit a "not yet implemented" error for any new field whose
 * runtime support hasn't shipped yet. Reads from
 * {@link runtime-support.KNOWN_PHASE_CONFIG_FIELDS}; each subsequent
 * implementation phase adds its fields to the supported set.
 */
function checkRuntimeSupport(opts: { source: ConfigSource; errors: string[] }): void {
  const { source, errors } = opts;
  for (const field of KNOWN_PHASE_CONFIG_FIELDS) {
    if (isFieldRuntimeSupported(field.path)) continue;
    if (!isFieldSetInSource(source, field.path)) continue;
    errors.push(`${source.from}: ${formatNotYetImplementedMessage(field)}`);
  }
}

/**
 * §6.9.6 / §6.9.7 — for each adjacent (prev, next) phase pair, emit infos
 * naming each Level-2 / Level-3 setting that differs. Triggers a
 * coder-container restart (Level 2) or image pull / compose swap (Level 3)
 * once the runtime-support for those levels lands.
 *
 * **Historical context (review F-H):** in 7.5 / 7.5b, the companion
 * `checkLevel2TransitionGate` / `checkLevel3TransitionGate` errored on
 * the same triggers this function infos on. They were removed in 7.5e
 * once the runtime path landed (cross-phase differences are now driven
 * at runtime by `loop.ts:tryStartTransition` +
 * `phase-transition.ts:completeControlledRestart`). The infos stay —
 * they're valid FYI for any run that crosses a Level-2/3 boundary so
 * the user sees the cost class up-front (script refresh seconds
 * vs. image pull / stack swap minutes).
 *
 * Level-3 fields used to trip §6.9.8 in earlier releases; phase 7.5b
 * cleared that gate, and 7.5e closed the runtime side. The info
 * preview from `feat phases compile` is the up-front signal users get.
 */
function checkAdjacentPhaseTransitions(opts: {
  order: string[];
  resolvedByPhaseId: Map<string, ResolvedPhaseConfig>;
  featureLabel: string;
  infos: string[];
}): void {
  const { order, resolvedByPhaseId, featureLabel, infos } = opts;
  for (let i = 1; i < order.length; i++) {
    const prevId = order[i - 1]!;
    const nextId = order[i]!;
    const prev = resolvedByPhaseId.get(prevId);
    const next = resolvedByPhaseId.get(nextId);
    if (!prev || !next) continue;

    for (const field of KNOWN_PHASE_CONFIG_FIELDS) {
      if (field.level !== '2' && field.level !== '3') continue;
      const prevValue = readResolvedFieldByPath(prev, field.path);
      const nextValue = readResolvedFieldByPath(next, field.path);
      if (resolvedValuesEqual(prevValue, nextValue)) continue;
      const message =
        field.level === '2'
          ? `${featureLabel} phases '${prevId}' → '${nextId}' change \`${field.path}\` (${formatValueForMessage(prevValue)} → ${formatValueForMessage(nextValue)}). This triggers a coder-container restart between phases (~10–30s). To minimise restarts, group phases by lifecycle-Level-2 settings.`
          : `${featureLabel} phases '${prevId}' → '${nextId}' change \`${field.path}\` (${formatValueForMessage(prevValue)} → ${formatValueForMessage(nextValue)}). This triggers a docker pull/build and container restart between phases. First-time image pulls may take minutes.`;
      infos.push(message);
    }
  }
}

/**
 * Per-phase-config 7.6 review N4: emit info when a phase declares
 * `limits.max-attempts` smaller than the minimum number of outer
 * attempts the phase will consume — i.e., one outer attempt per
 * subtask, assuming first-try success on every subtask.
 *
 * Catches the common typo where the user intended "give the phase N
 * retries on failure" but actually configured "any failure mid-phase
 * fails the run immediately." The cap counts every outer attempt that
 * runs a phaseId-bearing subtask, not just retries on the impl row.
 *
 * **Behavioural nuance (per-phase-config 7.6 review M1).** The runtime
 * `phaseBudgetExhaustedMessage` is consulted ONLY from the loop's
 * failure branches (immutable-test violation / no-changes patch /
 * tests-failed). A successful subtask ticks the counter but does not
 * gate on it — so a phase with `cap: 2` and 5 subtasks where every
 * subtask succeeds first try completes successfully (counter
 * overshoots: count=5, cap=2). Only on a FAILURE does count >= cap
 * matter. The user-visible effect of `cap < minSubtasks` is therefore
 * "any failure mid-phase fails the run immediately," not "the phase
 * is guaranteed to fail."
 *
 * Quiet (no message) when:
 *   - the phase has no `limits.max-attempts` declared,
 *   - the cap is ≥ the minimum subtask count (configured for retries on
 *     top of first-try success), or
 *   - the phase is the legacy non-phased path (no resolved config).
 */
function checkPhaseBudgetVsSubtaskCount(opts: {
  phaseId: string;
  resolved: ResolvedPhaseConfig;
  discoveredCritics: readonly DiscoveredCritic[];
  featureLabel: string;
  infos: string[];
}): void {
  const cap = opts.resolved.limits.maxAttempts;
  if (cap === undefined) return;
  const minimumSubtasks = countPhaseSubtasks({
    resolvedCritics: opts.resolved.critics,
    discoveredCritics: [...opts.discoveredCritics],
  });
  if (cap >= minimumSubtasks) return;
  opts.infos.push(
    `${opts.featureLabel} phase '${opts.phaseId}' declares \`limits.max-attempts: ${cap}\` ` +
      `but the phase has ${minimumSubtasks} subtasks (1 impl + critic rounds). The cap counts ` +
      `every outer attempt that runs a phaseId-bearing subtask — not just retries on impl. ` +
      `With this cap, any failure mid-phase fails the run immediately (the budget is already ` +
      `at or above cap before any retry would be allowed). First-try success on every subtask ` +
      `still completes the phase, but there is zero retry headroom. Did you mean a higher cap ` +
      `(≥ ${minimumSubtasks}) so the phase can recover from at least one failure?`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Join field names into the comma-and-list form used in §6.9 messages. */
function joinKeysForMessage(keys: string[]): string {
  if (keys.length === 1) return keys[0]!;
  if (keys.length === 2) return `{${keys.join('|')}}`;
  return `{${keys.join('|')}}`;
}

/** List sub-keys of an object that are explicitly defined (non-undefined). */
function listSetKeys(obj: Record<string, unknown>): string[] {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
}

/**
 * Test whether a kebab-cased dotted path (e.g. `agent.base-url`) is set on
 * a {@link ConfigSource}. The path's first segment is the group; the rest
 * is the YAML key into that group.
 */
function isFieldSetInSource(source: ConfigSource, path: string): boolean {
  const meta = lookupKnownField(path);
  if (!meta) return false;
  const [group, ...rest] = path.split('.');
  const groupKey = rest.join('.');
  const groupValue = (source as unknown as Record<string, Record<string, unknown> | undefined>)[
    group!
  ];
  if (!groupValue) return false;
  return groupValue[groupKey] !== undefined;
}

/**
 * Read a kebab-cased dotted YAML path from a {@link ResolvedPhaseConfig}.
 *
 * The resolved config camel-cases YAML kebab keys (`base-url` → `baseUrl`,
 * `no-leash` → `noLeash`), so we transform the key segment before access.
 */
function readResolvedFieldByPath(resolved: ResolvedPhaseConfig, path: string): unknown {
  const [group, ...rest] = path.split('.');
  const yamlKey = rest.join('.');
  const camelKey = kebabToCamel(yamlKey);
  const groupValue = (resolved as unknown as Record<string, Record<string, unknown> | undefined>)[
    group!
  ];
  if (!groupValue) return undefined;
  return groupValue[camelKey];
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_m, c) => (c as string).toUpperCase());
}

/** Equality test that handles `undefined`, primitives, and shallow object comparisons. */
function resolvedValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function formatValueForMessage(v: unknown): string {
  if (v === undefined) return '<unset>';
  if (typeof v === 'string') return `'${v}'`;
  return JSON.stringify(v);
}

/**
 * Check that runtime-supported per-phase script paths actually resolve
 * on disk before the orchestrator tries to read them at compile time.
 * Surfaces missing-file / out-of-project errors with the same source
 * label the user will recognise from `phase.yml` / `feature.yml`.
 *
 * Skipped when the field hasn't shipped runtime support yet — §6.9.8
 * already errors for those, so duplicating with a "missing file" error
 * would be noise. As later phases land, more fields enter this check
 * automatically.
 */
async function checkPhaseScriptPaths(opts: {
  resolved: ResolvedPhaseConfig;
  phase: DiscoveredPhase;
  featureAbsolutePath: string;
  projectDir: string;
  featureLabel: string;
  errors: string[];
}): Promise<void> {
  const { resolved, phase, featureAbsolutePath, projectDir, featureLabel, errors } = opts;
  const sourceLabel = `${featureLabel} phase '${phase.id}'`;

  const checks: { fieldPath: string; relativePath: string | undefined }[] = [
    { fieldPath: 'gate.script', relativePath: resolved.gate.script },
    { fieldPath: 'agent.script', relativePath: resolved.agent.script },
    { fieldPath: 'agent.install', relativePath: resolved.agent.install },
    { fieldPath: 'container.startup', relativePath: resolved.container.startup },
    { fieldPath: 'container.cedar', relativePath: resolved.container.cedar },
    { fieldPath: 'container.compose-file', relativePath: resolved.container.composeFile },
    { fieldPath: 'test.script', relativePath: resolved.test.script },
    { fieldPath: 'test.stage-script', relativePath: resolved.test.stageScript },
  ];

  for (const c of checks) {
    if (c.relativePath === undefined) continue;
    if (!isFieldRuntimeSupported(c.fieldPath)) continue;
    try {
      await resolveScriptPath(c.relativePath, {
        phaseAbsolutePath: phase.absolutePath,
        featureAbsolutePath,
        projectDir,
        fieldPath: c.fieldPath,
        sourceLabel,
      });
    } catch (err) {
      if (
        err instanceof ScriptNotFoundError ||
        err instanceof ScriptOutsideProjectError ||
        err instanceof ScriptNotARegularFileError
      ) {
        errors.push(`${sourceLabel}: ${err.message}`);
      } else {
        // Unexpected I/O error — surface as a generic error rather than throw.
        errors.push(
          `${sourceLabel}: failed to validate \`${c.fieldPath}\`: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

// Phase 7.5e removed `checkLevel2TransitionGate` /
// `checkLevel3TransitionGate` + their `toLevel{2,3}Snapshot` projection
// helpers. The runtime side (loop-side controlled coder-container
// restart at phase boundaries, in `loop.ts:runIterativeLoop` +
// `phase-transition.ts:runControlledRestart`) now drives the actual
// transition; cross-phase Level-2/3 differences are no longer rejected
// at validate time. The §6.9.7 transition INFO message in
// `checkAdjacentPhaseTransitions` still surfaces "this boundary will
// trigger a controlled restart" so users see the cost class up-front.
//
// Phase 7.5c removed `checkLevel2_3SilentFallthrough` and its
// `LEVEL_2_3_CLI_HINT` companion table. The trap they surfaced (F-A:
// uniform top-level / phases.defaults Level-2/3 declarations silently
// ignored at runtime) is closed — the run-level baseline pickers in
// `options.ts` now read `featureConfig.agent` / `.container` (and their
// `phases.defaults` siblings). See [`phases/05c-feature-config-threading/spec.md`](../../../saifctl/features/per-phase-config/phases/05c-feature-config-threading/spec.md).

function formatLoadError(err: unknown): string {
  if (err instanceof PhaseConfigParseError || err instanceof MultipleConfigVariantsError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Walk `<feature>/tests/` and every `<feature>/phases/<id>/tests/` and
 * return each file's path **relative to the feature dir**, POSIX-separated
 * (e.g. `tests/login.spec.ts`, `phases/01-core/tests/x.spec.ts`).
 *
 * Used by the unused-glob warning above. We do the walk only when there's
 * at least one declared glob, so no I/O cost when the feature doesn't use
 * the per-file escape hatch.
 *
 * Missing dirs are silently skipped (a feature may have phases but no
 * top-level `tests/`, or vice versa).
 */
async function collectFeatureRelativeTestPaths(opts: {
  featureAbsolutePath: string;
  phases: DiscoveredPhase[];
}): Promise<string[]> {
  const out: string[] = [];
  const roots = [
    join(opts.featureAbsolutePath, 'tests'),
    ...opts.phases.map((p) => join(p.absolutePath, 'tests')),
  ];
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    for (const f of await walkFiles(root)) {
      out.push(relative(opts.featureAbsolutePath, f).replaceAll('\\', '/'));
    }
  }
  return out;
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}
