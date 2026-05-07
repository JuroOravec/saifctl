/**
 * Per-phase-config phases 7.5 / 7.5b / 7.5d / 7.5e — detection +
 * orchestration helpers for the controlled coder-container restart at
 * phase boundaries.
 *
 * **What this module ships:**
 *   - **Detection** (phases 7.5 / 7.5b): `detectLevel2Transition` /
 *     `requiresLevel2Restart` and their Level-3 siblings compare adjacent
 *     subtasks' resolved fields and return the diff. Used by the
 *     compiler to set `requiresLevel2RestartFromPrev` /
 *     `requiresLevel3RestartFromPrev` on impl subtasks.
 *   - **Snapshot construction** (phase 7.5d): `buildTransitionSnapshot`
 *     turns a (prev, next, cursor) triple into a
 *     {@link RunTransitionInProgress} value plus the field-set / cost
 *     class. Returns `null` when no Level-2/3 difference is present.
 *     Used by `loop.ts:onSubtaskComplete` to populate the persisted
 *     transition flag at a phase boundary.
 *   - **Completion orchestration** (phase 7.5d): `completeControlledRestart`
 *     drives the post-teardown half (refresh sandbox scripts → clear
 *     flag) with the "refresh failure keeps the flag set" invariant for
 *     idempotent crash recovery. Called by `loop.ts` both from the
 *     normal post-teardown branch (`outcome: 'transitioned'`) and from
 *     the resume-recovery branch when an artifact loads with
 *     `transitionInProgress` already set on disk.
 *   - **All-in-one helper**: `runControlledRestart` chains
 *     persist → refresh → clear with the same artifact-first-write
 *     invariant. Production splits the persist half from the
 *     refresh+clear half (engine teardown happens between), so the
 *     all-in-one form is used directly only by callers that don't
 *     teardown a container in the middle (currently: tests; future
 *     synchronous callers).
 *
 * The Level-2/3 transition gates that previously lived in
 * `validate.ts` (`checkLevel2TransitionGate` / `checkLevel3TransitionGate`)
 * were removed in phase 7.5e once the runtime path landed; cross-phase
 * Level-2/3 differences are now handled at runtime by `loop.ts` driving
 * `buildTransitionSnapshot` + `completeControlledRestart` at the boundary.
 *
 * **Spec deviation (per-phase-config 7.5e review N8).** The 05e spec
 * named a `sandbox.ts:recreateCoderContainerAgainstSandbox(sandbox, opts)`
 * helper to be factored out of `createSandbox` so the transition could
 * recreate without re-running sandbox-dir initialisation. The
 * implementation took a different shape: the engine layer
 * (`runEngineAttempt`) already knows how to start a fresh coder
 * container against an existing sandbox dir, and the post-teardown
 * script refresh is handled by `refreshSandboxScriptsForSandbox`. So
 * the transition flow is "engine teardown → refresh scripts → next
 * runEngineAttempt sets up a fresh container" rather than "engine
 * teardown → recreateCoderContainerAgainstSandbox(...)". Functionally
 * equivalent; no separate helper is needed because the layering is
 * already in place. The spec text predated this realisation.
 *
 * Level-2 fields bound at coder-container creation:
 *   - `agent.profile`        → drives `agent.sh` + `agent-install.sh`
 *   - `agent.install`        → file content baked into `agent-install.sh`
 *   - `container.startup`    → file content baked into `startup.sh`
 *   - `container.cedar`      → Leash policy file content
 *   - `container.no-leash`   → whether Leash wraps the container
 *
 * Level-3 fields (added by phase 7.5b — level-3-mirror):
 *   - `container.image`            — image pull / build / retag.
 *   - `container.sandbox-profile`  — image change implied.
 *   - `container.engine`           — docker / helm / local engine swap.
 *   - `container.compose-file`     — compose-stack swap.
 *
 * The two cost classes are kept distinct in the detector surface so the
 * loop's transition log line and the persisted `costClass` field can
 * differentiate cheap Level-2 boundaries (script refresh; reuses the
 * existing pause/resume code path — seconds) from Level-3 boundaries
 * (image pull / compose-stack swap — potentially minutes).
 */

import type { RunSubtask, RunSubtaskInput, RunTransitionInProgress } from '../runs/types.js';

/** Subset of the subtask shape this module reads — accepts manifest + runtime rows. */
export type SubtaskWithLevel2Fields = Pick<
  RunSubtask | RunSubtaskInput,
  'agentProfileId' | 'agentInstallScript' | 'startupScript' | 'cedarScript' | 'dangerousNoLeash'
>;

/**
 * Result of {@link detectLevel2Transition}: lists the Level-2 field paths
 * (kebab-case YAML form, e.g. `agent.profile`) whose effective value
 * differs between the previous and next subtask. Empty array means no
 * transition is needed.
 *
 * Returned as an array (not a set) so callers can iterate deterministically
 * and embed the field names in error / log messages.
 */
export interface Level2TransitionDiff {
  /** Field paths that differ. Stable order: source-of-declaration order in {@link LEVEL_2_FIELDS}. */
  fields: string[];
}

/**
 * The Level-2 fields as they're emitted on `RunSubtaskInput`, paired with
 * their YAML path (used for log / error messages). Order is stable across
 * runs so transition diffs are deterministic.
 */
const LEVEL_2_FIELDS: readonly {
  key: keyof SubtaskWithLevel2Fields;
  path: string;
}[] = [
  { key: 'agentProfileId', path: 'agent.profile' },
  { key: 'agentInstallScript', path: 'agent.install' },
  { key: 'startupScript', path: 'container.startup' },
  { key: 'cedarScript', path: 'container.cedar' },
  { key: 'dangerousNoLeash', path: 'container.no-leash' },
];

/**
 * Compare two adjacent subtasks' Level-2 field-sets. Returns the list of
 * field paths whose effective value differs. Empty array ⇒ no transition
 * needed (the next subtask can run in the same coder container).
 *
 * Used by:
 *   - The compiler (`compile.ts`), to set
 *     `requiresLevel2RestartFromPrev: true` on the `next` subtask's
 *     impl row when the diff is non-empty.
 *   - {@link buildTransitionSnapshot}, which folds Level-2 + Level-3
 *     diffs into the persisted snapshot the loop writes at a phase
 *     boundary (phase 7.5d/7.5e).
 *
 * Equality is shallow value comparison (`===`). Script-content fields
 * are strings (resolved at compile time), so a content difference shows
 * up as a string-inequality. `undefined === undefined` (both unset) is
 * treated as equal — a phase that doesn't override a field doesn't
 * trigger a transition just by being silent.
 */
export function detectLevel2Transition(
  prev: SubtaskWithLevel2Fields,
  next: SubtaskWithLevel2Fields,
): Level2TransitionDiff {
  const fields: string[] = [];
  for (const f of LEVEL_2_FIELDS) {
    if (prev[f.key] !== next[f.key]) {
      fields.push(f.path);
    }
  }
  return { fields };
}

/**
 * Convenience: `true` when adjacent subtasks differ on any Level-2 field.
 */
export function requiresLevel2Restart(
  prev: SubtaskWithLevel2Fields,
  next: SubtaskWithLevel2Fields,
): boolean {
  return detectLevel2Transition(prev, next).fields.length > 0;
}

// ---------------------------------------------------------------------------
// Level-3 sibling — image pull / engine swap / compose-stack swap.
// Mirrors the Level-2 surface above. Kept in a parallel structure (rather
// than folded into Level-2) so the loop and `buildTransitionSnapshot` can
// branch on cost class — Level-3 transitions can take minutes (image
// pull) where Level-2 transitions are seconds (script refresh + container
// restart).
// ---------------------------------------------------------------------------

/** Subset of the subtask shape this module reads for Level-3 — accepts manifest + runtime rows. */
export type SubtaskWithLevel3Fields = Pick<
  RunSubtask | RunSubtaskInput,
  'containerImage' | 'containerSandboxProfileId' | 'containerEngine' | 'containerComposeFile'
>;

/**
 * Result of {@link detectLevel3Transition}: lists the Level-3 field paths
 * (kebab-case YAML form, e.g. `container.image`) whose effective value
 * differs between the previous and next subtask. Empty array means no
 * transition is needed.
 *
 * Same shape as {@link Level2TransitionDiff} but kept as a separate type
 * so callers can pattern-match on the cost class without losing
 * exhaustiveness.
 */
export interface Level3TransitionDiff {
  /** Field paths that differ. Stable order: source-of-declaration order in {@link LEVEL_3_FIELDS}. */
  fields: string[];
}

/**
 * The Level-3 fields as they're emitted on `RunSubtaskInput`, paired with
 * their YAML path (used for log / error messages). Order is stable across
 * runs so transition diffs are deterministic.
 */
const LEVEL_3_FIELDS: readonly {
  key: keyof SubtaskWithLevel3Fields;
  path: string;
}[] = [
  { key: 'containerImage', path: 'container.image' },
  { key: 'containerSandboxProfileId', path: 'container.sandbox-profile' },
  { key: 'containerEngine', path: 'container.engine' },
  { key: 'containerComposeFile', path: 'container.compose-file' },
];

/**
 * Compare two adjacent subtasks' Level-3 field-sets. Mirrors
 * {@link detectLevel2Transition}: `===` equality, `undefined === undefined`
 * is "no diff," and the result's `fields` array is in stable
 * declaration order.
 *
 * Used by:
 *   - The compiler (`compile.ts`), to set
 *     `requiresLevel3RestartFromPrev: true` on the next phase's first
 *     impl subtask when the diff is non-empty.
 *   - {@link buildTransitionSnapshot}, which combines the Level-3 diff
 *     with the Level-2 diff to derive the cost class (`'level-2'` /
 *     `'level-3'` / `'level-2-3'`) the loop persists on the artifact
 *     at a phase boundary.
 */
export function detectLevel3Transition(
  prev: SubtaskWithLevel3Fields,
  next: SubtaskWithLevel3Fields,
): Level3TransitionDiff {
  const fields: string[] = [];
  for (const f of LEVEL_3_FIELDS) {
    if (prev[f.key] !== next[f.key]) {
      fields.push(f.path);
    }
  }
  return { fields };
}

/**
 * Convenience: `true` when adjacent subtasks differ on any Level-3 field.
 */
export function requiresLevel3Restart(
  prev: SubtaskWithLevel3Fields,
  next: SubtaskWithLevel3Fields,
): boolean {
  return detectLevel3Transition(prev, next).fields.length > 0;
}

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5d — controlled-restart helpers.
//
// Orchestrate the bookkeeping half of a Level-2/3 controlled
// coder-container restart at a phase boundary. Production callers
// (`loop.ts`) split the work in two halves because the engine teardown
// runs between them:
//
//   1. `buildTransitionSnapshot` + persist  ← inside `onSubtaskComplete`
//   2. (engine `finally` tears down the coder + Leash containers)
//   3. `completeControlledRestart`           ← in the outer iteration loop
//
// Invariants enforced by the helpers:
//   - **Artifact write before teardown.** The snapshot is persisted to
//     storage BEFORE the engine tears down, so a crash anywhere from the
//     persist through to the script refresh is recoverable by `run
//     resume`: the snapshot survives, the resume re-runs
//     `completeControlledRestart` from the same cursor against the same
//     fresh-container target, and idempotent file writes pick up where
//     the previous run left off.
//   - **Refresh, then clear.** The sandbox-script refresh runs after
//     the artifact write. On success, the flag is cleared (the
//     transition committed). On failure, the flag stays set so a
//     `run resume` re-runs the completion rather than activating the
//     next subtask against a stale-script container.
//
// `runControlledRestart` chains persist → refresh → clear in one call
// for synchronous callers (and pins both invariants in one test surface).
// Kept callback-shaped so unit tests drive the orchestration with fakes
// (no real sandbox, no real storage); production binds real callbacks
// to the active sandbox + run-storage handle.
//
// **Pause/stop semantic (per-phase-config 7.5e review N4 — chosen
// variant (a): "transition completes, then pauses").** The pause and
// stop signals are checked at the top of `loop.ts:onSubtaskComplete`
// (BEFORE `tryStartTransition`) and per inner round inside
// `runCodingPhase`. Once a transition is in flight (the snapshot is
// persisted, the engine is tearing down), control signals are not
// polled until the next coder container boots. Effect: if `run pause`
// arrives while the engine teardown / refresh-scripts step is running,
// the transition completes first and the next outer attempt's first
// inner round is what observes the pause and honors it. The reverse
// variant (abort the transition, pause partway through) was rejected
// because it would leave the artifact with `transitionInProgress` set
// AND a pending pause — a state machine `run resume` would have to
// disambiguate. Wait-for-completion keeps the resume contract simple:
// either you resume into a normal `running` state, or you resume into
// the recovery branch that runs `completeControlledRestart` once.
// ---------------------------------------------------------------------------

/** Per-call inputs to {@link buildTransitionSnapshot}. */
export interface BuildTransitionSnapshotOpts {
  /** Subtask the run is advancing FROM (the just-completed active subtask). */
  prev: SubtaskWithLevel2Fields & SubtaskWithLevel3Fields;
  /** Subtask the run is advancing INTO (becomes the new active subtask). */
  next: SubtaskWithLevel2Fields & SubtaskWithLevel3Fields;
  /** Cursor of the next subtask — persisted on the snapshot for crash reconstruction. */
  toSubtaskIndex: number;
  /** ISO clock — overridable for deterministic tests. Defaults to `() => new Date().toISOString()`. */
  nowIso?: () => string;
}

/** Result of {@link buildTransitionSnapshot}. */
export interface TransitionSnapshotComputation {
  /** The {@link RunTransitionInProgress} payload to persist on the artifact. */
  snapshot: RunTransitionInProgress;
  /** Field paths that triggered the transition (kebab-case YAML form). Stable order. */
  fields: readonly string[];
  /** Cost class — `'level-2-3'` when both detectors fired, else `'level-2'` / `'level-3'`. */
  costClass: 'level-2' | 'level-3' | 'level-2-3';
}

/**
 * Compute the {@link RunTransitionInProgress} payload for a phase
 * boundary. Returns `null` when neither Level-2 nor Level-3 fields differ
 * (no transition needed).
 *
 * Cost class derivation: Level-2 only ⇒ `'level-2'`; Level-3 only ⇒
 * `'level-3'`; both ⇒ `'level-2-3'`. The `fields` array concatenates
 * Level-2 fields first, then Level-3, in the stable per-detector order.
 *
 * Pure compute — no I/O. The caller persists the snapshot via its own
 * storage handle and decides cursor / log-message / driver-action shape.
 */
export function buildTransitionSnapshot(
  opts: BuildTransitionSnapshotOpts,
): TransitionSnapshotComputation | null {
  const { prev, next, toSubtaskIndex } = opts;
  const nowIso = opts.nowIso ?? ((): string => new Date().toISOString());
  const level2Fields = detectLevel2Transition(prev, next).fields;
  const level3Fields = detectLevel3Transition(prev, next).fields;
  if (level2Fields.length === 0 && level3Fields.length === 0) {
    return null;
  }
  const costClass: 'level-2' | 'level-3' | 'level-2-3' =
    level2Fields.length > 0 && level3Fields.length > 0
      ? 'level-2-3'
      : level2Fields.length > 0
        ? 'level-2'
        : 'level-3';
  const fields: readonly string[] = [...level2Fields, ...level3Fields];
  const snapshot: RunTransitionInProgress = {
    toSubtaskIndex,
    costClass,
    fields,
    startedAt: nowIso(),
  };
  return { snapshot, fields, costClass };
}

/** Per-call inputs to {@link completeControlledRestart}. */
export interface CompleteControlledRestartOpts {
  /**
   * Refresh the bind-mounted sandbox scripts (gate / agent / startup /
   * cedar / etc.) so the next coder container reads the new active
   * subtask's Level-2 content.
   */
  refreshSandboxScripts: () => Promise<void>;
  /**
   * Clear `transitionInProgress` on the artifact. Called only on success.
   * On refresh failure, this is NOT called — the flag stays set so
   * `run resume` re-runs the completion idempotently.
   */
  clearTransitionInProgress: () => Promise<void>;
}

/**
 * Drive the post-teardown half of a controlled restart: refresh sandbox
 * scripts, then clear the flag.
 *
 * Throws the underlying error from `refreshSandboxScripts` unchanged so
 * the caller can decide whether to abort the run or surface a partial-
 * transition log line. On failure, the artifact flag stays set so a
 * subsequent `run resume` re-enters this helper from the seeded state.
 *
 * **Why the flag stays set on refresh failure (per-phase-config 7.5e
 * review N6).** The phase-05e spec uses the word "cleanup" in two
 * different senses across two sections:
 *
 *   - §"Tests" → cleanup-on-error reads the word as "report the error
 *     to the user and don't leak resources" — i.e., bubble the failure
 *     up so the run is marked failed (rather than spinning in a
 *     half-completed transition).
 *   - §"Risk surface" + §"Tests" → resume-during pins the
 *     idempotent-resume contract: the `transitionInProgress` marker
 *     MUST survive the artifact load so `run resume` re-runs the
 *     refresh step from the same seed.
 *
 * Reading "cleanup" as "clear the flag" makes the two sections
 * contradict; reading it as "surface the error and stop" reconciles
 * them. The implementation takes the latter reading: `refreshSandboxScripts`
 * throws bubble out of this helper, but `clearTransitionInProgress` is
 * NOT called — so the on-disk artifact still has the snapshot when
 * `run resume` opens it, and the recovery branch in `loop.ts` re-enters
 * here from the same seed. Clearing the flag on error would silently
 * activate the next subtask against stale bind-mounted scripts, which
 * is the worst-case failure mode this whole machinery exists to
 * prevent.
 *
 * Used by `loop.ts` from two call sites:
 *   - Normal post-teardown branch (`runCodingPhase` returned
 *     `outcome: 'transitioned'`).
 *   - Resume-recovery branch (an artifact loaded from disk with
 *     `transitionInProgress` already set — i.e., a prior run crashed
 *     between the persist and the refresh).
 */
export async function completeControlledRestart(
  opts: CompleteControlledRestartOpts,
): Promise<void> {
  await opts.refreshSandboxScripts();
  // Refresh succeeded; commit the transition by clearing the flag.
  await opts.clearTransitionInProgress();
}

/**
 * Per-phase-config 7.5e — review N2: enrich an error thrown by the first
 * `runCodingPhase` call after a transition with the transition's phase
 * id + field set, so a user with a typo in `phase.yml` sees which YAML
 * field to fix rather than the raw Docker / compose error.
 *
 * Wraps the original error in a new {@link Error} whose message prepends
 * the phase / field context AND whose `cause` is set to the original.
 * The original error is preserved unchanged for downstream tooling that
 * walks the cause chain.
 *
 * Returns the wrapped error rather than throwing so callers can decide
 * whether to throw or log + continue.
 */
export function enrichErrorWithTransitionContext(opts: {
  err: unknown;
  transition: RunTransitionInProgress;
  activeSubtask: { phaseId?: string; title?: string } | undefined;
}): Error {
  const { err, transition, activeSubtask } = opts;
  const original = err instanceof Error ? err : new Error(String(err));
  const phaseLabel = activeSubtask?.phaseId
    ? `phase '${activeSubtask.phaseId}'`
    : activeSubtask?.title
      ? `subtask '${activeSubtask.title}'`
      : `subtask index ${transition.toSubtaskIndex}`;
  const fieldsLabel = transition.fields.map((f) => `\`${f}\``).join(', ');
  const wrapped = new Error(
    `[orchestrator] Controlled restart for ${phaseLabel} failed after applying ` +
      `${transition.costClass} fields (${fieldsLabel}). ` +
      `Check the corresponding \`phase.yml\` field(s) and \`saifctl run resume <id>\` to retry. ` +
      `Underlying error: ${original.message}`,
    { cause: original },
  );
  // Preserve the original stack so traces still point at the underlying
  // Docker / compose failure site.
  if (original.stack) wrapped.stack = original.stack;
  return wrapped;
}

/** Per-call inputs to {@link runControlledRestart}. */
export interface RunControlledRestartOpts {
  /** Cursor of the subtask the run is advancing INTO (the new active subtask). */
  toSubtaskIndex: number;
  /**
   * Field paths that triggered the transition (from `detectLevel2Transition`
   * / `detectLevel3Transition`). Stable order. Persisted to the artifact and
   * surfaced in log / error messages. Order matters for deterministic UX
   * across crashes — re-running the transition should produce the same
   * fields list.
   */
  fields: readonly string[];
  /**
   * Cost class. The detector helpers report Level-2 and Level-3 separately;
   * when both fired in the same diff, the loop picks `'level-2-3'` so the
   * caller can branch on the cost (e.g. only pull the image when Level-3
   * fields differ).
   */
  costClass: 'level-2' | 'level-3' | 'level-2-3';
  /**
   * Persist the {@link RunTransitionInProgress} snapshot to storage. MUST
   * write the artifact (and wait for it) before returning — the
   * artifact-before-teardown invariant relies on this. Failures bubble up
   * unchanged so the caller can decide whether to abort the transition or
   * mark the run failed.
   */
  persistTransitionInProgress: (snapshot: RunTransitionInProgress) => Promise<void>;
  /**
   * Refresh the bind-mounted sandbox scripts (gate / agent / startup /
   * cedar / etc.) so the next coder container reads the new active
   * subtask's Level-2 content. Wraps `sandbox.ts:refreshSandboxScripts`
   * in the loop integration; tests pass a fake.
   */
  refreshSandboxScripts: () => Promise<void>;
  /**
   * Clear `transitionInProgress` on the artifact. Called only on success.
   * On error, the flag stays set so `run resume` re-runs the transition.
   */
  clearTransitionInProgress: () => Promise<void>;
  /** ISO clock — overridable for deterministic tests. Defaults to `() => new Date().toISOString()`. */
  nowIso?: () => string;
}

/**
 * Drive a Level-2/3 controlled coder-container restart's bookkeeping half.
 *
 * Flow: persist transitionInProgress → refresh sandbox scripts → clear
 * transitionInProgress. On any error in the refresh step, the flag stays
 * set (the caller's `clearTransitionInProgress` is NOT called), so a
 * crashed-mid-transition run resumes idempotently.
 *
 * Throws the underlying error from `persistTransitionInProgress` or
 * `refreshSandboxScripts` so the caller can decide policy. Successful
 * returns leave the run in the post-transition state with the flag
 * cleared.
 */
export async function runControlledRestart(opts: RunControlledRestartOpts): Promise<void> {
  const nowIso = opts.nowIso ?? ((): string => new Date().toISOString());
  const snapshot: RunTransitionInProgress = {
    toSubtaskIndex: opts.toSubtaskIndex,
    costClass: opts.costClass,
    fields: opts.fields,
    startedAt: nowIso(),
  };
  // 1. Persist BEFORE teardown so a crash here is recoverable.
  await opts.persistTransitionInProgress(snapshot);
  // 2. Refresh + clear share the "refresh failure keeps the flag set"
  //    invariant with the production loop's resume-recovery branch.
  await completeControlledRestart({
    refreshSandboxScripts: opts.refreshSandboxScripts,
    clearTransitionInProgress: opts.clearTransitionInProgress,
  });
}
