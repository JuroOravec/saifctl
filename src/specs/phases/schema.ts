/**
 * Zod schemas for `feature.yml` and `phase.yml`.
 *
 * See safe-ai-factory/TODO_phases_and_critics.md §5 for the full spec.
 *
 * Schemas validate shape only. Inheritance resolution and cross-file validation
 * (e.g. referenced critic id exists) live in load.ts and discover.ts.
 *
 * Notes on intentional design:
 * - `critics` is left optional with no default — `undefined` is meaningful: it
 *   triggers the "run all critics found in critics/" fallback at resolve time.
 *   `[]` (explicit empty list) means "run no critics."
 * - `tests.mutable`, `tests.fail2pass`, `tests.enforce` are NOT defaulted in
 *   the schema; the resolver applies built-in defaults so we can detect
 *   "explicitly set" vs "inherited" if needed.
 * - `tests.enforce: 'read-only'` parses successfully here so users can
 *   future-proof their config files. The cross-validator (`validatePhaseGraph`)
 *   rejects it as "not implemented in this release" until v2 lands.
 */

import { z } from 'zod';

/** Phase ids: lowercase kebab/snake, must not start with `(` (route-group reserved). */
const PHASE_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

const phaseIdSchema = z
  .string()
  .min(1, 'phase id must be non-empty')
  .regex(
    PHASE_ID_REGEX,
    'phase id must match /^[a-z0-9][a-z0-9_-]*$/ (lowercase, digits, hyphens, underscores)',
  )
  .refine((s) => !s.startsWith('('), {
    message: 'phase id must not start with `(` (reserved for Next.js-style route groups)',
  });

/** Critic ids: same charset rules as phase ids. */
const criticIdSchema = z
  .string()
  .min(1, 'critic id must be non-empty')
  .regex(
    PHASE_ID_REGEX,
    'critic id must match /^[a-z0-9][a-z0-9_-]*$/ (lowercase, digits, hyphens, underscores)',
  );

/**
 * One critic invocation entry. `rounds` defaults to 1 (one subtask) per §9.
 *
 * `id` matches a filename (sans `.md`) under `critics/`. Cross-checked at
 * validate-time in discover.ts.
 */
export const criticEntrySchema = z
  .object({
    id: criticIdSchema,
    rounds: z.number().int().min(1).default(1),
  })
  .strict();

/** Inferred type of {@link criticEntrySchema}: one critic invocation (`id` + `rounds`). */
export type CriticEntry = z.infer<typeof criticEntrySchema>;

/**
 * Reusable relative-path validator: rejects empty strings, paths with `..`
 * segments, POSIX absolute paths (`/...`), Windows-style absolute paths
 * (`C:\...` / `C:/...`), and UNC paths (`\\server\share`). Used by every
 * script-path field (`gate.script`, `agent.script`, `container.cedar`, etc.)
 * so the same safety guarantee applies uniformly across the new v1 groups.
 *
 * Note on the Windows / UNC cases: saifctl is normally run on macOS or
 * Linux where Node's `path.isAbsolute` would not catch a Windows-style
 * literal — but the schema is the *first* line of defence (the
 * script-resolver does its own `isAbsolute` + project-containment check
 * for defence-in-depth). Rejecting up-front keeps both layers honest.
 *
 * Globs (e.g. `tests.immutable-files`) inline a slightly looser variant of
 * this validator with the same guards but no "must look like a single
 * file" hint — those globs intentionally support `**`, etc.
 */
// Matches POSIX absolute (`/...`), Windows absolute (`C:\...`, `C:/...`),
// or UNC (`\\server\share`). Anchored at the start of the string.
const ABSOLUTE_PATH_REGEX = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

const relativePathSchema = z
  .string()
  .min(1, 'path must not be empty')
  .refine((s) => !s.includes('..') && !ABSOLUTE_PATH_REGEX.test(s), {
    message:
      'must be a path relative to the phase / feature / project dir; no `..` segments, no absolute paths (POSIX `/...`, Windows `C:\\...`, or UNC `\\\\server\\share`)',
  });

/**
 * Env-var name charset: `[A-Za-z_][A-Za-z0-9_]*`. Used for `agent.secrets`
 * entries (which name host env vars to copy into the coder container) and
 * for `agent.env` keys.
 */
const ENV_VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const envVarNameSchema = z
  .string()
  .min(1, 'env var name must not be empty')
  .regex(ENV_VAR_NAME_REGEX, 'must match /^[A-Za-z_][A-Za-z0-9_]*$/');

/**
 * Engine kind for `container.engine`. Matches the existing
 * `environments.coding.engine` discriminator at run-level.
 *
 * Note: only `coding`-engine selection is exposed at the phase level for v1.
 * Staging engine is whole-run (test runner is per-attempt; per-phase staging
 * engine override is in scope only insofar as `runner.*` knobs cover it).
 */
const engineKindSchema = z.enum(['docker', 'helm', 'local']);

/**
 * Test mutability + fail2pass + enforcement config. Applies at feature scope and
 * phase scope; resolution rules per §5.3 / §5.6.
 *
 * `immutable-files` are globs relative to the feature directory. Globs containing
 * `..` segments or absolute paths are rejected for safety.
 *
 * `none: true` declares "this phase has no own tests" (per-phase-config design
 * §6.5 option b). The phase's own `tests/` is bypassed; feature- and
 * project-level tests still gate at the run's last phase. Validator warns when
 * `none: true` is set alongside other `tests.*` fields (those become inert).
 */
export const testsConfigSchema = z
  .object({
    mutable: z.boolean().optional(),
    fail2pass: z.boolean().optional(),
    enforce: z.enum(['diff-inspection', 'read-only']).optional(),
    'immutable-files': z
      .array(
        z
          .string()
          .min(1)
          .refine((g) => !g.includes('..') && !ABSOLUTE_PATH_REGEX.test(g), {
            message:
              'immutable-files globs must be relative to the feature dir; no `..` segments, no absolute paths (POSIX `/...`, Windows `C:\\...`, or UNC `\\\\server\\share`)',
          }),
      )
      .optional(),
    none: z.boolean().optional(),
  })
  .strict();

/** Inferred type of {@link testsConfigSchema}: per-scope mutability + fail2pass + enforce + immutable-files. */
export type TestsConfig = z.infer<typeof testsConfigSchema>;

// ---------------------------------------------------------------------------
// v1 group schemas — gate, agent, container, runner, limits.
//
// Each group is object-valued and resolves sub-key by sub-key across the
// inheritance chain (matches the existing `tests:` rule). List-valued
// sub-keys (`agent.secrets`) replace at the most-specific layer; map-valued
// sub-keys (`agent.env`) merge by key.
//
// All group fields are optional. All schemas are `.strict()` so unknown
// keys fail fast at parse time.
//
// YAML uses kebab-case (e.g. `base-url`, `no-leash`); TS access uses the
// same kebab keys via bracket-notation (`agent['base-url']`), matching the
// existing `tests['immutable-files']` precedent. See per-phase-config
// design §6.7 for the convention rationale.
//
// Level-2 fields (per per-phase-config phase 7.5) parse here AND clear
// the §6.9.8 runtime-support gate. Level-3 fields (`container.image`,
// `container.sandbox-profile`, `container.engine`,
// `container.compose-file`) likewise parse and clear §6.9.8 (per phase
// `7.5b-level-3-mirror`). Cross-phase transitions for both Level-2 and
// Level-3 are runtime-driven by the loop (phase 7.5e:
// `loop.ts:tryStartTransition` builds the snapshot and persists it,
// `phase-transition.ts:completeControlledRestart` refreshes scripts
// after the engine teardown). The validator gates that previously
// rejected cross-phase Level-2/3 differences (`checkLevel2TransitionGate`
// / `checkLevel3TransitionGate`) were removed in 7.5e.
// ---------------------------------------------------------------------------

/**
 * Gate config — Level-1 (per-round, free per phase).
 *
 * - `script`: path to a custom gate script for this phase. Resolved
 *   phase-dir → feature-dir → project-root at compile time (per
 *   per-phase-config design §4.3). When unset, the run-level gate script
 *   applies.
 * - `retries`: max inner rounds for this phase before the agent gives up.
 *   When unset, the run-level `--gate-retries` applies.
 */
export const gateConfigSchema = z
  .object({
    script: relativePathSchema.optional(),
    retries: z.number().int().min(1).optional(),
  })
  .strict();

/** Inferred type of {@link gateConfigSchema}: per-phase gate script + retries. */
export type GateConfig = z.infer<typeof gateConfigSchema>;

/**
 * Agent config — mixed Level-1.5 (env / model / base-url / secrets / reviewer)
 * and Level-2 (profile / install / script when changing the installed agent).
 *
 * Per design §3.1, `profile` and explicit `script` / `install` lockstep:
 * setting both is unusual — the explicit value wins, the profile defaults
 * are dropped. Validator warns (6.9.4).
 *
 * `secrets` lists host env-var **names** copied into the coder secret env
 * (values never appear in YAML; never logged). Each entry must match
 * `[A-Za-z_][A-Za-z0-9_]*`. The list REPLACES inherited values at the
 * most-specific layer (no key-level merge for list-valued fields).
 *
 * `env` is a `Record<string, string>` and merges sub-key by sub-key across
 * the inheritance chain.
 *
 * `model` and `base-url` accept the same string forms as the run-level
 * `--model` / `--base-url` CLI flags (single global, or comma-separated
 * `agent=value` overrides). Phase-level value overrides run-level for
 * that phase's subtasks; threading lands in 7.4.
 *
 * `reviewer` toggles the post-gate semantic reviewer (Argus / `reviewer.sh`,
 * runs inside the coder container — there's only one reviewer, see §6.6).
 * When unset, the run-level `defaults.agent.reviewer` / `--no-reviewer`
 * baseline applies.
 */
export const agentConfigSchema = z
  .object({
    profile: z.string().min(1).optional(),
    script: relativePathSchema.optional(),
    install: relativePathSchema.optional(),
    env: z.record(envVarNameSchema, z.string()).optional(),
    secrets: z.array(envVarNameSchema).optional(),
    model: z.string().min(1).optional(),
    'base-url': z.string().min(1).optional(),
    reviewer: z.boolean().optional(),
  })
  .strict();

/** Inferred type of {@link agentConfigSchema}: per-phase agent identity / behaviour overrides. */
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * Container config — Level-2 (startup / cedar / no-leash) and Level-3
 * (image / sandbox-profile / engine / compose-file).
 *
 * Changing any of these between phases triggers a controlled coder-container
 * restart (Level-3 also implies an image pull or compose-stack swap).
 *
 * **Level-2** (`startup` / `cedar` / `no-leash`) is wired through the
 * compiler in per-phase-config phase 7.5: every emitted subtask carries
 * the fully-resolved Level-2 set. Cross-phase Level-2 differences are
 * runtime-driven by `loop.ts:tryStartTransition` +
 * `phase-transition.ts:completeControlledRestart` (phase 7.5e —
 * controlled coder-container restart at the boundary).
 *
 * **Level-3** (`image` / `sandbox-profile` / `engine` / `compose-file`)
 * is wired in `7.5b-level-3-mirror` (schema/compile threading). Engine
 * swaps, image pulls, and compose-stack management ship in
 * `7.5e-runtime-restart` — same loop hook as Level-2, with the engine's
 * `setup` / `teardown` driving the actual image pull / stack swap.
 *
 * `engine` selects the **coding** engine only — staging is always per-run.
 * `compose-file` is a path to a docker-compose file (only meaningful when
 * `engine: docker`).
 */
export const containerConfigSchema = z
  .object({
    startup: relativePathSchema.optional(),
    cedar: relativePathSchema.optional(),
    'no-leash': z.boolean().optional(),
    'sandbox-profile': z.string().min(1).optional(),
    image: z.string().min(1).optional(),
    engine: engineKindSchema.optional(),
    'compose-file': relativePathSchema.optional(),
  })
  .strict();

/** Inferred type of {@link containerConfigSchema}: per-phase coder container shape overrides. */
export type ContainerConfig = z.infer<typeof containerConfigSchema>;

/**
 * Runner config — Level-4 (test runner is recreated each outer attempt;
 * per-phase is just routing).
 *
 * Each field overrides the run-level equivalent at the active subtask's
 * test runner spin-up. When unset, the run-level value applies.
 *
 * Note: `tests.none: true` (in `testsConfigSchema`) is the "skip the runner
 * entirely for this phase" declaration; it's intentionally placed under
 * `tests:` (alongside mutability / fail2pass) because it's a content
 * declaration, not a runner toggle. See design §6.5.
 */
export const runnerConfigSchema = z
  .object({
    'test-profile': z.string().min(1).optional(),
    'test-image': z.string().min(1).optional(),
    'test-script': relativePathSchema.optional(),
    'stage-script': relativePathSchema.optional(),
    'resolve-ambiguity': z.enum(['off', 'prompt', 'ai']).optional(),
    'test-retries': z.number().int().min(1).optional(),
  })
  .strict();

/** Inferred type of {@link runnerConfigSchema}: per-phase test-runner overrides. */
export type RunnerConfig = z.infer<typeof runnerConfigSchema>;

/**
 * Limits config — per-phase outer-attempt cap (loop state).
 *
 * `max-attempts` is the per-phase analogue of the run-level `--max-runs`:
 * the orchestrator will fail the run after N outer attempts on this phase,
 * even if the global `maxRuns` budget is higher. Counter resets when a
 * phase's gate eventually passes; monotone within a single Run identity
 * (does not reset on `run resume`).
 */
export const limitsConfigSchema = z
  .object({
    'max-attempts': z.number().int().min(1).optional(),
  })
  .strict();

/** Inferred type of {@link limitsConfigSchema}: per-phase budget caps. */
export type LimitsConfig = z.infer<typeof limitsConfigSchema>;

/**
 * Per-phase configuration. Same shape used by:
 *   - `phases/<id>/phase.yml` (file)
 *   - `feature.yml.phases.defaults` (block)
 *   - `feature.yml.phases.phases.<id>` (inline override per §10.3)
 *
 * `critics:` declared here REPLACES inherited list entirely (no key-level merge).
 *
 * `spec` is a path relative to the phase directory; defaults to `spec.md` at
 * resolve time.
 *
 * The five group fields (`gate`, `agent`, `container`, `runner`, `limits`)
 * are object-valued and merge sub-key by sub-key across the inheritance
 * chain (matches the existing `tests:` rule). See the per-phase-config
 * design (`saifctl/features/per-phase-config/design.md`) for the full
 * lifecycle / cost model.
 */
export const phaseConfigSchema = z
  .object({
    critics: z.array(criticEntrySchema).optional(),
    spec: z
      .string()
      .min(1)
      .refine((s) => !s.includes('..') && !ABSOLUTE_PATH_REGEX.test(s), {
        message:
          'spec must be a path relative to the phase dir; no `..` segments, no absolute paths (POSIX `/...`, Windows `C:\\...`, or UNC `\\\\server\\share`)',
      })
      .optional(),
    tests: testsConfigSchema.optional(),
    gate: gateConfigSchema.optional(),
    agent: agentConfigSchema.optional(),
    container: containerConfigSchema.optional(),
    runner: runnerConfigSchema.optional(),
    limits: limitsConfigSchema.optional(),
  })
  .strict();

/** Inferred type of {@link phaseConfigSchema}: shape used by both `phase.yml` files and inline `feature.yml` overrides. */
export type PhaseConfig = z.infer<typeof phaseConfigSchema>;

/**
 * The `phases:` block inside `feature.yml`. Only meaningful when a `phases/` dir
 * exists; absence-of-dir is checked in discover.ts.
 *
 * - `order`: optional explicit ordering (overrides lexicographic default).
 *   Each entry must be a valid phase id.
 * - `defaults`: per-phase config inherited by every phase that doesn't override.
 * - `phases`: inline per-phase config map. Per-phase `phase.yml` files win
 *   when both exist. Map keys must be valid phase ids.
 */
const featurePhasesBlockSchema = z
  .object({
    order: z.array(phaseIdSchema).optional(),
    defaults: phaseConfigSchema.optional(),
    phases: z.record(phaseIdSchema, phaseConfigSchema).optional(),
  })
  .strict();

/**
 * Schema for `feature.yml`.
 *
 * - `critics` at this scope: default critic selection (used in no-phases mode,
 *   or as fallback in phased mode if neither `phases.defaults.critics` nor
 *   `phase.yml.critics` is set). Same "undefined = run all" rule applies.
 * - `tests` at this scope: feature-level mutability config. Applies to
 *   `features/<feat>/tests/`.
 * - `phases`: meaningful only when a `phases/` dir exists.
 * - `gate`, `agent`, `container`, `runner`, `limits` at this scope:
 *   feature-level defaults for the v1 groups (per per-phase-config design
 *   §6.8). Apply to non-phased features (single-spec features), and act as
 *   the inheritance root for phased features when neither
 *   `phases.defaults.<group>` nor `phases.phases.<id>.<group>` nor
 *   `phase.yml.<group>` is set.
 */
export const featureConfigSchema = z
  .object({
    critics: z.array(criticEntrySchema).optional(),
    tests: testsConfigSchema.optional(),
    phases: featurePhasesBlockSchema.optional(),
    gate: gateConfigSchema.optional(),
    agent: agentConfigSchema.optional(),
    container: containerConfigSchema.optional(),
    runner: runnerConfigSchema.optional(),
    limits: limitsConfigSchema.optional(),
  })
  .strict();

/** Inferred type of {@link featureConfigSchema}: parsed `feature.yml` (critics + tests + phases block). */
export type FeatureConfig = z.infer<typeof featureConfigSchema>;
