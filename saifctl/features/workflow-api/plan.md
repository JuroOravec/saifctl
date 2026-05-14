# `workflow-api` — feature plan

This feature implements the v1 Workflow API spec'd in
[`workflow-api.md`](./workflow-api.md). The detailed work breakdown lives
in [`implementation-plan.md`](./implementation-plan.md) — read that for
the per-week scope and the cross-block dependency graph; this file is the
short bridge between that plan and saifctl's phase structure.

## Project conventions and divergence rules

See [`_preamble.md`](./_preamble.md). The divergence rules are
load-bearing — they distinguish "the plan as written is impossible"
(allowed, with a written note) from "the plan is tedious and I want to
cut scope" (rejected).

## Phase ↔ block-week mapping

Block 0 has shipped to trunk; phased execution begins at Block 1.1.

Phase IDs use the format `NN-bNN-wNN-<slug>-<role>`, where the leading
`NN` is the sequential phase number across all weeks, `bNN` is the
block, `wNN` is the week within that block (so Block 1's four weeks
are `w01`–`w04`), and `<role>` is `impl` or `e2e`.

Each week of work in `implementation-plan.md` corresponds to **two
phases**:

| Role suffix | What happens | Source of truth |
|---|---|---|
| `-impl` | Agent implements the week's scope. `audit` critic × 2 rounds reviews the diff. | The numbered week section of `implementation-plan.md` (e.g. §4.1 for Week 1.1). |
| `-e2e` | Agent writes vitest tests into the project codebase covering the acceptance criteria. `audit` critic × 1 round checks the test pass once. | The same week section's "Acceptance" bullets. |

Phases run sequentially; `feature.yml.phases.order` is implicit lex
order on the leading numeric prefix.

### Week 1.1 — Workflow Zod schema (in progress)

| Phase | Implementation-plan ref |
|---|---|
| `01-b01-w01-foundations-zod-schema-impl` | §4.1 |
| `02-b01-w01-foundations-zod-schema-e2e` | §4.1 acceptance bullets |

Subsequent weeks (1.2 CEL, 1.3 interpolation, 1.4 predicate eval, then
Blocks 2–13) add their own two-phase pairs as we land them.

## Why `-e2e` writes tests after `-impl`, not before

The natural risk of "tests first" against a plan with 20 acceptance
bullets is that 10–20% of those bullets carry implementation-shape
assumptions the agent will need to renegotiate during build (per the
divergence rules above). Writing tests against a frozen spec forces the
test author into one of two failure modes: tests that lock in the wrong
shape, or tests that are vague enough to be useless. Writing tests
against the as-built impl avoids both — the test author has the impl in
front of them and writes against what was actually built (which, per the
divergence rules, IS the spec at that point).
