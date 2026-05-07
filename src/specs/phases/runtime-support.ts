/**
 * Feature-flag table for v1 per-phase-config field surface
 * (`saifctl/features/per-phase-config/design.md` §6.9.8).
 *
 * Every new field added by per-phase-config v1 is listed here with the
 * **lifecycle level** it belongs to and the **implementation phase** that
 * ships its runtime support. Until the runtime side ships, `validate.ts`
 * emits an error so users don't write config that's silently ignored.
 *
 * Lifecycle levels (per design §2):
 *   1     — file-rewrite; container alive (per-round)
 *   1.5   — file-rewrite + small `coder-start.sh` extension
 *   2     — coder-container restart; sandbox dir kept
 *   3     — image / engine swap (Level 2 + docker pull / compose replace)
 *   4     — test runner (recreated per attempt; routing only)
 *   loop  — orchestrator loop state
 *
 * Implementation phases (per design §7):
 *   7.1  — schema-and-validate (schema + validators only)
 *   7.2  — level-1-threading (gate.*, agent.script)
 *   7.3  — level-4-threading (runner.*, tests.none)
 *   7.4  — level-1.5-fast-path (agent.env, model, base-url, secrets, reviewer)
 *   7.5  — level-2-restart, first half (agent.profile, agent.install,
 *          container.startup / cedar / no-leash) — schema + manifest
 *          threading + cross-phase validator gate
 *   7.5b — level-3-mirror (container.image / sandbox-profile / engine /
 *          compose-file) — schema mirror of 7.5 for Level-3. Also bundled
 *          the 7.5c work (`options.ts` pickers reading `featureConfig`),
 *          closing the F-A silent-fallthrough trap.
 *   7.5c — feature-config-threading — folded into 7.5b's actual landing.
 *          Tracked separately for design-doc clarity but no remaining
 *          code work.
 *   7.5d — controlled-restart-foundation (artifact field
 *          `transitionInProgress` + `RunTransitionInProgress` snapshot type;
 *          `phase-transition.ts:runControlledRestart` orchestration helper;
 *          `sandbox.ts:refreshSandboxScripts` exported for the loop
 *          integration to call directly)
 *   7.5e — runtime-restart (loop-side controlled coder-container restart;
 *          per-attempt opts derivation from active subtask manifest;
 *          replaces the Level-2/3 transition gates from 7.5 / 7.5b)
 *   7.6  — per-phase max-attempts (limits.max-attempts)
 *
 * Each subsequent step's PR removes its fields' entries from
 * {@link UNIMPLEMENTED_FIELDS}. Once 7.6 ships, the set is empty and
 * the 6.9.8 validator becomes a no-op.
 *
 * The table is the single source of truth. The schema accepts every
 * field (so users can future-proof their config), but the validator
 * gates execution against this table.
 */

/** Lifecycle level a field belongs to — drives the validator message text. */
export type FieldLifecycleLevel = '1' | '1.5' | '2' | '3' | '4' | 'loop';

/** Metadata about a per-phase-config field, used by the 6.9.8 validator. */
export interface FieldRuntimeSupport {
  /** Dotted path as it appears in `phase.yml` (kebab-case, matches YAML). */
  readonly path: string;
  /** Lifecycle level — drives the "not yet implemented" message text. */
  readonly level: FieldLifecycleLevel;
  /** Implementation phase id that will ship the runtime support. */
  readonly shipsIn: string;
}

/**
 * Every per-phase-config v1 field, with its lifecycle level and the
 * implementation phase that ships its runtime. Source of truth — keep
 * in lockstep with `schema.ts`.
 */
export const KNOWN_PHASE_CONFIG_FIELDS: readonly FieldRuntimeSupport[] = [
  // tests.none — Level 4 (runner bypass), ships in 7.3
  { path: 'tests.none', level: '4', shipsIn: '7.3-level-4-threading' },

  // Level 1 — gate.*
  { path: 'gate.script', level: '1', shipsIn: '7.2-level-1-threading' },
  { path: 'gate.retries', level: '1', shipsIn: '7.2-level-1-threading' },

  // Level 1 — agent.script (changing the script content; same agent install)
  { path: 'agent.script', level: '1', shipsIn: '7.2-level-1-threading' },

  // Level 1.5 — agent env / model / base-url / secrets / reviewer
  { path: 'agent.env', level: '1.5', shipsIn: '7.4-level-1.5-fast-path' },
  { path: 'agent.secrets', level: '1.5', shipsIn: '7.4-level-1.5-fast-path' },
  { path: 'agent.model', level: '1.5', shipsIn: '7.4-level-1.5-fast-path' },
  { path: 'agent.base-url', level: '1.5', shipsIn: '7.4-level-1.5-fast-path' },
  { path: 'agent.reviewer', level: '1.5', shipsIn: '7.4-level-1.5-fast-path' },

  // Level 2 — agent profile / install
  { path: 'agent.profile', level: '2', shipsIn: '7.5-level-2-restart' },
  { path: 'agent.install', level: '2', shipsIn: '7.5-level-2-restart' },

  // Level 2 — container startup / cedar / no-leash
  { path: 'container.startup', level: '2', shipsIn: '7.5-level-2-restart' },
  { path: 'container.cedar', level: '2', shipsIn: '7.5-level-2-restart' },
  { path: 'container.no-leash', level: '2', shipsIn: '7.5-level-2-restart' },

  // Level 3 — container image / sandbox-profile / engine / compose-file.
  // Schema/compile threading shipped in `7.5b-level-3-mirror` (which
  // also cleared the §6.9.8 gate). The runtime restart machinery
  // (image pull / engine swap / compose-stack swap) shipped in
  // `7.5e-runtime-restart`: cross-phase differences are now handled
  // at runtime by `loop.ts:tryStartTransition` +
  // `phase-transition.ts:completeControlledRestart` rather than rejected
  // at validate time.
  { path: 'container.sandbox-profile', level: '3', shipsIn: '7.5b-level-3-mirror' },
  { path: 'container.image', level: '3', shipsIn: '7.5b-level-3-mirror' },
  { path: 'container.engine', level: '3', shipsIn: '7.5b-level-3-mirror' },
  { path: 'container.compose-file', level: '3', shipsIn: '7.5b-level-3-mirror' },

  // Level 4 — runner.*
  { path: 'runner.test-profile', level: '4', shipsIn: '7.3-level-4-threading' },
  { path: 'runner.test-image', level: '4', shipsIn: '7.3-level-4-threading' },
  { path: 'runner.test-script', level: '4', shipsIn: '7.3-level-4-threading' },
  { path: 'runner.stage-script', level: '4', shipsIn: '7.3-level-4-threading' },
  { path: 'runner.resolve-ambiguity', level: '4', shipsIn: '7.3-level-4-threading' },
  { path: 'runner.test-retries', level: '4', shipsIn: '7.3-level-4-threading' },

  // Loop state — limits.max-attempts
  { path: 'limits.max-attempts', level: 'loop', shipsIn: '7.6-per-phase-max-attempts' },
];

const KNOWN_FIELDS_INDEX: ReadonlyMap<string, FieldRuntimeSupport> = new Map(
  KNOWN_PHASE_CONFIG_FIELDS.map((f) => [f.path, f]),
);

/**
 * Set of fields whose runtime support has shipped. Phase 7.1 ships none
 * — every field listed in {@link KNOWN_PHASE_CONFIG_FIELDS} is rejected
 * by the 6.9.8 validator.
 *
 * Each subsequent step adds its fields here as part of the same PR
 * that lands the runtime threading.
 */
const RUNTIME_SUPPORTED_FIELDS: ReadonlySet<string> = new Set<string>([
  // Phase 7.2 — level-1-threading: gate.script / gate.retries / agent.script
  // shipped via `compile.ts:resolvePhaseLevel1Overrides`.
  'gate.script',
  'gate.retries',
  'agent.script',
  // Phase 7.3 — level-4-threading: runner.* + tests.none shipped via
  // `compile.ts:resolvePhaseLevel4Overrides` + `loop.ts:resolveActiveRunnerOpts`.
  'tests.none',
  'runner.test-profile',
  'runner.test-image',
  'runner.test-script',
  'runner.stage-script',
  'runner.resolve-ambiguity',
  'runner.test-retries',
  // Phase 7.4 — level-1.5-fast-path: agent.env / agent.secrets /
  // agent.model / agent.base-url / agent.reviewer shipped via
  // `compile.ts:buildPhaseLevel1_5Overrides` +
  // `per-subtask-env.ts:computeSubtaskEnv` (sourced by `coder-start.sh`
  // on every inner round, no container restart required).
  'agent.env',
  'agent.secrets',
  'agent.model',
  'agent.base-url',
  'agent.reviewer',
  // Phase 7.5 — level-2-restart: schema admits these everywhere, compiler
  // emits them on every subtask, and the run-level baseline pickers in
  // `options.ts` read `featureConfig.{agent,container}` (and the
  // `phases.defaults` siblings) so YAML declarations propagate through
  // to the coder container (F-A silent-fallthrough trap closed in 7.5b).
  //
  // Cross-phase Level-2 transitions are runtime-driven by phase 7.5e:
  // `loop.ts:onSubtaskComplete` calls `phase-transition.ts:buildTransitionSnapshot`
  // at the boundary, persists `transitionInProgress`, and the outer
  // iteration loop runs `phase-transition.ts:completeControlledRestart`
  // after the engine teardown to refresh bind-mounted scripts before the
  // next coder container boots. The `checkLevel2TransitionGate` /
  // `checkLevel3TransitionGate` validators were removed alongside.
  'agent.profile',
  'agent.install',
  'container.startup',
  'container.cedar',
  'container.no-leash',
  // Phase 7.5b (level-3-mirror) — schema/compile threading for the
  // four Level-3 fields: container.image / container.sandbox-profile /
  // container.engine / container.compose-file. Runtime path is the same
  // 7.5e mechanism as Level-2 above; cost class differs (image pull /
  // engine swap / compose-stack swap can take minutes where Level-2 is
  // a script refresh).
  'container.image',
  'container.sandbox-profile',
  'container.engine',
  'container.compose-file',
  // Phase 7.6 (per-phase-max-attempts) — `limits.max-attempts` shipped via
  // `compile.ts` (emits `limits.maxAttempts` on every emitted subtask) +
  // `loop.ts` (per-phase outer-attempt counter on `RunArtifact#phaseAttemptCount`,
  // fail-fast in `onSubtaskComplete` when the active subtask's
  // `limits.maxAttempts` is exhausted).
  'limits.max-attempts',
]);

/** Lookup metadata for a known field path; `null` for unknown / pre-existing keys. */
export function lookupKnownField(path: string): FieldRuntimeSupport | null {
  return KNOWN_FIELDS_INDEX.get(path) ?? null;
}

/**
 * True when the field at `path` has shipped runtime support.
 *
 * Returns `true` for unknown paths so existing pre-v1 fields (`critics`,
 * `spec`, `tests.mutable`, etc.) are not gated. Only fields explicitly
 * listed in {@link KNOWN_PHASE_CONFIG_FIELDS} are subject to the gate.
 */
export function isFieldRuntimeSupported(path: string): boolean {
  if (!KNOWN_FIELDS_INDEX.has(path)) return true;
  return RUNTIME_SUPPORTED_FIELDS.has(path);
}

/**
 * Format the §6.9.8 "not yet implemented" message for one field.
 * Per-field (not per-group) so users see exactly what to remove.
 */
export function formatNotYetImplementedMessage(field: FieldRuntimeSupport): string {
  const levelDescription = formatLevelDescription(field.level);
  return (
    `uses \`${field.path}\`. Per-phase ${levelDescription} overrides are not yet ` +
    `implemented in this saifctl release. Remove the field, or wait for the next minor version.`
  );
}

function formatLevelDescription(level: FieldLifecycleLevel): string {
  switch (level) {
    case '1':
      return 'lifecycle-Level-1';
    case '1.5':
      return 'lifecycle-Level-1.5';
    case '2':
      return 'lifecycle-Level-2';
    case '3':
      return 'lifecycle-Level-3';
    case '4':
      return 'lifecycle-Level-4';
    case 'loop':
      return 'loop-state';
  }
}
