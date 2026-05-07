# Orchestrator

The state machine `saifctl feat run` runs through. Lives in [`src/orchestrator/`](../../../src/orchestrator/), entry at [`modes.ts`](../../../src/orchestrator/modes.ts), convergence loop at [`loop.ts:703`](../../../src/orchestrator/loop.ts#L703).

The _what each gate checks_ details live in [`gate-and-reviewer.md`](./gate-and-reviewer.md); this page is "what runs in what order, where".

> **"Phases" is overloaded.** Two senses, both appear below:
>
> - **Orchestrator modes** — `fail2pass | start | fromArtifact | test | inspect`. CLI dispatch.
> - **Feature phases** — `phases/<id>/` subdirs in a phased feature. Compile to **subtasks** that the convergence loop dispatches one at a time.

## Top-level modes — `src/orchestrator/modes.ts`

[`src/orchestrator/modes.ts`](../../../src/orchestrator/modes.ts) hosts the five orchestrator entry points. Each is the root of a state machine; each ends in either `success`, `failed`, `paused`, or `stopped` ([`OrchestratorOutcomeStatus`](../../../src/orchestrator/loop.ts#L432)).

| Mode               | Triggered by                                              | What it does                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`fail2pass`**    | `saifctl feat design-fail2pass`                           | Sanity check: confirm at least one of the feature's tests fails on the _current_ codebase before the agent runs. Cheap pre-flight that catches "tests already pass, so the spec is already satisfied" mistakes. |
| **`start`**        | `saifctl feat run`, `saifctl sandbox`                     | Create a fresh sandbox + run the iterative agent loop until convergence or `maxRuns`. The hot path.                                                                                                             |
| **`fromArtifact`** | `saifctl run start <runId>`, `saifctl run resume <runId>` | Reconstruct sandbox state from a saved Run, then dispatch into `start`'s same loop with seeded `initialErrorFeedback`.                                                                                          |
| **`test`**         | `saifctl run test <runId>`                                | Re-test a Run's stored patch _without_ running the coding-agent loop. Useful for "the holdout tests changed, does the old fix still pass?".                                                                     |
| **`inspect`**      | `saifctl run inspect <runId>`                             | Provision an idle coder container reproducing the Run's workspace state. Changes the user makes in-container are saved back to the Run.                                                                         |

The mode dispatch happens at the CLI layer ([`src/cli/commands/feat.ts`](../../../src/cli/commands/feat.ts), [`run.ts`](../../../src/cli/commands/run.ts)); `modes.ts` exports each mode as an `async function` the CLI calls.

## The convergence loop — `runIterativeLoop`

[`src/orchestrator/loop.ts:703`](../../../src/orchestrator/loop.ts#L703) is _the_ function. Both `start` and `fromArtifact` end up here. Pseudocode:

```ts
for each subtask in loopRunSubtasks:
  attempt = 0
  while attempt < maxRuns:
    attempt++
    runAgent(subtask)                     // ./phases/run-agent-phase.ts
    extractIncrementalRoundPatch()        // -> per-round commit on sandbox repo
    if (mutability gate violated)         // ./mutability-check.ts
      rollBackRound(); continue           // doesn't count as success
    runStagingTestVerification()          // ./phases/run-test-phase.ts (gate + reviewer + holdout)
    if (testsPass)
      break                               // subtask done, advance to next
    else
      errorFeedback = sanitize(testResult)
      // (may also append vague-specs-checker hint — see ./spec-pipeline.md)
  if (attempt >= maxRuns)
    return { status: 'failed', cause: 'max-attempts' }

return { status: 'success' }
```

**`maxRuns` is per-subtask, not per-run.** For a non-phased feature with one subtask, `--max-runs 8` means up to 8 attempts. For a phased feature with 5 subtasks (1 implementer + 2 critic-rounds × 2 critics), `--max-runs 8` means up to 40 total attempts. This matters when budgeting cost.

## Subtasks: where they come from

A `RunSubtaskInput` is the dispatch unit (`{ content: string }` + optional metadata). The iterative loop runs once per subtask.

Three resolution paths in [`resolve-subtasks.ts`](../../../src/orchestrator/resolve-subtasks.ts):

| Source                     | When                        | Output                                                                                                                                      |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--subtasks <path>` (JSON) | Tests, advanced consumers   | One subtask per row                                                                                                                         |
| Non-phased feature         | Default `feat run`          | One subtask synthesized from `specification.md` + `plan.md` ([`buildSubtasksFromSpec`](../../../src/orchestrator/resolve-subtasks.ts#L137)) |
| Phased feature             | Feature has a `phases/` dir | N subtasks compiled by [`compilePhasesToSubtasks`](../../../src/specs/phases/compile.ts)                                                    |

Phased features contribute per phase:

- **1 implementer subtask** — agent runs against the phase's `spec.md`. Cumulative test scope: project + feature + earlier phases' + this phase's.
- **2 subtasks per critic per phase** — discover (writes `.saifctl/critic-findings/<phase>--<critic>--r<n>.md`) + fix. Critics declared in `feature.yml`.

Phase numbering is zero-padded (`01..NN`) so lex order = run order. The iterative loop sees a flat subtask list; phase/critic orchestration lives entirely in compile.

## Phased-feature compilation — `feat phases compile / list / validate`

[`src/cli/commands/feat-phases.ts`](../../../src/cli/commands/feat-phases.ts) — three subcommands for inspecting the compile output without starting a run:

- `feat phases list <feature>` — list discovered phases + critics.
- `feat phases validate <feature>` — schema + file-existence + mutability checks, no writes. Same as `feat run`'s pre-flight; useful in CI / pre-commit. Exit 1 on errors.
- `feat phases compile <feature>` — write the deterministic `RunSubtaskInput[]` to `.saifctl/features/<feat>/phases.compiled.json`. Diff-friendly preview of what `feat run` would dispatch.

All three call `validatePhasedFeature` for consistent error reporting with the live pre-flight.

## Mutability gate

Test files are **immutable** by default. After every round, [`mutability-check.ts`](../../../src/orchestrator/mutability-check.ts) inspects the per-round diff and rolls back if any immutable file was touched. The violation is fed back as error feedback; the round **doesn't consume a `maxRuns` slot** (lost work, not lost budget).

| Layer                                         | Mutability                                                        |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `<feature>/tests/` and `<phases>/<id>/tests/` | Immutable with `--strict` (default); editable with `--no-strict`. |
| `saifctl/tests/` (project-wide)               | **Always** immutable.                                             |

Per-feature override: `feature.yml` `tests.mutable: true`. Per-test override: file annotations.

## Pause / Stop / Resume / Start — run lifecycle

| CLI                        | Mode                                                                       | What changes                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saifctl run pause <id>`   | `runPause` ([`modes.ts:1191`](../../../src/orchestrator/modes.ts#L1191))   | Sample at next subtask boundary; preserve sandbox + Docker network for resume; stored status → `paused`.                                                                                                                                                                     |
| `saifctl run resume <id>`  | `fromArtifact` (with paused→running)                                       | Reuse cached sandbox + network if still present; if cache is gone, fall back to `start` semantics from the saved git state.                                                                                                                                                  |
| `saifctl run stop <id>`    | `runStop` ([`modes.ts:1222`](../../../src/orchestrator/modes.ts#L1222))    | Full teardown (sandbox + Docker resources via `LiveInfra` — see [`infra.md`](../infra.md)); stored status → `failed`. Use before `run rm` when the run is `running` or `paused`.                                                                                             |
| `saifctl run start <id>`   | `fromArtifact` (failed/interrupted → running)                              | Reconstruct workspace from git + saved commits; same agent loop. **Not** for `paused` runs.                                                                                                                                                                                  |
| `saifctl run inspect <id>` | `runInspect` ([`modes.ts:1407`](../../../src/orchestrator/modes.ts#L1407)) | Provision idle coder container; user manually edits; saifctl applies edits back to the run when the container exits. See [`docspec/products/saifctl/how-tos/inspect-and-start.md`](../../../docspec/products/saifctl/how-tos/inspect-and-start.md) for the user-facing flow. |
| `saifctl run export <id>`  | `runExport` ([`modes.ts:1809`](../../../src/orchestrator/modes.ts#L1809))  | Export workspace tree + logs + diff to a directory or tarball.                                                                                                                                                                                                               |

**Granularity note for phased features**: pause/resume sample at _subtask boundaries_ (per phase / per critic round). Pausing mid-phase preserves state at the most recent checkpoint, NOT mid-round. Resume re-enters at the same subtask cursor; phases that already cleared their gate stay committed in the sandbox.

## The outer loop ↔ inner loop split

| Loop                                                         | Where                | Owns                                                                                                                        |
| ------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Outer** (this doc)                                         | saifctl host process | Sandbox provisioning, patch extraction, mutability check, test-runner orchestration, run-storage updates, `maxRuns` budget. |
| **Inner** ([`gate-and-reviewer.md`](./gate-and-reviewer.md)) | coder container      | Agent's coding round; gate (`gate.sh`); optional reviewer (Argus). Failures loop back to the agent in the same outer round. |

The split puts deterministic gate/reviewer checks close to the agent (low latency) and pushes the expensive containerized test runner to the outer loop. Outer sees only the final committed result of all inner-round attempts.

## Vague Specs Checker invocation

On test-runner failure, saifctl optionally runs the [Vague Specs Checker](./spec-pipeline.md#vague-specs-checker) before re-dispatching. Hook: [`runVagueSpecsCheckerForFailure`](../../../src/orchestrator/loop.ts#L2079). Behaviour: `--resolve-ambiguity off | prompt | ai`. Default `off`. See [`spec-pipeline.md`](./spec-pipeline.md) for the full mechanism.

## Patch handling between agent rounds

[`extractIncrementalRoundPatch()`](../../../src/orchestrator/sandbox.ts#L1045) reads the per-round commits; [`buildPatchExcludeRules()`](../../../src/orchestrator/loop.ts#L111) configures two safety filters:

1. **`patchExclude`** strips `.git/hooks/**`, `saifctl/tests/**`, etc. before the diff is recorded.
2. **`assertRunCommitsSafeForHost`** is a final guard before host-side `git apply`; throws on any `.git/hooks/` path that slipped through both layers.

Detail in [`security-threats.md` finding #2](./security-threats.md#2-arbitrary-code-execution-via-malicious-patch-githooks-injection).

## Hatchet integration

`HATCHET_CLIENT_TOKEN` set + `SAIFCTL_EXPERIMENTAL_HATCHET=1` → orchestrator dispatches via Hatchet instead of in-process. The state machine doesn't change — Hatchet wraps `runIterativeLoop` as a workflow ([`src/hatchet/workflows/feat-run.workflow.ts`](../../../src/hatchet/workflows/feat-run.workflow.ts)) for durability + dashboard.

Local mode (no token): same workflow runs in-process via the mock client at [`src/hatchet/utils/local.ts`](../../../src/hatchet/utils/local.ts). Single code path for both; DAG ordering, `parentOutput`, `runChild`, `onFailure` stay tested without a real Hatchet server.

**v0.1 status**: experimental, gated. See [`docs/contributing/hatchet.md`](../hatchet.md) and Decision **release-readiness/D-04**.

## Why a custom orchestrator at all

The original design (preserved in `comp-e-orchestrator.md` ancestor) called out three reasons we don't use SWE-bench-style harnesses:

1. **Language agnosticism** — SWE-bench is hardcoded to Python (`pytest`, `tox`). Saifctl evaluates standard POSIX exit codes from arbitrary bash, so the same orchestrator drives TypeScript, Python, Go, Rust, etc.
2. **Mutual verification enforcement** — the orchestrator independently verifies the agent's work via the test runner; the agent never grades its own test. Existing harnesses can be tricked into accepting agent self-reports.
3. **Pipeline integration** — the orchestrator interfaces with `feat design`, the test runner, the reviewer, run storage, and the (optional) Hatchet workflow. None of this is generic.

These three constraints still hold. The "custom" cost is real (~3-4k LOC of orchestration code under `src/orchestrator/`), but each line earns its place against one of the three.

## See also

- [`gate-and-reviewer.md`](./gate-and-reviewer.md) — what the gauntlet actually checks.
- [`spec-pipeline.md`](./spec-pipeline.md) — `feat design`, vague-specs-checker, design-discovery + MCP.
- [`sandbox-isolation.md`](./sandbox-isolation.md) — the three-container architecture the orchestrator provisions.
- [`installation-scripts.md`](./installation-scripts.md) — startup + gate script lifecycles inside the coder container.
- [`../infra.md`](../infra.md) — `LiveInfra` resource tracker (deterministic teardown).
- [`../inner-round-stats.md`](../inner-round-stats.md) — `stats.jsonl` recording inner-loop outcomes for outer-loop visibility.
