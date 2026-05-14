# Phase 01 — Foundations · Workflow Zod schema (impl)

Implementation of Block 1.1 (Week 1.1) of the workflow-api v1 build —
the canonical Zod schema for the workflow IR, plus the post-parse
transforms and schema-level security validators that have to land
together. This is the foundation every later phase depends on.

## Source of truth

The contract for this phase is
[`saifctl/features/workflow-api/implementation-plan.md`](../../implementation-plan.md)
§4.1 "Week 1.1 — Workflow Zod schema". Read that section in full before
making any changes — its **Scope**, **Files**, and **Acceptance**
sub-sections are the authoritative spec. The companion
[`workflow-api.md`](../../workflow-api.md) is the underlying design
(referenced by section number throughout §4.1).

Explore the surrounding context before starting: skim the rest of
[`implementation-plan.md`](../../implementation-plan.md), the workflow-api.md, the design docs alongside them,
and the existing codebase. Understand where the project stands and what shape
the surrounding code already has before writing new code.

Project conventions and divergence rules:
[`../../_preamble.md`](../../_preamble.md). Read this. The implementer
prompt grants narrow permission to edit `implementation-plan.md` and
this `spec.md` when the plan is **structurally impossible** as written
— it is not a scope-renegotiation channel. The audit critic checks for
silent acceptance-bullet drift.

## Relationship to Block 0.3's sketch

Block 0.3 shipped a minimal Zod sketch at
[`src/specs/workflow/schema.sketch.ts`](../../../../../src/specs/workflow/schema.sketch.ts)
(workflow top-level + 2 sources + 2 sinks + leaf step only) along with
the derive script at
[`../../derive-workflow-schema.ts`](../../derive-workflow-schema.ts)
(lives inside this feature dir; not wired into `pnpm build` yet — run
manually via `pnpm tsx saifctl/features/workflow-api/derive-workflow-schema.ts`).
Per implementation-plan.md §3.3, the sketch is replaced wholesale by
the full schema; do not grow `schema.sketch.ts` incrementally. Concretely:

- **Create** `src/specs/workflow/schema.ts` as the new canonical home
  for the full schema.
- **Keep** the `sensitive(...)` helper pattern, the `SENSITIVE_DESCRIBE_TAG`
  side-channel, and the `liftSensitiveTag` + `injectDiscriminators`
  post-passes — these are the design pattern; they carry forward.
- **Delete** `src/specs/workflow/schema.sketch.ts` and
  `src/specs/workflow/schema.sketch.test.ts` once `schema.ts` parses
  every fixture the sketch parsed.
- **Update** `saifctl/features/workflow-api/derive-workflow-schema.ts`
  to import from `schema.ts` instead of `schema.sketch.ts`. The derived
  `workflow-schema.json` (in this feature dir) and the Pydantic codegen
  output under `block-0-pydantic-smoke/` get regenerated from the new
  schema; both should remain green smoke-tests after this phase.

## Scope summary (full enumeration in §4.1)

- Top-level: `schemaVersion`, `metadata`, `defaults`, `inputs`,
  `sources`, `steps`, `sinks`, `outputs`.
- All v1 source types: `github`, `gitlab`, `bitbucket`, `s3`, `gcs`,
  `r2`, `http`, `local`. Discriminated on `type:`.
- All v1 sink types: `s3`, `gcs`, `r2`, `github-pr`, `gitlab-mr`,
  `bitbucket-pr`, `email`, `slack`, `webhook`, `local`. Discriminated
  on `type:`. `webhook` carries the `hmac:` sub-block.
- All three step-node kinds: leaf (`spec`), if-wrapper (`if` +
  `steps`), external subworkflow (`workflow`). Discriminator is
  presence-of-key (Zod `superRefine`, not `discriminatedUnion`).
- `exports:` shorthand + longhand forms.
- Step-level `sources:` (leaf only) + step-level `sinks:` (leaf +
  subworkflow); rejection on if-wrappers; flatten transform for sinks.
- Resource-ID grammar and workspace-relative `saveAs:` rules with
  trailing-slash normalization, collision check, no-`/workspace/`
  prefix, no `..`.
- Schema-level security validators from §15.8: email TLS, CRLF in
  templated headers/subject, PR `head:` interpolation + default-branch
  reject, email HTML-body opt-in, webhook HTTPS-only `url:`,
  anonymous-fetch warning on credential-supporting sources.
- `defaults:` block reusing `src/specs/phases/schema.ts` sub-schemas
  where possible; lockstep validators run at workflow `defaults:`,
  step `config:`, and merged-effective-config levels.
- `tests:` block (definition + policy) at step level AND workflow
  level; profile-required validator.
- Map-shape credential metadata for `http.headers:` / `webhook.headers:`
  / `email.headers:`.

**Out of scope this phase** (per §4.1 "Out of scope this week"):
semantic validation (DAG reachability, ref resolution, type-checking
against exports). Those land in Weeks 1.2–1.4.

## Files to land (suggested layout)

The file split below mirrors §4.1's "Files:" subsection — six new
files under `src/specs/workflow/`. Treat this as a starting point, not
a contract. If the implementation lands more naturally with a
different split (fewer files, more files, different names), follow
that and update §4.1's "Files:" subsection to match what you actually
shipped (per the divergence rules in [`_preamble.md`](../../_preamble.md)).

- `schema.ts` — the full Zod schema (replaces `schema.sketch.ts`).
- `types.ts` — derived TypeScript types (`z.infer<...>` re-exports).
- `flatten-step-sinks.ts` — Zod `.transform()` that moves step-level
  sinks to the workflow's global `sinks:` list with synthesized
  `after:` and preserved `_sourceLocation` annotation.
- `normalize-save-as.ts` — trailing-slash normalization + nested-mount
  + collision check.
- `validate-defaults.ts` — reuses `src/specs/phases/schema.ts`
  sub-schemas for the workflow `defaults:` block.
- `validate-sink-security.ts` — the §15.8 schema-level validators.
- `validate-step-shape.ts` — rejects `sources:` on if-wrappers and
  subworkflow steps per §6.1.

Sketch files deleted; `saifctl/features/workflow-api/derive-workflow-schema.ts`
re-pointed at the new `schema.ts`.

## Acceptance (full enumeration in §4.1 "Acceptance:")

- Parses every example from §4 / §11 of `workflow-api.md`.
- Rejects every invalid example with a clear error path.
- Step-level sinks flatten correctly (canonical-JSON parity with the
  workflow-level form).
- `metadata:` block accepts arbitrary `labels` / `annotations` keys.
- `defaults:` block reuses per-phase-config sub-schemas correctly.
- Lockstep validators fire at all three merge levels.
- `saveAs:` normalization + collision check work per §15.4 Amendment 2.
- §15.8 schema validators fire per the seven-rule catalogue.
- Step-kind shape constraints reject `sources:` on if-wrappers + on
  subworkflow steps.
- Map-shape sensitivity metadata is introspectable.
