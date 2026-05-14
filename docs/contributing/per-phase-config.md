# Per-phase configuration — schema, threading, and the controlled restart

Phased features can override most run-level settings on a per-phase basis. This doc explains the schema groups, how each setting reaches the runtime, and the lifecycle-graded cost-of-change model that decides whether a phase boundary requires a coder-container restart.

User-facing surface lives in `concept per-phase-config` (lifecycle levels) and the `configure-a-phase` / `pure-output-phase` how-tos. This doc is the future-maintainer reference.

## Why

[saifdocs](https://github.com/safe-ai-factory/saifdocs) shipped `v0.3.0` with a per-phase `tests/gate.sh` that the test runner couldn't see — the runner still spun up against an empty `tests/` dir and the agent had no per-phase override surface. Two adjacent problems:

1. The schema of "how a phase customises itself" was ad-hoc; users worked around it by setting a stub `tests/gate.sh` and shipping an empty `tests/` to silence pre-flight warnings.
2. External feature emitters (saifdocs, future codegen tools) need a stable way to declare "this phase has no own tests" without ramming a sentinel through the test runner.

Per-phase-config v1 ships a structured schema for the override surface, lifecycle-graded so authors can reason about cost: changing `gate.script` between phases is free; changing `container.image` triggers a docker pull and full restart. The thesis is that external emitters will keep showing up — saifdocs is the first, codegen tools will be the next — and they need to reach for declarative fields, not escape hatches.

## Lifecycle levels

Five graded levels for "what runs when, and what costs what":

| Level | Cost                                                               | What changes                                                                                       | Example fields                                                                                |
| ----- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1     | per-round file rewrite; container alive                           | bash script bytes the running container reads each loop iteration                                  | `gate.script`, `gate.retries`, `agent.script`                                                 |
| 1.5   | small env file rewrite + small `coder-start.sh` source            | `<saifctlPath>/subtask-env.sh`; coder-start.sh sources it on every inner round                     | `agent.env`, `agent.secrets`, `agent.model`, `agent.base-url`, `agent.reviewer`               |
| 2     | coder-container teardown + recreate; sandbox dir kept             | image is the same; container is rebuilt against refreshed scripts                                  | `agent.profile`, `agent.install`, `container.startup`, `container.cedar`, `container.no-leash`|
| 3     | docker pull / engine swap on top of Level 2                       | image, sandbox-profile, engine kind (docker/helm/local), or compose file changes                   | `container.image`, `container.sandbox-profile`, `container.engine`, `container.compose-file`  |
| 4     | recreated per attempt; routing only                               | test runner picks up the active subtask's settings each call                                       | `runner.test-profile`, `runner.test-image`, `runner.test-script`, `runner.stage-script`, `runner.resolve-ambiguity`, `runner.test-retries` |
| 4 (bypass) | runner not started for the phase                              | routing flag — `tests.none: true` short-circuits the runner; feature/project tests still gate at the run's last phase | `tests.none`                                                                          |
| loop  | orchestrator state                                                | per-phase outer-attempt counter — distinct from run-level `--max-runs`                             | `limits.max-attempts`                                                                         |

Cross-reference: `src/orchestrator/scripts/coder-start.sh` for what runs when inside the container; `src/specs/phases/runtime-support.ts` for the source-of-truth table mapping every field to its level + the implementation-phase that shipped its runtime.

## Schema groups

Authoritative source: [`src/specs/phases/schema.ts`](../../src/specs/phases/schema.ts).

The five group blocks (`gate`, `agent`, `container`, `runner`, `limits`) plus `tests` work in both files; `feature.yml` additionally takes a `phases:` block (with `defaults`, `phases.<id>`, `order`) on top.

```yaml
# Group blocks — usable at feature.yml top-level OR phases/<id>/phase.yml.
gate:
  script: ./stricter-gate.sh    # path-resolved per §4.3
  retries: 5                    # default 10
agent:
  profile: claude               # bundled profile id
  install: ./custom-install.sh  # path-resolved
  env:
    MY_VAR: value
  secrets: [OPENAI_API_KEY]     # additive over run-level
  model: 'openai/gpt-4o-mini'   # one bare value, or 'agent=value,agent=value'
  base-url: 'https://api.openai.com/v1'
  reviewer: false               # toggles SAIFCTL_REVIEWER_ENABLED for this phase
container:
  startup: ./bootstrap.sh
  cedar: ./policy.cedar
  no-leash: false
  image: my-coder:v2
  sandbox-profile: python-uv
  engine: docker                # 'docker' | 'helm' | 'local'
  compose-file: ./docker-compose.gpu.yml
runner:
  test-profile: python-pytest
  test-image: my-runner:latest
  test-script: ./run-tests.sh
  stage-script: ./stage.sh
  resolve-ambiguity: prompt     # 'off' | 'prompt' | 'ai'
  test-retries: 3
limits:
  max-attempts: 2               # per-phase outer-attempt cap
tests:
  none: true                    # bypass runner for this phase (still gates feature/project tests at the last phase)
  mutable: false                # existing pre-v1 field
```

YAML uses kebab-case throughout (`max-attempts`, `compose-file`, `no-leash`); TypeScript types stay camelCase (`maxAttempts`, `composeFile`, `noLeash`). Conversion happens in [`load.ts:resolvePhaseConfig`](../../src/specs/phases/load.ts).

### Resolution order

Most-specific declaration wins. The chain is split across two code paths — feature-scope resolution in [`load.ts:resolvePhaseConfig`](../../src/specs/phases/load.ts) (steps 1–4), and run-level baseline resolution in [`options.ts`](../../src/orchestrator/options.ts) which threads its results into compile via separate fields (step 5):

1. `phases/<id>/phase.yml` _(load.ts)_
2. `feature.yml.phases.phases.<id>` (inline single-phase override) _(load.ts)_
3. `feature.yml.phases.defaults` _(load.ts)_
4. `feature.yml` (top-level uniform settings) _(load.ts)_
5. `saifctl/config.*` (run-level baseline; resolved by `options.ts` pickers and threaded into compile via fields like `gateScript` / `agentScript` / `runLevelLevel2Baseline` — NOT part of the `resolvePhaseConfig` merge chain) _(options.ts)_
6. Built-in defaults

The user-observable behaviour is the merged 1–6 chain; the code split is a layering concern (feature-scope merging happens inside `compile`, run-level baseline plumbs in alongside it).

Object values resolve sub-key by sub-key: `tests: { mutable: false }` at one layer composes with `tests: { none: true }` at another. List-valued fields (`critics`, `agent.secrets`, `tests.immutable-files`) replace at the most-specific declaring layer — no key-level merge — so authors don't need to worry about silent additive accumulation.

## The per-subtask env file (Level 1.5)

`<saifctlPath>/subtask-env.sh` is rewritten on every subtask transition by [`per-subtask-env.ts:computeSubtaskEnv`](../../src/orchestrator/per-subtask-env.ts). `coder-start.sh` sources it at the top of every inner round, so changes to `agent.env` / `agent.model` / `agent.secrets` / `agent.reviewer` between phases land without a container restart.

The shadow-keys sweep is the load-bearing part. Without it, an `agent.env: { TEMP: 'a' }` on phase A would persist as `export TEMP='a'` in the long-lived shell into phase B, even when phase B's resolved env has no `TEMP`. Phase B's file emits `unset TEMP` for any key a sibling phase added — phase boundaries are idempotent regardless of source order.

`agent.secrets` is allow-list-gated against the run-level baseline + an explicit phase declaration, evaluated against `process.env` at write time. A phase declaring `agent.secrets: [HOME]` is a security-boundary violation; the resolver drops the entry rather than copy `/Users/...` into the bind-mounted env file. See `per-subtask-env.test.ts` for the regression pin.

## The phase-boundary controlled restart (Level 2 / 3)

Level-2 / 3 fields are bound at coder-container creation. Changing them mid-run requires tearing down the container and recreating it against the existing sandbox dir. The orchestration is encapsulated in [`phase-transition.ts`](../../src/orchestrator/phase-transition.ts) and called from `loop.ts:onSubtaskComplete` at the phase boundary. The full machinery:

1. Compiler ([`compile.ts`](../../src/specs/phases/compile.ts)) emits `requiresLevel2RestartFromPrev` / `requiresLevel3RestartFromPrev` on subtasks where the resolved Level-2/3 set differs from the immediately-prior subtask. The diff compares fully-resolved values (override OR run-level fallback), not override-deltas — a phase declaring `agent.profile: claude` against a run-level baseline of `claude` correctly produces no diff.
2. Loop branches in `onSubtaskComplete` (sandbox-complete advance + tests-passed advance) check the next subtask's flags. When set, `tryStartTransition` builds a `RunTransitionInProgress` snapshot (cost class, fields, target subtask index, ISO timestamp) and persists it on `RunArtifact#transitionInProgress` BEFORE returning `kind: 'transition'`. Artifact-write-before-teardown invariant — a crash anywhere from this persist through to the post-teardown refresh leaves `transitionInProgress` set on disk for `run resume` to act on.
3. The driver returns `outcome: 'transitioned'` from `runCodingPhase` after the engine `finally` tears down the previous container. The outer iteration loop in `runIterativeLoop` calls `completeControlledRestart` to refresh bind-mounted scripts to the new active subtask's content (sourcing per-attempt opts from the manifest, not closure-captured run-level baselines), clears `transitionInProgressLive`, and iterates so the next pass boots a fresh container.
4. Sandbox dir is preserved end-to-end. Only the coder + Leash containers are rebuilt. The sandbox bind-mount, the run commits, the staging stack, the host-applied commit count — all survive the boundary.

### Why a flag, not a status

The `transitionInProgress` field on `RunArtifact` is folded into status `running` rather than introducing a `transitioning` status. Two reasons:

- One fewer status edge-case to enforce (control signals, resume eligibility, list filters).
- Resume idempotency is already guaranteed by `completeControlledRestart` (re-running the script refresh against an existing sandbox dir is a no-op when the scripts already match).

When `run resume` reloads an artifact with `transitionInProgress` set, the loop re-runs the controlled restart from the snapshot rather than activating the new subtask against a stale container.

### Per-attempt opts derivation

The closure-capture trap from F-D: a coder container booted with the run-level `agentProfileId` would silently ignore a subtask manifest that overrides to a different profile. [`loop.ts`](../../src/orchestrator/loop.ts) derives every Level-2/3 opt from the active subtask manifest first, falling back to the run-level baseline only when the field is unset:

```typescript
const activeAgentProfileId = (activePerAttempt?.agentProfileId as SupportedAgentProfileId | undefined) ?? agentProfileId;
const activeDangerousNoLeash = activePerAttempt?.dangerousNoLeash ?? dangerousNoLeash;
const activeCoderImage = activePerAttempt?.containerImage ?? coderImage;
const activeCodingEnvironment = deriveActivePerAttemptCodingEnvironment({
  activeSubtask: activePerAttempt,
  baseline: codingEnvironment,
});
```

The compiler always emits the fully resolved value on every subtask (override OR run-level fallback) so this derivation can be a simple `??` chain rather than re-walking the merge order at runtime.

## Per-phase max-attempts (loop state)

[`phase-budget.ts`](../../src/orchestrator/phase-budget.ts) owns the helpers; `RunArtifact#phaseAttemptCount` (a `Record<phaseId, number>`) owns the persisted state. The counter is monotone within a Run identity:

- Each outer attempt against a phaseId-bearing subtask ticks the counter once. Legacy / non-phased subtasks don't tick.
- The check fires BEFORE the per-subtask `subtaskAttemptNumber > maxRuns` gate in each retry-or-fail branch — phase-specific failure mode wins when both fire.
- `run resume` seeds the counter from the persisted `phaseAttemptCount`. Resume cannot reset the budget — that would trivialise the cap.
- Distinct from `--max-runs` (run-level outer-attempt cap on the whole pipeline). A feature with `maxRuns: 5` and a phase with `limits.max-attempts: 2` aborts after 2 phase attempts, well before `maxRuns` is exhausted.

## Validation surface

[`src/specs/phases/validate.ts`](../../src/specs/phases/validate.ts) raises every per-phase-config message; pre-flight in `feat run` runs the same validators as standalone `feat phases validate`. The table is intended to be exhaustive — adding a new validator means adding a row here.

| Check    | Severity | Trigger                                                                                  | Source                                                                                     |
| -------- | -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 6.9.1    | error    | `container.cedar` set AND `container.no-leash: true`                                     | `validate.ts:checkLockstepRules` (the cedar/no-leash branch)                               |
| 6.9.2    | warn     | `tests.none: true` AND any other `tests.*` field                                         | `validate.ts:checkLockstepRules`                                                           |
| 6.9.3    | warn     | `tests.none: true` AND any `runner.*` field                                              | `validate.ts:checkLockstepRules`                                                           |
| 6.9.4    | warn     | `agent.profile` set AND `agent.script` / `agent.install` explicitly set                  | `validate.ts:checkLockstepRules`                                                           |
| 6.9.5    | warn     | `container.sandbox-profile` set AND `container.image` explicitly set                     | `validate.ts:checkLockstepRules`                                                           |
| 6.9.6    | info     | Adjacent phases A → B differ in any Level-2 setting                                      | `validate.ts:checkAdjacentPhaseTransitions`                                                |
| 6.9.7    | info     | Adjacent phases A → B differ in any Level-3 setting                                      | `validate.ts:checkAdjacentPhaseTransitions`                                                |
| 6.9.8    | error    | Any v1 field is set whose runtime support hasn't shipped yet                             | `validate.ts:checkRuntimeSupport` (gated by `runtime-support.ts:RUNTIME_SUPPORTED_FIELDS`) |
| 6.9.10   | warn     | `container.compose-file` set AND `container.engine` is `helm` / `local` (compose ignored) | `validate.ts:checkLockstepRules` (the compose/engine branch)                               |
| 7.6 N4   | info     | Phase declares `limits.max-attempts < minSubtasks` (zero retry headroom)                 | `validate.ts:checkPhaseBudgetVsSubtaskCount`                                               |
| —        | error    | Per-phase script path field (`gate.script` / `agent.script` / `agent.install` / `container.startup` / `container.cedar`) points at a missing file relative to the phase dir | `validate.ts:checkPhaseScriptPaths`                                                        |

Numbering note: the `6.9.X` IDs come from the design doc's §6.9 lockstep section; §6.9.9 was reserved during drafting and never used. `7.6 N4` is the review-N4 finding from the per-phase-max-attempts implementation; it doesn't have a §6.9 number because its origin is a separate review pass. The script-paths check has no design-doc ID — it's an existence guard added alongside the Level-1 / Level-2 script threading.

The §6.9.8 gate was the parse-but-no-op trap from earlier drafts — a field declared in the schema but with no runtime read site would silently no-op. Each implementation phase added its fields to `RUNTIME_SUPPORTED_FIELDS`; with phase 7.6 the set is now empty (every v1 field is wired). The check stays in place so future v1.x additions can use the same gate while their runtime threading lands.

## Future work

- **Container reuse / pool.** Today every Level-2/3 phase boundary tears down the coder container and rebuilds. A pool of warm containers keyed by Level-2/3 fingerprint would amortise repeated boundaries — relevant for runs that ping-pong between two phases (e.g. agent-then-critic where the critic uses a different model and the agent uses a different image). See §3.3 of the planning doc.
- **Per-phase `--model` etc. via the same Level-1.5 mechanism.** The per-subtask env file already plumbs `LLM_MODEL` / `LLM_BASE_URL`; the CLI flag surface (`--phase-<id>-model`) would just need a small bridge to write the per-subtask manifest.
- **External feature emitters.** Saifdocs is the first; codegen tools are the next. The schema is intentionally additive — a future emitter can declare `tests.none: true` plus a custom `gate.script` and ship without a saifctl release. See `concept per-phase-config` for the user-facing model emitters target.
