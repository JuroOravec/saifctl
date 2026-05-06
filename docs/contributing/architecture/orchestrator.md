# Orchestrator

How `saifctl feat run` (and its siblings) drive an agent through the convergence loop. This is the central state-machine doc; the *what each gate checks* details live in [`gate-and-reviewer.md`](./gate-and-reviewer.md).

> The word **"phases"** means two different things in saifctl. Both senses appear here; pay attention to context:
> - **Orchestrator modes** — five top-level entry points (`fail2pass`, `start`, `fromArtifact`, `test`, `inspect`). One per CLI mode.
> - **Feature phases** — user-defined `phases/<id>/` subdirs in a phased feature. These compile to **subtasks** that the orchestrator's convergence loop dispatches one at a time.

## Top-level modes — `src/orchestrator/modes.ts`

[`src/orchestrator/modes.ts`](../../../src/orchestrator/modes.ts) hosts the five orchestrator entry points. Each is the root of a state machine; each ends in either `success`, `failed`, `paused`, or `stopped` ([`OrchestratorOutcomeStatus`](../../../src/orchestrator/loop.ts#L432)).

| Mode | Triggered by | What it does |
|---|---|---|
| **`fail2pass`** | `saifctl feat design-fail2pass` | Sanity check: confirm at least one of the feature's tests fails on the *current* codebase before the agent runs. Cheap pre-flight that catches "tests already pass, so the spec is already satisfied" mistakes. |
| **`start`** | `saifctl feat run`, `saifctl sandbox` | Create a fresh sandbox + run the iterative agent loop until convergence or `maxRuns`. The hot path. |
| **`fromArtifact`** | `saifctl run start <runId>`, `saifctl run resume <runId>` | Reconstruct sandbox state from a saved Run, then dispatch into `start`'s same loop with seeded `initialErrorFeedback`. |
| **`test`** | `saifctl run test <runId>` | Re-test a Run's stored patch *without* running the coding-agent loop. Useful for "the holdout tests changed, does the old fix still pass?". |
| **`inspect`** | `saifctl run inspect <runId>` | Provision an idle coder container reproducing the Run's workspace state. Changes the user makes in-container are saved back to the Run. |

The mode dispatch happens at the CLI layer ([`src/cli/commands/feat.ts`](../../../src/cli/commands/feat.ts), [`run.ts`](../../../src/cli/commands/run.ts)); `modes.ts` exports each mode as an `async function` the CLI calls.

## The convergence loop — `runIterativeLoop`

[`src/orchestrator/loop.ts:703`](../../../src/orchestrator/loop.ts#L703) is *the* function. Both `start` and `fromArtifact` end up here. Pseudocode:

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

A `RunSubtaskInput` is the dispatch unit. It's a `{ content: string }` (plus optional metadata). The orchestrator processes one at a time; the iterative loop above runs once per subtask.

[`src/orchestrator/resolve-subtasks.ts`](../../../src/orchestrator/resolve-subtasks.ts) picks the subtask source via three paths:

1. **Explicit manifest** — `--subtasks <path>` to a JSON file. Each row becomes a subtask. Used by tests and advanced consumers.
2. **Non-phased feature** — synthesized from the feature's `specification.md` + `plan.md`. One subtask per feature ([`buildSubtasksFromSpec`](../../../src/orchestrator/resolve-subtasks.ts#L137)).
3. **Phased feature** — compiled from the feature's `phases/` directory by [`compilePhasesToSubtasks`](../../../src/specs/phases/compile.ts) (in `src/specs/phases/compile.ts`).

For phased features (path 3), each phase contributes:
- **1 implementer subtask** — runs the agent against the phase's `spec.md`, gated by the cumulative test scope (project-level + feature-level + earlier phases' tests + this phase's tests).
- **2 subtasks per critic per phase** — discover (writes findings to `.saifctl/critic-findings/<phase>--<critic>--r<n>.md`) + fix (consumes findings, rewrites implementation). Critics declared in `feature.yml`.

Phase numbering uses zero-padded width (`01..NN`) so lex order = run order. Phase-and-critic orchestration logic lives entirely in the compile step; the iterative loop just sees a flat subtask list.

## Phased-feature compilation — `feat phases compile / list / validate`

[`src/cli/commands/feat-phases.ts`](../../../src/cli/commands/feat-phases.ts) exposes three subcommands so users can inspect the compile output without starting a run:

- **`feat phases list <feature>`** — list discovered phases + critics.
- **`feat phases validate <feature>`** — schema validation, file-existence checks, mutability resolution; print errors and warnings, do not write anything. Exit 1 on errors. (Same checks `feat run` does at start, but standalone — useful in CI / pre-commit.)
- **`feat phases compile <feature>`** — write the deterministic `RunSubtaskInput[]` the loop *would* see, to `.saifctl/features/<feat>/phases.compiled.json`. Diff-friendly + reviewable; lets the user see what gets dispatched without invoking an agent.

All three rely on `validatePhasedFeature` for the load + cross-check so error reporting is consistent across the CLI and the `feat run` pre-flight.

## Mutability gate

Test files are **immutable** by default — the agent cannot edit them mid-run. After every round, the orchestrator inspects the per-round diff via [`src/orchestrator/mutability-check.ts`](../../../src/orchestrator/mutability-check.ts) and rolls back the round if any immutable file was touched. The violation is fed back as error feedback so the agent learns; the round doesn't count as a `maxRuns` consumption (it's lost work, not lost budget).

`--strict` / `--no-strict` flips the project-wide default. The two layers of mutability:

- **Phase-/feature-level test files** under `<feature>/tests/` and `<phases>/<id>/tests/` — immutable when `--strict` (default); editable when `--no-strict`.
- **`saifctl/tests/`** — the project-wide test set — **always immutable**, regardless of `--strict`.

Per-feature override available via `feature.yml`'s `tests.mutable` field. Per-test override via individual file annotations (see [`mutability-check.ts`](../../../src/orchestrator/mutability-check.ts)).

## Pause / Stop / Resume / Start — the run-lifecycle entry points

The orchestrator exposes lifecycle hooks that interact with run storage:

| CLI | Mode | What changes |
|---|---|---|
| `saifctl run pause <id>` | `runPause` ([`modes.ts:1191`](../../../src/orchestrator/modes.ts#L1191)) | Sample at next subtask boundary; preserve sandbox + Docker network for resume; stored status → `paused`. |
| `saifctl run resume <id>` | `fromArtifact` (with paused→running) | Reuse cached sandbox + network if still present; if cache is gone, fall back to `start` semantics from the saved git state. |
| `saifctl run stop <id>` | `runStop` ([`modes.ts:1222`](../../../src/orchestrator/modes.ts#L1222)) | Full teardown (sandbox + Docker resources via `LiveInfra` — see [`infra.md`](../infra.md)); stored status → `failed`. Use before `run rm` when the run is `running` or `paused`. |
| `saifctl run start <id>` | `fromArtifact` (failed/interrupted → running) | Reconstruct workspace from git + saved commits; same agent loop. **Not** for `paused` runs. |
| `saifctl run inspect <id>` | `runInspect` ([`modes.ts:1407`](../../../src/orchestrator/modes.ts#L1407)) | Provision idle coder container; user manually edits; saifctl applies edits back to the run when the container exits. See [`docspec/products/saifctl/how-tos/inspect-and-start.md`](../../../docspec/products/saifctl/how-tos/inspect-and-start.md) for the user-facing flow. |
| `saifctl run export <id>` | `runExport` ([`modes.ts:1809`](../../../src/orchestrator/modes.ts#L1809)) | Export workspace tree + logs + diff to a directory or tarball. |

**Granularity note for phased features**: pause/resume sample at *subtask boundaries* (per phase / per critic round). Pausing mid-phase preserves state at the most recent checkpoint, NOT mid-round. Resume re-enters at the same subtask cursor; phases that already cleared their gate stay committed in the sandbox.

## The outer loop ↔ inner loop split

Each agent round has two layers:

- **Outer loop** (this doc): `runIterativeLoop` runs in the saifctl host process. It owns sandbox provisioning, patch extraction, mutability check, test-runner orchestration, run-storage updates, and the maxRuns budget.
- **Inner loop** (see [`gate-and-reviewer.md`](./gate-and-reviewer.md)): runs *inside the coder container*. The agent makes changes, the gate script (lint/typecheck/static) runs, the optional reviewer (Argus) checks the diff against the spec. Failures here loop back to the agent within the *same* outer round — the inner loop can't progress to the next outer round until the gate clears. The outer loop only sees the final committed result of all inner-round attempts.

The split is intentional: deterministic gate/reviewer checks happen close to the agent (low latency, low IPC overhead) while the expensive bits (test runner, holdout) happen in separate containers under host-side coordination. See [`comp-e: orchestrator state machine`](#) for the original framing of this split.

## Vague Specs Checker invocation

When the test runner reports a failure (outer loop), saifctl optionally runs the [Vague Specs Checker](./spec-pipeline.md#vague-specs-checker) before re-dispatching the agent. The hook is at [`src/orchestrator/loop.ts:2079`](../../../src/orchestrator/loop.ts#L2079) (`runVagueSpecsCheckerForFailure`); behaviour is controlled by `--resolve-ambiguity off|prompt|ai`. Default `off`. See [`spec-pipeline.md`](./spec-pipeline.md) for the full mechanism — this section just notes the orchestrator integration point.

## Patch handling: between agent rounds

After each round, the orchestrator extracts the agent's commits as an incremental patch ([`src/orchestrator/loop.ts:111`](../../../src/orchestrator/loop.ts#L111) `buildPatchExcludeRules`, plus `extractIncrementalRoundPatch()`). Two security-relevant filters apply:

1. **`patchExclude`** — by default excludes `.git/hooks/**`, `saifctl/tests/**` (project-immutable), and other paths that should never reach the host. Stripped before the diff is recorded.
2. **`assertRunCommitsSafeForHost`** — final guard before host-side `git apply`; throws hard on any `.git/hooks/` path that slipped through.

Both filters are documented in detail under [`security-threats.md`](./security-threats.md) findings #2.

## Hatchet integration

When `HATCHET_CLIENT_TOKEN` is set *and* `SAIFCTL_EXPERIMENTAL_HATCHET=1`, the orchestrator dispatches via Hatchet instead of running in-process. The state machine itself doesn't change — Hatchet wraps `runIterativeLoop` as a workflow ([`src/hatchet/workflows/feat-run.workflow.ts`](../../../src/hatchet/workflows/feat-run.workflow.ts)) and gives you durability + the dashboard. **Status in v0.1**: experimental, gated. See [`docs/contributing/hatchet.md`](../hatchet.md) and Decision **D-04** in the release-readiness specification for the full status.

For local mode (no Hatchet token), the workflow runs in-process via [`src/hatchet/utils/local.ts`](../../../src/hatchet/utils/local.ts) — the in-process mock client. This keeps a single code path for both local and remote Hatchet, so DAG ordering and `parentOutput` / `runChild` / `onFailure` behaviour stay tested even without a real Hatchet server.

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
