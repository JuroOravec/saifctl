/**
 * Run storage types for persisting agent run artifacts.
 *
 * Persisted for every run when storage is enabled for `run ls`, `run start`, and tests.
 */

import type { LiveInfra } from '../engines/types.js';
import type { LlmOverrides } from '../llm-config.js';
import type { SerializedLoopOpts } from './utils/serialize.js';

export type { DockerLiveInfra, LiveInfra, LocalLiveInfra } from '../engines/types.js';

/** Lifecycle state of a run artifact — terminal (`failed`/`completed`), live (`running`/`paused`/`inspecting`), or transitional. */
export type RunStatus =
  | 'failed'
  | 'completed'
  | 'running'
  | 'paused'
  | 'inspecting'
  /** CLI/orchestrator is beginning `run start` / `feat run` before the loop marks `running`. */
  | 'starting'
  /** `run pause` requested; orchestrator is winding down to `paused`. */
  | 'pausing'
  /** `run stop` requested while live; orchestrator tearing down to `failed`. */
  | 'stopping'
  /** `run resume` handoff before the loop marks `running`. */
  | 'resuming';

/**
 * Live inspect session metadata while {@link RunStatus} is `"inspecting"`.
 * Cleared when the session ends; used by tooling (e.g. VS Code) to attach to the idle coder container.
 */
export interface RunInspectSession {
  /** Docker container name (Leash target or `docker run --name`). */
  containerName: string;
  /**
   * Full Docker container ID from `docker inspect` (64-char hex). Prefer for editor attach when set.
   * `null` when we failed to resolve the container ID.
   */
  containerId: string | null;
  /** In-container workspace path (bind-mounted sandbox code). */
  workspacePath: string;
  /** When the inspect session became ready for attach. */
  startedAt: string;
}

/** Passed to `AbortController.abort()` when `run pause` requests a cooperative stop. */
export const SAIFCTL_PAUSE_ABORT_REASON = 'saifctl-pause';

/** Passed to `AbortController.abort()` when `run stop` requests immediate teardown. */
export const SAIFCTL_STOP_ABORT_REASON = 'saifctl-stop';

/**
 * Passed to `AbortController.abort()` when either the run-timeout or the
 * per-subtask timeout fires. Distinct reason so the catch-site knows to
 * format the failure as a timeout (with budget vs. elapsed) rather than a
 * generic abort. The actual timeout details (kind, budget, elapsed,
 * subtask) live in the loop's `timeoutCause` variable — see
 * `runIterativeLoop`.
 */
export const SAIFCTL_RUN_TIMEOUT_ABORT_REASON = 'saifctl-run-timeout';

/**
 * Passed to `AbortController.abort()` when the coder engine container exited
 * before the host driver received a `subtask-done` signal — i.e. the shell
 * died (silent `set -e`, OOM-kill, signal) without writing the protocol's
 * exit-code handshake file. Without this abort, `pollSubtaskDone` would poll
 * forever and `Promise.all([engine, driver])` would deadlock.
 *
 * Treated by `runCodingPhase` as a normal completion-with-failure (no
 * subtask results, caller marks the run failed). Distinct from `pause` /
 * `stop` so callers can tell user-initiated control from container death.
 */
export const SAIFCTL_ENGINE_EXITED_REASON = 'saifctl-engine-exited';

/** External control signal a user can request via `run pause` / `run stop`. */
export type RunControlAction = 'pause' | 'stop';

/**
 * Last-write-wins control from `run pause` / `run stop` while an orchestrator is active.
 * Cleared when the run leaves {@link RunStatus} `"running"` or the signal is consumed.
 */
export interface RunControlSignal {
  action: RunControlAction;
  requestedAt: string;
}

/** Thrown by {@link RunStorage.requestPause} when the run is not active. */
export class RunCannotPauseError extends Error {
  override readonly name = 'RunCannotPauseError';

  constructor(
    readonly runId: string,
    readonly status: RunStatus,
  ) {
    super(
      `Run "${runId}" cannot be paused (status: "${status}"). Only a run with status "running" can be paused.`,
    );
  }
}

/** Thrown by {@link RunStorage.requestStop} when the run cannot be stopped. */
export class RunCannotStopError extends Error {
  override readonly name = 'RunCannotStopError';

  constructor(
    readonly runId: string,
    readonly status: RunStatus,
  ) {
    super(
      `Run "${runId}" cannot be stopped (status: "${status}"). ` +
        `Stop applies to live or transitional runs (running, paused, starting, pausing, stopping, resuming).`,
    );
  }
}

/**
 * One-off rules apply only until the coding round finishes;
 * `always` rules repeat every round.
 */
export type RunRuleScope = 'once' | 'always';

/**
 * User feedback injected into the agent task (see {@link RunArtifact#rules}).
 * `once` rules get {@link RunRule#consumedAt} set after the coding phase of
 * the round that included them.
 */
export interface RunRule {
  id: string;
  content: string;
  scope: RunRuleScope;
  createdAt: string;
  updatedAt: string;
  /** When set, a `once` rule is no longer included in the task prompt. */
  consumedAt?: string;
}

/**
 * One recorded commit in the sandbox / artifact worktree (message + unified diff + optional author).
 * Diffs apply in order on top of `baseCommitSha` + optional `basePatchDiff` + prior run commits.
 */
export interface RunCommit {
  message: string;
  diff: string;
  /** Git author line, e.g. `Name <email>`. Defaults to saifctl when omitted on apply. */
  author?: string;
}

/** Outcome of one inner iteration in coder-start.sh (agent → gate → optional reviewer). */
export type InnerRoundPhase =
  | 'agent_failed'
  | 'gate_passed'
  | 'gate_failed'
  | 'reviewer_passed'
  | 'reviewer_failed';

/** Summary of one inner agent → gate → reviewer iteration within an outer attempt. */
export interface InnerRoundSummary {
  /** 1-based inner round index within this outer attempt */
  round: number;
  phase: InnerRoundPhase;
  /** Agent/gate/reviewer output on failure; truncated in shell (~2k chars) */
  gateOutput?: string;
  startedAt: string;
  completedAt: string;
}

/** Outcome of one orchestrator outer attempt (one agent container + staging tests). */
export type OuterAttemptPhase =
  | 'no_changes'
  | 'tests_passed'
  | 'tests_failed'
  | 'aborted'
  /** Agent finished; staging tests skipped (`skipStagingTests`, e.g. sandbox / POC designer). */
  | 'sandbox_complete';

/**
 * Compile-time-known critic prompt metadata (Block 4 of TODO_phases_and_critics).
 *
 * The compiler emits one of these on every critic subtask. Everything except
 * `phase.baseRef` is known at compile time — `baseRef` is the git rev at the
 * start of the phase's implementer subtask and is captured by the loop just
 * before the critic subtask becomes the active row. The renderer in
 * `src/specs/phases/critic-prompt.ts` consumes this metadata together with
 * the runtime `phase.baseRef` to mustache-render the subtask's `content`.
 *
 * `content` on the subtask carries the raw `critics/<id>.md` body — the
 * manifest stays faithful to what the user wrote. Rendering is a runtime
 * concern; the artifact is never mutated.
 */
export interface RunSubtaskCriticPrompt {
  criticId: string;
  /** 1-based round counter; matches the subtask title. */
  round: number;
  totalRounds: number;
  /**
   * Each critic round compiles to two subtasks: 'discover' (writes findings
   * to {@link findingsPath}; does NOT modify code) and 'fix' (reads findings,
   * applies fixes, deletes the file). See §6 of the planning doc.
   */
  step: 'discover' | 'fix';
  /**
   * Container-side path (under `/workspace`) of the temp findings file
   * shared between this round's discover + fix subtasks. Pinned per
   * (phase, critic, round) so re-runs are deterministic.
   */
  findingsPath: string;
  /**
   * Mustache `feature.*` and `phase.{id,dir,spec,tests}` values precomputed
   * by the compiler. Inlined here so the loop can render without re-walking
   * the feature dir. `phase.baseRef` is filled in by the loop.
   */
  vars: {
    feature: { name: string; dir: string; plan: string };
    phase: { id: string; dir: string; spec: string; tests: string };
  };
}

/**
 * Per-subtask test scope — the gate's view of which test directories are
 * in-scope for this subtask.
 *
 * - `include`: absolute paths (host-side) to test directories that should be
 *   merged into the gate's testsDir. Each path follows the same `tests/`
 *   layout the test runner expects (`public/`, `hidden/`, `helpers.ts`,
 *   `infra.spec.ts`). Caller (Block 3 phase compiler) is responsible for
 *   producing absolute paths; the loop does not validate them.
 * - `cumulative`: when `true` (default), prior subtasks' `include` paths are
 *   prepended in subtask order — phases use this so phase N gates on
 *   `phases/01..N/tests/` cumulatively. Set `false` for an isolated scope
 *   that ignores prior subtasks (e.g. spike phases).
 *
 * When `testScope` is omitted (legacy / non-phased path), the loop uses the
 * feature's `tests/` directory verbatim — no behavior change.
 */
export interface RunSubtaskTestScope {
  include?: string[];
  cumulative?: boolean;
}

/**
 * Serialized subtask definition (manifest / {@link RunArtifact#config}).
 * Runtime fields (`id`, `status`, timestamps) are assigned by the orchestrator.
 */
export interface RunSubtaskInput {
  title?: string;
  content: string;
  gateScript?: string;
  agentScript?: string;
  gateRetries?: number;
  /**
   * Per-subtask reviewer toggle (per-phase-config phase 7.4 / Level 1.5).
   * Sourced from the active phase's `agent.reviewer` field. Layered on top
   * of the run-level `defaults.agent.reviewer` / `--no-reviewer` baseline
   * via `<saifctlPath>/subtask-env.sh`, which `coder-start.sh` sources per
   * inner round. There is only one reviewer in the system (Argus, run via
   * `reviewer.sh` inside the coder container after the gate passes — see
   * design §6.6). The TS type stays `reviewerEnabled` everywhere
   * downstream; the YAML/JSON config-key name is `agent.reviewer`.
   */
  reviewerEnabled?: boolean;
  /**
   * Per-subtask agent env vars (per-phase-config phase 7.4 / Level 1.5).
   * Sourced from `agent.env`. Key/value pairs are written to
   * `<saifctlPath>/subtask-env.sh` and re-exported by `coder-start.sh` on
   * every inner round. Reserved factory keys (`SAIFCTL_*`, `LLM_*`, etc.)
   * are filtered out at write time — same rules as run-level `--agent-env`.
   */
  agentEnv?: Record<string, string>;
  /**
   * Per-subtask additive secret-env names (per-phase-config phase 7.4).
   * Sourced from `agent.secrets`. The orchestrator reads `process.env[name]`
   * at write time and includes the values in the subtask env file. Names
   * not present in `process.env` are silently skipped (matches the run-level
   * `agentSecretKeys` behavior). Names additive on top of the run-level set.
   */
  agentSecretKeys?: string[];
  /**
   * Per-subtask LLM override delta (per-phase-config phase 7.4).
   * Sourced from `agent.model` + `agent.base-url`. At runtime the
   * orchestrator merges this on top of the run-level `LlmOverrides`,
   * resolves the coder agent's `LlmConfig`, and re-emits the
   * `LLM_*` env vars in `subtask-env.sh`. When unset, the run-level
   * values from `docker run -e` apply unchanged.
   */
  llmOverrides?: LlmOverrides;
  /**
   * Per-subtask agent-profile option deltas. Sourced from
   * `agent.options.<name>` on the phase / feature config (compile-time
   * merge per the agentConfigSchema `options` doc). At runtime the
   * orchestrator emits each entry as `SAIFCTL_AGENT_OPT_<ID>_<NAME>=value`
   * into `subtask-env.sh`, sourced fresh on every inner round.
   *
   * Layering: this is the FULLY MERGED per-subtask map (project-level +
   * feature-level + phase-level), not just the phase delta. Emitting the
   * resolved value on every subtask matches the "always-set" rule the
   * other per-subtask fields follow, so a later phase that doesn't set
   * `agent.options.<name>` inherits the run-wide baseline (the merge
   * resolver carries it forward) rather than getting an `unset` from
   * the shadow-keys sweep.
   *
   * Option names not declared by the resolved {@link agentProfileId} are
   * silently ignored by the agent — same forwards-compat behavior as
   * the root `defaults.agentOptions.<id>` block in `saifctl/config.ts`.
   */
  agentProfileOptions?: Record<string, string | number | boolean>;
  testScope?: RunSubtaskTestScope;
  /**
   * Phase id this subtask belongs to (Block 4). Set by the phase compiler on
   * every emitted subtask (impl + each critic round). Used by the loop to
   * capture `phase.baseRef` when an impl subtask starts and to look it up
   * again when subsequent critic subtasks for that phase render.
   *
   * Omitted on legacy / non-phased subtasks; loop has no per-phase tracking
   * for those.
   */
  phaseId?: string;
  /**
   * Present on critic subtasks (Block 4). Tells the loop to mustache-render
   * `content` against the closed variable set + the runtime baseRef before
   * invoking the agent. Absence ⇒ `content` is used verbatim (impl subtasks,
   * legacy non-phased path).
   */
  criticPrompt?: RunSubtaskCriticPrompt;
  // -------------------------------------------------------------------------
  // per-phase-config v1 (phase 7.3 — Level-4 runner overrides) — see
  // saifctl/features/per-phase-config/design.md §3.5 / §6.5(b).
  // -------------------------------------------------------------------------
  /** Per-subtask test profile id; resolved at runtime via `resolveTestProfile`. */
  testProfile?: string;
  /** Per-subtask Docker image tag for the test runner. */
  testImage?: string;
  /** Per-subtask test script content (compile-time-resolved file body). */
  testScript?: string;
  /** Per-subtask staging script content (compile-time-resolved file body). */
  stageScript?: string;
  /** Per-subtask resolve-ambiguity strategy. */
  resolveAmbiguity?: 'off' | 'prompt' | 'ai';
  /** Per-subtask test-retries count. */
  testRetries?: number;
  /**
   * Persisted form of `tests.none: true` (per-phase-config design §6.5(b)).
   * When `true`, the runner is bypassed for this subtask UNLESS its
   * `testScope.include` is non-empty (last-phase rule: feature/project tests
   * still gate even when the phase declares `tests.none`).
   *
   * The "last phase" branch of §6.5(b) is enforced entirely by the compiler:
   * the last phase's `testScope.include` is populated with feature- and
   * project-level test paths, so the runtime gate (`scope.sources.length === 0`)
   * naturally distinguishes "non-last + noRunner" (empty include ⇒ skip)
   * from "last + noRunner" (non-empty include ⇒ runner runs against those).
   * No separate `lastPhaseInRun` flag is needed.
   */
  noRunner?: boolean;
  // -------------------------------------------------------------------------
  // per-phase-config v1 (phase 7.5 — Level-2 manifest threading).
  // See saifctl/features/per-phase-config/design.md §3.2 / §7.5.
  //
  // Level-2 fields are bound at coder-container creation: changing them
  // mid-run requires tearing down the coder container and recreating it
  // against the existing sandbox dir with refreshed scripts. That
  // orchestration (planned `phase-transition.ts:runLevel2Transition`)
  // is **deferred to follow-up phase 7.5e**; the loop currently does
  // NOT read these per-subtask fields nor honor
  // {@link requiresLevel2RestartFromPrev} — instead, the validator
  // (`checkLevel2TransitionGate`) errors when adjacent phases would
  // require a transition, telling the user to split into separate
  // `feat run` invocations. Phase 7.5 lands the manifest / round-trip
  // / detection plumbing so 7.5e only has to wire the teardown-and-
  // recreate side.
  //
  // Always-set on every subtask (idempotency rule from per-phase-config 7.2
  // / 7.3 / 7.4): the compiler emits the resolved value (per-phase
  // override OR run-level baseline) on every subtask, so 7.5e's per-
  // attempt opts derivation can read these values without falling back
  // through the prior phase's leftover state.
  // -------------------------------------------------------------------------
  /** Per-subtask agent profile id (`agent.profile`); fully resolved at compile (override OR run-level fallback). */
  agentProfileId?: string;
  /** Per-subtask agent-install script content (`agent.install` resolved + read OR run-level fallback). */
  agentInstallScript?: string;
  /** Per-subtask startup-script content (`container.startup` resolved + read OR run-level fallback). */
  startupScript?: string;
  /** Per-subtask Cedar-policy content (`container.cedar` resolved + read OR run-level fallback). */
  cedarScript?: string;
  /** Per-subtask `container.no-leash` toggle (override OR run-level fallback). */
  dangerousNoLeash?: boolean;
  /**
   * Set by the compiler when the active subtask's resolved Level-2 config
   * differs from the immediately-prior subtask's resolved Level-2 config.
   *
   * **Currently advisory only.** The runtime side (loop teardown +
   * recreate against the existing sandbox dir) is deferred to phase
   * 7.5e; until 7.5e lands the validator
   * (`checkLevel2TransitionGate`) errors out when this flag would
   * fire, so it never reaches the loop in practice. Persisted on the
   * manifest so 7.5e can wire the loop-side check without a new
   * round-trip. See §7.5.
   *
   * Always `false` (or absent) on the first subtask of a run — there's
   * no prior subtask to compare against.
   */
  requiresLevel2RestartFromPrev?: boolean;
  // -------------------------------------------------------------------------
  // per-phase-config v1 (phase 7.5b — Level-3 manifest threading).
  //
  // Level-3 fields are bound at coder-container creation AND require an
  // image pull / engine swap / compose-stack swap on top of the Level-2
  // restart. The runtime side is deferred to phase 7.5e; this phase
  // (7.5b, level-3-mirror) just lands the manifest plumbing so the
  // runtime can read the values without a re-derivation step.
  //
  // Like the Level-2 fields above, these are emitted on every subtask
  // (always-set rule from per-phase-config 7.2 / 7.3 / 7.4 / 7.5).
  // -------------------------------------------------------------------------
  /** Per-subtask container image (`container.image`); fully resolved at compile (override OR run-level fallback). */
  containerImage?: string;
  /** Per-subtask sandbox profile id (`container.sandbox-profile`); fully resolved at compile. */
  containerSandboxProfileId?: string;
  /** Per-subtask coding-engine kind (`container.engine`); fully resolved at compile. */
  containerEngine?: 'docker' | 'helm' | 'local';
  /** Per-subtask docker-compose path (`container.compose-file`); workspace-relative, fully resolved at compile. */
  containerComposeFile?: string;
  /**
   * Set by the compiler when the active subtask's resolved Level-3 config
   * differs from the immediately-prior subtask's resolved Level-3 config.
   *
   * **Currently advisory only.** Same shape as
   * {@link requiresLevel2RestartFromPrev}; the validator
   * (`checkLevel3TransitionGate`) errors out before the loop sees it.
   * Persisted so phase 7.5e can branch on the cost class
   * (Level-2 = script refresh; Level-3 = image pull / stack swap).
   *
   * Always `false` (or absent) on the first subtask of a run.
   */
  requiresLevel3RestartFromPrev?: boolean;
  // -------------------------------------------------------------------------
  // per-phase-config v1 (phase 7.6 — per-phase max-attempts).
  // See saifctl/features/per-phase-config/design.md §7.6.
  //
  // The phase-level analogue of the run-level `maxRuns` (`--max-runs` /
  // `maxAttemptsPerSubtask`): caps how many outer attempts the loop will
  // spend on a given phase before failing the run. Distinct from
  // `maxRuns` because a phase can span multiple subtasks (impl + critic
  // rounds) and the user wants an orthogonal upper bound on phase-level
  // attempts.
  // -------------------------------------------------------------------------
  /**
   * Per-subtask cap on phase-level outer attempts (`limits.max-attempts`).
   * Resolved from phase config at compile time and emitted on every
   * subtask of the phase (impl + critics). The loop tracks attempts in
   * {@link RunArtifact#phaseAttemptCount}, keyed by {@link phaseId}, and
   * fail-fasts when the count exceeds this cap.
   */
  limits?: {
    /** Maximum outer attempts on this phase before the run aborts. */
    maxAttempts?: number;
  };
}

/**
 * One unit of work within a run. Single-task runs use a one-element {@link RunArtifact#subtasks} list.
 */
export interface RunSubtask {
  id: string;
  title?: string;
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  gateScript?: string;
  agentScript?: string;
  gateRetries?: number;
  reviewerEnabled?: boolean;
  agentEnv?: Record<string, string>;
  /** See {@link RunSubtaskInput#agentSecretKeys}. Round-tripped through the manifest. */
  agentSecretKeys?: string[];
  /** See {@link RunSubtaskInput#llmOverrides}. Round-tripped through the manifest. */
  llmOverrides?: LlmOverrides;
  /** See {@link RunSubtaskInput#agentProfileOptions}. Round-tripped through the manifest. */
  agentProfileOptions?: Record<string, string | number | boolean>;
  testScope?: RunSubtaskTestScope;
  /** See {@link RunSubtaskInput#phaseId}. Round-tripped through the manifest. */
  phaseId?: string;
  /** See {@link RunSubtaskInput#criticPrompt}. Round-tripped through the manifest. */
  criticPrompt?: RunSubtaskCriticPrompt;
  /** See {@link RunSubtaskInput#testProfile}. Round-tripped through the manifest. */
  testProfile?: string;
  /** See {@link RunSubtaskInput#testImage}. Round-tripped through the manifest. */
  testImage?: string;
  /** See {@link RunSubtaskInput#testScript}. Round-tripped through the manifest. */
  testScript?: string;
  /** See {@link RunSubtaskInput#stageScript}. Round-tripped through the manifest. */
  stageScript?: string;
  /** See {@link RunSubtaskInput#resolveAmbiguity}. Round-tripped through the manifest. */
  resolveAmbiguity?: 'off' | 'prompt' | 'ai';
  /** See {@link RunSubtaskInput#testRetries}. Round-tripped through the manifest. */
  testRetries?: number;
  /** See {@link RunSubtaskInput#noRunner}. Round-tripped through the manifest. */
  noRunner?: boolean;
  /** See {@link RunSubtaskInput#agentProfileId}. Round-tripped through the manifest. */
  agentProfileId?: string;
  /** See {@link RunSubtaskInput#agentInstallScript}. Round-tripped through the manifest. */
  agentInstallScript?: string;
  /** See {@link RunSubtaskInput#startupScript}. Round-tripped through the manifest. */
  startupScript?: string;
  /** See {@link RunSubtaskInput#cedarScript}. Round-tripped through the manifest. */
  cedarScript?: string;
  /** See {@link RunSubtaskInput#dangerousNoLeash}. Round-tripped through the manifest. */
  dangerousNoLeash?: boolean;
  /** See {@link RunSubtaskInput#requiresLevel2RestartFromPrev}. Round-tripped through the manifest. */
  requiresLevel2RestartFromPrev?: boolean;
  /** See {@link RunSubtaskInput#containerImage}. Round-tripped through the manifest. */
  containerImage?: string;
  /** See {@link RunSubtaskInput#containerSandboxProfileId}. Round-tripped through the manifest. */
  containerSandboxProfileId?: string;
  /** See {@link RunSubtaskInput#containerEngine}. Round-tripped through the manifest. */
  containerEngine?: 'docker' | 'helm' | 'local';
  /** See {@link RunSubtaskInput#containerComposeFile}. Round-tripped through the manifest. */
  containerComposeFile?: string;
  /** See {@link RunSubtaskInput#requiresLevel3RestartFromPrev}. Round-tripped through the manifest. */
  requiresLevel3RestartFromPrev?: boolean;
  /** See {@link RunSubtaskInput#limits}. Round-tripped through the manifest. */
  limits?: {
    maxAttempts?: number;
  };
  /**
   * Block 4 runtime state — git rev at the start of this phase's impl
   * subtask. Captured by the loop the first time the impl subtask is
   * activated; reused by every critic subtask in the same phase to render
   * `{{phase.baseRef}}` in their mustache templates.
   *
   * Only meaningful on impl subtasks (those with `phaseId` and no
   * `criticPrompt`). Critic subtasks read this from their phase's impl row.
   *
   * Runtime-only — intentionally NOT mirrored on `RunSubtaskInput` (per the
   * Block 4 plan clarification "Do NOT persist into `RunSubtaskInput` (it's
   * runtime state, not config)"). Resume preserves this via
   * `seedSubtasks` (which clones `artifact.subtasks` directly without going
   * through the manifest-stripping `runSubtasksToInputs` round-trip).
   */
  phaseBaseRef?: string;
}

/** Summary of one orchestrator outer attempt — its position in the run, the test phase outcome, and rolled-up inner-round/commit metrics. */
export interface OuterAttemptSummary {
  /** 1-based outer attempt index (monotonic across the whole run). */
  attempt: number;
  /** 0-based index into {@link RunArtifact#subtasks}. */
  subtaskIndex: number;
  /** 1-based attempt counter within the current subtask. */
  subtaskAttempt: number;
  phase: OuterAttemptPhase;
  innerRoundCount: number;
  innerRounds: InnerRoundSummary[];
  commitCount: number;
  patchBytes: number;
  errorFeedback?: string;
  startedAt: string;
  completedAt: string;
}

/** Options for {@link RunStorage.saveRun} optimistic locking updates. */
export interface RunSaveOptions {
  /**
   * When set, the save succeeds only if the stored artifact's
   * {@link RunArtifact#artifactRevision} (missing treated as 0) equals this value.
   * Used by `run inspect` and other concurrent writers to avoid clobbering.
   */
  ifRevisionEquals?: number;
}

/** Thrown by {@link RunStorage.saveRun} when `ifRevisionEquals` does not match the stored {@link RunArtifact#artifactRevision}. */
export class StaleArtifactError extends Error {
  override readonly name = 'StaleArtifactError';

  constructor(opts: {
    readonly runId: string;
    readonly expectedRevision: number;
    readonly actualRevision: number;
  }) {
    const { runId, expectedRevision, actualRevision } = opts;
    super(
      `Run "${runId}" artifact revision mismatch: expected ${expectedRevision}, stored ${actualRevision}. ` +
        `Another process may have updated this run; reload the artifact and retry.`,
    );
  }
}

/**
 * Thrown by {@link RunStorage.setStatusRunning} when the Run is already active in a conflicting way
 * (e.g. `running`, `inspecting`, or mid-transition).
 */
export class RunAlreadyRunningError extends Error {
  override readonly name = 'RunAlreadyRunningError';

  constructor(readonly runId: string) {
    super(
      `Run "${runId}" is already active or mid-transition (cannot enter "running"). ` +
        `If the process died without saving a final status, manually edit or delete the run artifact ` +
        `(e.g. .saifctl/runs/${runId}.json).`,
    );
  }
}

/**
 * Live infra keyed by environment. Stores infra-specific details.
 * Written incrementally as resources are created; cleared after teardown.
 */
export interface RunLiveInfra {
  coding: LiveInfra | null;
  staging: LiveInfra | null;
}

/** Persisted state of a single run — base commit + replayed commits, subtask list, lifecycle status, user rules, serialized config, and live-infra/inspect-session pointers. */
export interface RunArtifact {
  runId: string;

  /**
   * Monotonic counter (only goes up) incremented on every successful {@link RunStorage.saveRun}.
   * Assigned by storage (callers should omit when building a new artifact).
   */
  artifactRevision?: number;

  /** Git commit SHA when the run started */
  baseCommitSha: string;
  /** Uncommitted changes at run start (git diff + git diff --cached) */
  basePatchDiff?: string;
  /** Commits from coding rounds / inspect sessions (apply in order; each diff is one replayed commit; one outer round may add several). */
  runCommits: RunCommit[];

  /**
   * How many leading entries of {@link runCommits} were already applied to the host working tree
   * via sandbox extract (`host-apply` / `host-apply-filtered`). Used to resume without double-applying
   * after incremental per-subtask extract.
   */
  sandboxHostAppliedCommitCount: number;

  /** Ordered subtasks for this run (single-task runs have exactly one entry). */
  subtasks: RunSubtask[];
  /** Index into {@link subtasks} for the active subtask (0-based). */
  currentSubtaskIndex: number;

  /** Sanitized test failure summary for Ralph Wiggum feedback */
  lastFeedback?: string;

  /** User rules appended via `saifctl run rules create` and merged into the agent task. */
  rules: RunRule[];

  /** Serialized CLI config used for this run */
  config: SerializedLoopOpts;

  status: RunStatus;
  startedAt: string;
  updatedAt: string;

  /**
   * Per-attempt summaries (inner gate rounds + test outcome), appended after each outer attempt.
   * Saved incrementally while status is `"running"` when run storage is enabled.
   */
  roundSummaries?: OuterAttemptSummary[];

  /**
   * Set by `run pause` / `run stop` while the orchestrator polls storage. Last write wins.
   * Cleared when the run is no longer `"running"` or the signal has been applied.
   */
  controlSignal: RunControlSignal | null;

  /**
   * Host sandbox directory preserved across `run pause` / `run resume` (same bind mounts).
   * Set when entering `"paused"`; cleared when resuming via the `run start` path or on completion.
   */
  pausedSandboxBasePath: string | null;

  /**
   * Resources currently provisioned for this run (containers, networks, compose project, images).
   * Populated in later phases; `null` until tracking is wired or after full teardown.
   */
  liveInfra: RunLiveInfra | null;

  /**
   * Set only while {@link RunArtifact#status} is `"inspecting"`; otherwise `null`.
   */
  inspectSession: RunInspectSession | null;

  /**
   * Per-phase-config phase 7.5d: set to a {@link RunTransitionInProgress}
   * snapshot while the orchestrator is tearing down the previous coder
   * container and recreating it against the existing sandbox dir for a
   * Level-2 or Level-3 transition (the loop integration that consumes this
   * field ships in phase 7.5e). Written BEFORE teardown (so a crash
   * mid-transition is recoverable) and cleared once the new container is
   * ready.
   *
   * Crash recovery: when `run resume` reloads an artifact with
   * `transitionInProgress: true`, the loop re-runs the controlled restart
   * idempotently rather than activating the new subtask against a stale
   * container that no longer exists. Folded into {@link RunStatus}
   * `"running"` rather than introducing a `"transitioning"` status (per
   * design.md §7.5: "lean: the latter, fewer status-machine edge cases").
   *
   * `null` when no transition is in flight.
   */
  transitionInProgress: RunTransitionInProgress | null;

  /**
   * per-phase-config phase 7.6: per-phase outer-attempt counter, keyed by
   * `RunSubtask.phaseId`. Incremented once per outer attempt that runs
   * against a phaseId-bearing subtask. The loop compares the count
   * against the active subtask's `limits.maxAttempts` and fail-fasts the
   * run when the budget is exhausted.
   *
   * **Monotone within a single Run identity:** the counter never
   * decrements. When a phase's gate eventually passes and the loop
   * advances, the next phase's counter starts at 0 (its key was never
   * set). Re-entry via `run start <id>` after a crash continues from
   * the last persisted count — the budget cannot be reset by retrying.
   *
   * Empty `{}` for runs with no phaseId-bearing subtasks (legacy /
   * non-phased path).
   */
  phaseAttemptCount: Record<string, number>;
}

/**
 * Snapshot of an in-flight Level-2/3 controlled restart, persisted on
 * {@link RunArtifact#transitionInProgress} between teardown-start and
 * recreate-complete. The cursor + cost class let `run resume` re-run the
 * exact transition that crashed (idempotent — resume against the same
 * subtask cursor and the same fresh-container target).
 */
export interface RunTransitionInProgress {
  /**
   * Subtask index the run was advancing to when the transition started.
   * Equals {@link RunArtifact#currentSubtaskIndex} once the transition
   * commits — written here BEFORE the cursor advances so a crash can
   * reconstruct intent.
   */
  toSubtaskIndex: number;
  /**
   * Cost class of the restart, as detected by
   * `phase-transition.ts:detectLevel2Transition` /
   * `detectLevel3Transition`. `'level-2-3'` when both detectors fired
   * for the same boundary.
   */
  costClass: 'level-2' | 'level-3' | 'level-2-3';
  /**
   * Field paths that triggered the transition (kebab-case YAML form,
   * e.g. `agent.profile`, `container.image`). Stable order matches the
   * detector helpers. Used in log / error messages on a crashed-transition
   * resume so the user sees the same field set on retry.
   */
  fields: readonly string[];
  /** ISO timestamp when teardown started (i.e. when this artifact field was set). */
  startedAt: string;
}
