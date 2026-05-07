# Spec pipeline — design, tests, ambiguity resolution

Two pipelines:

- **Design pipeline** (`feat design`) — turns a `proposal.md` into `specification.md` + `plan.md` + `tests.json` + generated test files. Runs LLM agents (Designer / Tests Planner / Tests Catalog) against the proposal + codebase. Output is what the convergence loop runs against.
- **Vague Specs Checker** — runs _after_ a holdout-test failure during `feat run`. Decides whether the failure is a genuine implementation bug or an ambiguous spec, and produces either a sanitized hint for the agent or a proposed spec addition.

Plus per-phase **critics** for phased features — adversarial review subtasks running between gate-pass and the next phase.

> **Related:** [`orchestrator.md`](./orchestrator.md) · [`gate-and-reviewer.md`](./gate-and-reviewer.md) · [`extension-points.md`](./extension-points.md) · [`docspec/products/saifctl/concepts/features.md`](../../../docspec/products/saifctl/concepts/features.md).

## Overview

Saifctl separates "designing a feature" from "implementing a feature". The design pipeline runs first; its output is a feature directory the convergence loop consumes:

```
proposal.md   ──┐
                │
                ▼
        ┌──────────────────┐
        │  feat design     │  ──►  specification.md
        │  (full pipeline) │       plan.md
        │                  │       tests.md
        │                  │       tests.json
        │                  │       (optionally) discovery.md
        └──────────────────┘
                │
                ▼
        ┌──────────────────┐
        │  feat run        │  ──►  inner+outer convergence loop
        │  (the gauntlet)  │       gate / reviewer / holdout
        └──────────────────┘
                │
                ▼
        ┌──────────────────┐
        │  Vague Specs     │  ◄───  fires only on holdout failure
        │  Checker         │        when --resolve-ambiguity is set
        │  (optional)      │
        └──────────────────┘
```

Design is agent-driven (Mastra workers running against codebase + proposal) but **uses different agents from the implementer**. Deliberate firewall — see [Why three distinct agents](#why-three-distinct-agents).

## The `feat design` subcommands

In [`src/cli/commands/feat.ts`](../../../src/cli/commands/feat.ts). `feat design` chains them; each is also runnable solo for iteration:

| Subcommand              | What it does                                                                                          | Reads                                                        | Writes                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `feat new <name>`       | Bootstrap a feature dir; scaffold `proposal.md`                                                       | template                                                     | `<feature>/proposal.md`                                                                     |
| `feat design-discovery` | (Optional) run an MCP/local-tool agent to gather external context                                     | `proposal.md`, configured `discoveryMcps` / `discoveryTools` | `discovery.md`                                                                              |
| `feat design-specs`     | Run the **Designer** profile (default: POC Explorer; alt: Shotgun) to produce specification + plan    | `proposal.md`, optionally `discovery.md`, codebase           | `specification.md`, `plan.md`, `poc-findings.md` (POC)                                      |
| `feat design-tests`     | Run the **Tests Planner** + **Tests Catalog** agents to produce the test catalog                      | `specification.md`, `plan.md`, codebase                      | `tests.md`, `tests.json` (+ generated test files under `tests/public/` and `tests/hidden/`) |
| `feat design-fail2pass` | Sanity check: confirm at least one feature test fails on the _current_ codebase before the agent runs | `tests.json`, current code                                   | exit `0`/`1`                                                                                |
| `feat design`           | All of the above in sequence (`discovery → specs → tests → fail2pass`)                                | proposal                                                     | full feature                                                                                |

Cost: ~$1 and 1–2 min on a Sonnet-tier model. Scales with input-spec + codebase size.

## Stage 1: design-discovery (optional)

Designers (Shotgun, POC Explorer) analyze the _internal_ codebase via tree-sitter graph + RAG. They can't reach **outside** the project boundary.

`feat design-discovery` is the bridge for external context — third-party API schemas, Jira tickets, Notion docs, internal microservice contracts, competitor UI scraping. Runs an LLM agent armed with user-supplied tools, reads `proposal.md`, writes `discovery.md`. `design-specs` picks it up automatically.

Tool resolution at [`src/design-discovery/tools.ts`](../../../src/design-discovery/tools.ts):

- **MCP servers** — `--discovery-mcps`. Spawn arbitrary MCP servers; agent gets every tool they expose. Web search, filesystem readers, scrapers.
- **Local JS/TS tools** — `--discovery-tools`. Point at a Mastra-compatible tool file. For project-specific scrapers ("fetch our API registry", "read the Jira ticket from `proposal.md`").

Output `discovery.md` is freeform markdown; no schema. Designer treats it as additional context alongside the proposal.

## Stage 2: design-specs (Designer profile)

[`feat design-specs`](../../../src/cli/commands/feat.ts#L396) dispatches to the configured designer profile.

| Profile                                                                                                | Strategy                                                                                                          | Trade-off                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **`poc`** (POC Explorer; default; [`src/designer-profiles/poc/`](../../../src/designer-profiles/poc/)) | Sandboxed coding agent builds a throwaway proof-of-concept first, _then_ derives the spec from what it discovered | Specs are grounded in code that compiles; surfaces edge cases. Slower; ~$1/run.                                             |
| **`shotgun`** ([`src/designer-profiles/shotgun/`](../../../src/designer-profiles/shotgun/))            | Static-trace-based: tree-sitter index + multi-agent (Researcher / Architect / Spec Writer) chain                  | Faster, no code execution. Specs are based on what the designer thinks the code does, not what it actually does at runtime. |

Pick via `--designer <id>` or `defaults.designer` in config. New profiles per [`extension-points.md`](./extension-points.md).

Output: `specification.md`, `plan.md`, plus `poc-findings.md` (POC only).

## Stage 3: design-tests (Tests Planner + Tests Catalog)

Two Mastra agents run back-to-back, designed around LLM context limits:

1. **Tests Planner** ([`src/design-tests/agents/tests-planner.ts`](../../../src/design-tests/agents/tests-planner.ts)) reads spec files → `tests.md` (plain-markdown list of what to test). Chain-of-thought scratchpad.
2. **Tests Catalog** ([`src/design-tests/agents/tests-catalog.ts`](../../../src/design-tests/agents/tests-catalog.ts)) reads `tests.md` → `tests.json` (strict schema, with `visibility: 'public' | 'hidden'` per case).

Both can be given a `queryCodebaseIndex` tool backed by an indexer profile to surface relevant code paths ([`design.ts:36-37`](../../../src/design-tests/design.ts#L36)).

`tests.json` schema source of truth: [`src/design-tests/schema.ts`](../../../src/design-tests/schema.ts). Per-test: `id`, `description`, `visibility`, `entrypoint`, optional preconditions. Per-feature: `containers` config (`containers.staging.baseUrl` for web projects).

Test runner reads `tests.json` to know what to run; the public/hidden split drives [hidden-test scrubbing in sandbox-isolation](./sandbox-isolation.md#the-copy-not-mount-workspace).

Why two passes (markdown → JSON):

- **LLM context limits** — markdown pass is exhaustive but compact; JSON pass adds structure without re-reading the spec.
- **Human review surface** — `tests.md` is plain-language for audit; `tests.json` is the machine-checkable form.

## Stage 4: design-fail2pass

Pre-flight: runs just-generated tests against the _current_ codebase (agent hasn't touched anything). Expected outcome:

- At least one feature test **fails** — the feature isn't built yet, good.
- Infra tests pass — sidecar reachable, helpers import, environment wires up.

Catches:

- **Tests already pass** — spec already satisfied; feature misnamed, or trivially complete.
- **Infra broken** — sidecar unreachable, helpers can't import, etc. Saves debug time during `feat run`.

[`hasFeatureSuccessfullyFailed`](../../../src/orchestrator/loop.ts) parses the JUnit XML to distinguish "feature legitimately fails" from "infra is broken".

## Vague Specs Checker — runtime ambiguity resolution

The implementation agent reads the same `specification.md` the test-design agents read — but **not** the hidden tests. When the spec is vague, the test designers and the implementer can both make defensible interpretations that disagree. The hidden test fails. The spec was the bug.

### Concrete example

> **Spec says**: "The `greet` command outputs a greeting."
>
> **Test Designer infers**: greeting must include the name passed as argument (e.g. `Hello, Alice`).
>
> **Implementation agent infers**: greeting can be generic (e.g. `Hello, world`).
>
> Hidden test: `expect(out).toContain('Alice')` → fails. The implementer's diff is _defensible_; the spec just didn't pin the behaviour.

### How the checker fires

When the test runner reports a failure, the orchestrator's [`runVagueSpecsCheckerForFailure`](../../../src/orchestrator/loop.ts#L2079) optionally invokes the Vague Specs Checker. Behaviour controlled by `--resolve-ambiguity off|prompt|ai`:

| Mode            | Behaviour                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `off` (default) | Failure feeds back to the agent as-is (sanitized stderr); next round runs unchanged. Original behaviour.                                       |
| `prompt`        | When the checker flags ambiguity, saifctl pauses the run and asks the user to confirm the proposed spec addition.                              |
| `ai`            | Saifctl auto-applies the proposed addition without human confirmation. Risky; appropriate for unattended runs only when you trust the checker. |

### What the checker sees and produces

The Mastra agent at [`src/orchestrator/agents/vague-specs-check.ts`](../../../src/orchestrator/agents/vague-specs-check.ts) reads the spec + failing test details. **Not the implementation patch.** Agent-controlled bytes reaching the checker would open a prompt-injection vector — the agent could rewrite its diff to bias verdicts toward "spec is ambiguous, here's how to relax it". Deliberate boundary, documented at [`vague-specs-check.ts:9-13`](../../../src/orchestrator/agents/vague-specs-check.ts#L9).

Output JSON ([`vague-specs-check.ts:71-76`](../../../src/orchestrator/agents/vague-specs-check.ts#L71)):

```ts
{
  isAmbiguous: boolean,
  reason: string,                  // 1-3 sentences
  proposedSpecAddition: string,    // ambiguous case: one or two sentences to add to spec
  sanitizedHintForAgent: string,   // genuine-failure case: behavioural hint, never quotes test code
}
```

Decision criteria, distilled from the prompt at [`vague-specs-check.ts:43-46`](../../../src/orchestrator/agents/vague-specs-check.ts#L43):

- Spec **explicitly or strongly implies** the expected behavior → genuine failure (isAmbiguous: false)
- Expected behavior is **nowhere in the spec, or requires interpretation a reasonable engineer could make differently** → ambiguous (isAmbiguous: true)
- Default lean: ambiguous.

### Sanitized hint contract

When the checker decides the failure is genuine (not ambiguous), `sanitizedHintForAgent` describes the failure in **behavioural** terms only — never quoting hidden test code.

| Hint shape           | Example                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| ✅ Behavioural       | `"The command exits with code 1 when no arguments are provided, but should exit with code 0"` |
| ❌ Test-code-quoting | `"the test checks if exit code equals 0"`                                                     |

This is the only path holdout-test failure information reaches the implementer. Sanitized so the agent learns _what_ is wrong without learning _what the hidden test does_ — protects the holdout-hidden invariant ([`gate-and-reviewer.md`](./gate-and-reviewer.md#layer-3-holdout-tests)).

### Spec-update mechanics

`--resolve-ambiguity ai|prompt` + `isAmbiguous: true` → saifctl appends `proposedSpecAddition` to `specification.md` with provenance:

```markdown
<!-- Added by Vague Specs Checker on 2026-05-06 (run-id: abc123): -->

The greeting MUST include the user's name when an argument is provided.
```

Then regenerates the test catalog ([Stage 3](#stage-3-design-tests-tests-planner--tests-catalog)) so the next round runs against updated tests. The provenance comment shows future readers why the spec grew.

## Critics — per-phase adversarial review

Phased features can declare critics in `feature.yml`:

```yaml
phases:
  defaults:
    critics:
      - paranoid
      - security
critics:
  paranoid: critics/paranoid.md
  security: critics/security.md
```

Each critic per phase = 2 subtasks:

- **discover** — runs the critic's prompt against the phase's diff. Findings → `.saifctl/critic-findings/<phase>--<critic>--r<n>.md`.
- **fix** — consumes findings, rewrites implementation.

Both subtasks respect `--max-runs`. Critic prompts are templated with `{{phase.baseRef}}` (commit at the start of the phase's implementer subtask) so they can inspect via `git log {{phase.baseRef}}..HEAD`.

|             | Reviewer (Argus)                        | Critics                                                |
| ----------- | --------------------------------------- | ------------------------------------------------------ |
| When        | Per round, inner loop                   | Per phase, after gate passes                           |
| Diff range  | Run's initial base state → current HEAD | `{{phase.baseRef}} → HEAD`                             |
| Catches     | Semantic drift, hallucinated APIs       | User-defined concerns: security, performance, paranoia |
| User-wired? | No (always-on built-in)                 | Yes (declared in `feature.yml`)                        |

## Why three distinct agents

Three distinct LLM agents by design:

| Agent                                               | Role                                            | What it sees                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Designer (POC / Shotgun)**                        | Generate spec + plan                            | Proposal, codebase, optionally `discovery.md`. Never sees test agent's output or implementer's diff.                                                                                                                                                    |
| **Tests Planner + Tests Catalog**                   | Generate test catalog                           | Spec, plan, codebase. Never sees implementer's diff.                                                                                                                                                                                                    |
| **Implementer (OpenHands / Claude / Codex / etc.)** | Write code                                      | Spec, plan, **public** tests, codebase copy. Never sees hidden tests. See [`extension-points.md`](./extension-points.md) for the 15 supported agents.                                                                                                   |
| **Reviewer (Argus)**                                | Per-round semantic check                        | Spec, agent's diff. The deliberate exception to "agent output never reaches saifctl AI agents" — mitigated by the three-gate gauntlet, see [`security-threats.md` "Prompt-injection isolation"](./security-threats.md#additional-hardening-mechanisms). |
| **Vague Specs Checker**                             | Adjudicate test failure as ambiguous-or-genuine | Spec, **failing test details (NOT the diff)**. Never sees the implementer's output.                                                                                                                                                                     |
| **Critics**                                         | Per-phase adversarial review                    | Per-phase prompt, phase diff range.                                                                                                                                                                                                                     |

The firewall exists because **the implementer is the untrusted party** in the threat model. Letting the implementer's output reach the agents that grade it (Vague Specs Checker, Reviewer prompt, Tests Catalog) opens prompt-injection paths. Each agent above either has zero exposure to the implementer (Tests Catalog, Vague Specs Checker) or is exposed only to the diff under controlled conditions (Reviewer — and bypassing the Reviewer doesn't pass holdouts).

## See also

- [`orchestrator.md`](./orchestrator.md) — convergence loop, where Vague Specs Checker plugs in (`runVagueSpecsCheckerForFailure` at `loop.ts:2079`), critic subtask compilation.
- [`gate-and-reviewer.md`](./gate-and-reviewer.md) — the gauntlet the produced tests run through; how holdout failures fire the Vague Specs Checker.
- [`extension-points.md`](./extension-points.md) — designer profiles (POC, Shotgun), indexer profiles, agent profiles.
- [`sandbox-isolation.md`](./sandbox-isolation.md#the-copy-not-mount-workspace) — how `tests/hidden/` is physically scrubbed from the agent's workspace copy.
- [`security-threats.md`](./security-threats.md) — prompt-injection isolation reasoning; sanitized stderr feedback finding #1.
- [`docspec/products/saifctl/concepts/features.md`](../../../docspec/products/saifctl/concepts/features.md) — user-facing concept of what a feature directory looks like.
- [`docspec/references/commands/feat.md`](../../../docspec/references/commands/feat.md) — user-facing CLI reference for `feat design*` subcommands.
