# Phase 02 — Foundations · Workflow Zod schema (e2e tests)

Write the vitest test suite for the Block 1.1 Zod schema that landed in
Phase 01. Tests authored here live in the project codebase (not in this
feature dir) so they become permanent regression coverage picked up by
`pnpm check` and CI.

## Source of truth

The acceptance criteria are in
[`saifctl/features/workflow-api/implementation-plan.md`](../../implementation-plan.md)
§4.1 under "Acceptance:" — that subsection is the rubric. Read both
the **Acceptance** block and the **Scope** block of §4.1; some
behaviors stated as scope items are implicit acceptance criteria.

Explore the codebase to see Phase 01's as-built impl before writing
tests — `src/specs/workflow/*.ts` is the surface. Your tests verify
the shape and behavior that actually shipped, not a hypothetical
alternative.

Project conventions and divergence rules:
[`../../_preamble.md`](../../_preamble.md). The same scope-cut-vs-
structural-deviation rules apply: don't quietly omit acceptance
bullets from the test coverage.

## What this phase does NOT do

- **No new feature work.** If a test reveals a real bug in Phase 01's
  impl, fix it minimally — but if the fix grows beyond a small patch,
  that's a sign Phase 01 wasn't finished and the audit critic should
  re-flag it on the next phase rather than papering over it here.
