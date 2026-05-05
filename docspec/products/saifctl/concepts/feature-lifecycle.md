---
id: feature-lifecycle
explains: how a feature progresses from proposal to ship in saifctl, including the differences between single-phase and multi-phase features
learning_outcomes:
  - The four lifecycle stages — proposal, design, build, ship — and which saifctl command drives each.
  - When a feature is small enough for one-phase convergence vs. when phases are warranted (large scope, migrations, intermediate adversarial review).
  - Phased features run phase-by-phase, with cumulative test scope (project-level + feature-level + earlier phases' + this phase's), so a regression to earlier work fails the active phase's gate.
  - Phased features still produce ONE PR per feature, not per phase — reviewers see the feature whole.
  - The mutability gate (`--strict` / `--no-strict`) keeps test files immutable mid-run; saifctl rolls back rounds that touch them.
analogies:
  - PR-by-PR vs feature-by-feature delivery
  - migrations vs feature work in monolithic vs phased frames
---

Intent-only body; generated docs will expand with stage-by-stage walk-through and decision criteria for single-phase vs phased.
