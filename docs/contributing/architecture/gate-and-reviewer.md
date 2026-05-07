# The gauntlet — gate, reviewer, holdout

Three independent checks every agent diff clears:

- **Gate** — `gate.sh` runs in the coder container. Lint / typecheck / static / public unit tests. Deterministic, seconds-fast, no LLM.
- **Reviewer (Argus)** — semantic check inside the coder container after the gate passes. Catches "agent solved a different problem", hallucinated APIs, missed cases.
- **Holdout tests** — outer-loop tests in the test-runner container against staging. Hidden from the agent (physically stripped from the sandbox copy).

There's no flag that lets the agent skip any layer.

> **Related:** [`orchestrator.md`](./orchestrator.md) · [`test-runner.md`](./test-runner.md) · [`spec-pipeline.md`](./spec-pipeline.md) · [`sandbox-isolation.md`](./sandbox-isolation.md).

## Why three checks, not one

Each layer catches a class the others can't:

| Layer                | Catches                                                                                                       | Cost                                      | Where it runs                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| **Gate**             | Lint, format, typecheck, static analysis, public unit-test failures                                           | Seconds, deterministic, no LLM            | Coder container, inner loop, every agent round                            |
| **Reviewer** (Argus) | Code that compiles but drifts from the spec — hallucinated APIs, missed cases, agent solved the wrong problem | ~30-60s, one LLM call                     | Coder container, after gate passes                                        |
| **Holdout tests**    | Code that satisfies visible specs but breaks an unseen test                                                   | Minutes, full staging + test-runner stack | Outer loop, separate containers; see [`test-runner.md`](./test-runner.md) |

All three must pass. The agent **can't bypass any layer**: holdout tests are physically stripped from the sandbox copy ([`sandbox-isolation.md`](./sandbox-isolation.md#the-copy-not-mount-workspace)), the Reviewer is a separate LLM call with no agent input, and the gate is deterministic.

## Outer ↔ inner loop split

Outer loop = [`runIterativeLoop`](../../../src/orchestrator/loop.ts#L703) on the host process. Inner loop = [`coder-start.sh`](../../../src/orchestrator/scripts/coder-start.sh) inside the container.

```
outer loop (host process)                   inner loop (coder container)
─────────────────────                       ──────────────────────────────
provision sandbox
spawn coder container                ────►  coder-start.sh
                                              │
                                              ├── run startup.sh once (deps)
                                              ├── run agent-install.sh once (agent CLI)
                                              │
                                              └── inner round (loop until gate-retries):
                                                    ├── agent.sh   (write code; reads $SAIFCTL_TASK_PATH)
                                                    ├── gate.sh    (lint/typecheck/static)
                                                    │     │ fail → append failure to task; retry
                                                    │     └ pass
                                                    └── reviewer.sh (Argus, optional)
                                                          │ fail → append findings to task; retry
                                                          └ pass → exit 0; commit ready

extract incremental patch                  ◄── (host reads sandbox repo HEAD)
mutability-check
run test runner (separate containers)        ──── reaches staging via HTTP sidecar
  │ fail → run vague-specs-checker;
  │        feed back; restart inner loop
  └ pass: subtask done
```

Gate + reviewer failures bounce _inside the container_ with the failure text appended to the next round's task prompt — agent doesn't burn an outer test-runner pass on something a linter would catch. Outer loop sees only the final committed result.

`SAIFCTL_GATE_RETRIES` (default `5`) caps the inner loop. Past that, the inner loop returns failure and the outer loop counts it as one consumed `--max-runs` attempt.

`--engine local` runs the inner loop on the host filesystem (no Leash, no container; same script logic).

## Layer 1: the gate

`gate.sh` — orchestrator writes it to `<sandbox>/gate.sh`, bind-mounts read-only at `/saifctl/gate.sh` in the coder container. CLI's `parseGateScript()` reads the profile default when `--gate-script` is unset.

Per-profile defaults at [`src/sandbox-profiles/<profile>/gate.sh`](../../../src/sandbox-profiles/):

| Profile               | Default gate                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| `node-*`              | No-op placeholder + warning. Node tests are too project-specific to default. |
| `go` / `go-*`         | `go vet` + `go test`                                                         |
| `rust` / `rust-*`     | `cargo check` + `cargo clippy` + `cargo test`                                |
| `python` / `python-*` | `python -m pytest` + `ruff check` (variants per profile)                     |

Override: `--gate-script <path>`. Script runs in the coder container with `/workspace` as cwd.

Gate-script contract:

- Read: anywhere under `/workspace/`.
- Write: `/tmp/` (scratch). Cedar forbids `/workspace/saifctl/` writes.
- Exit `0` = pass; non-zero = fail.
- Last 2-4 KB of stdout+stderr appended to the next round's task prompt (truncated for LLM context).

Why the gate runs **inside** the container:

- **Direct workspace access** — `/workspace/` is the agent's live files. No HTTP round-trip, no bind-mount race.
- **No host-side trust surface** — gate runs under the same Cedar policy as the agent. Malicious `gate.sh` can't escape.
- **Fast feedback** — iterate on lint failures without burning an outer-loop attempt.

The outer-loop test runner is the **authoritative** check; the gate is the **cheap early exit** before expensive bits run.

## Layer 2: the semantic reviewer (Argus)

Catches what the gate can't:

- Agent solved a _different_ problem than the spec (semantic drift).
- Agent hallucinated an API call (no test exercises it; gate misses it).
- Logic error in the diff that public tests happen not to cover.
- Implementation correct but missing a spec'd case.

Runs after gate passes (no LLM spend on uncompilable code), before the agent's round is complete.

### Why Argus and not something else

| Option                                                | Pro                                                                                                                                                                                                                                                                               | Con                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tree-sitter custom scripts                            | Flexible                                                                                                                                                                                                                                                                          | LLM tool-calling for AST queries hallucinates + crashes searches.                                   |
| SCIP / LSIF indexers                                  | Mathematically precise                                                                                                                                                                                                                                                            | Heavyweight; requires the codebase to compile, which the agent's broken-mid-round code often can't. |
| LiteLLM proxy + custom orchestration                  | Provider abstraction                                                                                                                                                                                                                                                              | Over-engineered now that most providers ship OpenAI-compatible endpoints.                           |
| **Argus** ([`vendor/argus/`](../../../vendor/argus/)) | ~25MB static Rust binary; tree-sitter AST chunking across 10+ languages without compilation; local CPU-only embedding model for semantic search; native OpenAI/Anthropic/Gemini + OpenAI-compat baseURL override; two-step prompt chain (`self_reflection`) drops false positives | —                                                                                                   |

Argus wins: zero-infra (no Node/Python/proxy), AST chunking on broken code, self-reflection pattern (the #1 reason most automated AI reviewers fail in CI).

### How saifctl wires Argus

- **Binary download** — [`src/orchestrator/sidecars/reviewer/argus.ts`](../../../src/orchestrator/sidecars/reviewer/argus.ts) auto-downloads pinned `ARGUS_VERSION` (`0.5.7` at line 33) from [safe-ai-factory/argus releases](https://github.com/safe-ai-factory/argus/releases) at tag `argus-core-v${ARGUS_VERSION}`. Cached under `/tmp/saifctl/bin/`.
- **Mount** — `/usr/local/bin/argus:ro` in the coder container.
- **Per-round invocation** — [`src/orchestrator/scripts/reviewer.sh`](../../../src/orchestrator/scripts/reviewer.sh) runs `argus map` (build AST graph) then `argus review --diff <round-diff>`. Output piped through the same gate-failure mechanism (appended to next-round task prompt).
- **Enable/disable** — `SAIFCTL_REVIEWER_ENABLED` in inner-loop env. Default `true` ([`src/constants.ts:133`](../../../src/constants.ts#L133)). Disable per-run via `--no-reviewer`.

### Reviewer model config

Reviewer can use a different LLM from the coding agent — stronger model (cost is per-round, not per-token-of-code) or cheaper one with bigger context (read the full diff in one pass). Configured via `REVIEWER_LLM_*` env vars or `--reviewer-model`. See [`src/llm-config.ts`](../../../src/llm-config.ts).

### Why the reviewer lives in the agent's container

The Reviewer reads agent-written bytes (the diff) — the deliberate exception to "agent output never reaches saifctl AI agents" ([`security-threats.md` "Prompt-injection isolation"](./security-threats.md#additional-hardening-mechanisms)). The threat model holds because **bypassing the Reviewer doesn't pass the holdout tests**: a prompt-injection attack on the Reviewer's prompt buys one of three independent gates.

### Argus binary download — failure modes

| Scenario                  | Behaviour                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Network unreachable       | Run fails fast. `--no-reviewer` to skip when offline.                                    |
| Mismatched arch           | Resolves `linux-{x86_64,aarch64}-musl`; throws if no matching asset for `ARGUS_VERSION`. |
| Cache hit on stale binary | `argus.ts:61` parses cached filename + re-downloads if `ARGUS_VERSION` bumped.           |
| Pre-flight check          | `saifctl doctor` HEAD-probes the release endpoint and warns on unreachability.           |

## Layer 3: holdout tests

Holdout tests live at `<feature>/tests/hidden/` on the host. **Never staged into the sandbox copy** — orchestrator recursively removes every `hidden/` dir under `saifctl/features/` before mount ([`src/orchestrator/sandbox.ts`](../../../src/orchestrator/sandbox.ts)). Run in the test-runner container against staging via the HTTP sidecar.

The anti-reward-hacking primitive: even if the agent rewrote public tests (Cedar + patch filter prevent this), even if it duped the Reviewer (one of three gates), holdout tests run on a clean checkout in a container the agent never touched.

Contract (full execution detail in [`test-runner.md`](./test-runner.md)):

- Holdout test = vitest/pytest/go-test/etc. file under `<feature>/tests/hidden/`.
- Uses the same sidecar transport helpers as public tests (`execSidecar`, `httpRequest`, `baseUrl`) — see [`test-runner.md`](./test-runner.md#helpers-contract).
- Passes/fails on observable staging behaviour (HTTP responses, CLI exit codes, JSON). No internal state inspection.
- On failure: orchestrator either retries (sanitized hint or Vague Specs Checker output as feedback) or surfaces a spec-ambiguity prompt — see [`spec-pipeline.md`](./spec-pipeline.md#vague-specs-checker).

## Why the order matters

Inner-loop ordering (gate → reviewer) is **cost-driven**: gate is seconds-fast and deterministic; sending broken code to an LLM reviewer wastes money. Reviewer adds value only on code that compiles.

Outer-loop ordering (inner gates → holdout) is **correctness-driven**: inner gates catch obvious failures cheaply (no point provisioning a multi-container test env for code that fails `tsc`); holdouts are the ground truth.

A pass on one layer doesn't carry over. Holdout failure restarts the inner loop with the test failure as feedback — sanitized per [`security-threats.md` #1](./security-threats.md#1-host-command-injection-via-unsanitized-stderr-feedback). Earlier inner-round successes don't earn immunity from the outer test runner.

## Phased features

For phased features, the gauntlet runs **per phase**:

- Each phase has its own implementer subtask. Gate + reviewer + holdout fire on each phase's inner loop.
- The cumulative test scope makes regression-to-earlier-work fail the active phase: the test runner sees `<project-tests>/**` + `<feature>/tests/**` + `<each earlier phase>/tests/**` + `<this phase>/tests/**`. If phase 3's diff breaks a phase 1 test, phase 3's gate fails.
- **Critics are a fourth layer** ([`spec-pipeline.md`](./spec-pipeline.md)) that runs _per phase_ after the gate clears. Each critic discovers issues then a separate fix subtask resolves them. Critics are agent-driven adversarial reviews; they don't replace the Reviewer's per-round semantic check, they add another adversarial pass over the cumulative phase work.

The Reviewer always diffs from the run's initial **base state** commit to current HEAD; it is _not_ phase-scoped today. Critics, in contrast, ARE per-phase — the prompt is parameterised with `{{phase.baseRef}}` (captured at the start of each phase's implementer subtask), and critics inspect commits via `git log {{phase.baseRef}}..HEAD`.

## Inner-round-stats

The inner loop emits a JSONL line per round to `stats.jsonl` in the sandbox so the outer orchestrator can attach structured history to each outer attempt — gate pass/fail, reviewer pass/fail, truncated failure snippet. See [`docs/contributing/inner-round-stats.md`](../inner-round-stats.md) for the schema and how the outer loop consumes it (rolled into `OuterAttemptSummary`, persisted to run storage).

## See also

- [`orchestrator.md`](./orchestrator.md) — outer convergence loop, `runIterativeLoop`, mutability gate, pause/resume.
- [`test-runner.md`](./test-runner.md) — sidecar protocol, JUnit XML contract, public/hidden test split.
- [`spec-pipeline.md`](./spec-pipeline.md) — Vague Specs Checker (post-holdout-failure path), critics (per-phase adversarial review), `feat design` subcommands.
- [`sandbox-isolation.md`](./sandbox-isolation.md) — why holdout tests are physically absent from the sandbox copy.
- [`security-threats.md`](./security-threats.md) — sanitized feedback (#1), prompt-injection isolation (additional mechanisms).
- [`installation-scripts.md`](./installation-scripts.md) — `gate.sh` lifecycle: how the orchestrator delivers it into the sandbox.
- [`../inner-round-stats.md`](../inner-round-stats.md) — the `stats.jsonl` schema.
- [`docspec/products/saifctl/concepts/gate-reviewer-holdout.md`](../../../docspec/products/saifctl/concepts/gate-reviewer-holdout.md) — user-facing concept (the same three checks framed for evaluators).
