---
id: features
explains: the saifctl features/ filesystem layout — what a feature is, the role of specification.md / proposal.md / phases/ / critics/ / tests/, and how saifctl validates the structure before running
learning_outcomes:
  - A feature is a directory under `saifctl/features/<name>/`; saifctl is filesystem-driven (not a database).
  - Required files for a single-phase feature (`specification.md`, `tests/`); optional (`proposal.md`, `plan.md`).
  - Phased features add `phases/<id>/` subdirs, each with its own `spec.md` + `tests/`, plus optional `critics/<id>.md` at feature root and a `feature.yml` config.
  - Phase-numbering convention (zero-padded `01..NN`) keeps lex-order = run-order.
  - '`feature.yml` configures phase defaults (critics, mutability, max-runs); `phase.yml` overrides per-phase.'
  - The `--strict` mutability gate keeps test files immutable mid-run; saifctl rolls back rounds that touch them.
  - Reference subdirectories — `_phases-example/` (annotated full example), `_phases-and-critics/` (small full example with critics) — leading underscore reserves them as docs, not real features.
analogies:
  - convention-over-configuration like Rails / Next.js — filesystem is the schema
  - test directory structure where tests/ mirrors src/
---

Body intent: explain features as the saifctl unit of work; cover both "what a feature is" and "the spec-driven layout" in one concept page. Cross-link the `tutorial spec-driven-development` (release-readiness/DOC-08) for the step-by-step walkthrough.
