---
id: gate-reviewer-holdout
explains: the three stages an agent must survive before a PR is opened (Gate, Reviewer, Holdout tests), and how the same gauntlet runs per-phase for phased features
learning_outcomes:
  - Gate runs linters, type-checkers, and static analysis.
  - Reviewer is an adversarial AI that checks the diff against the spec.
  - Holdout tests are hidden from the agent; they cannot be faked.
  - All three must pass before a PR is opened.
  - For phased features, the gauntlet runs per phase — gate + holdout tests are scoped to the phase's cumulative test set (project-level + feature-level + earlier phases' + this phase's). The Reviewer always diffs from the run's initial "Base state" commit to HEAD; it is not phase-scoped today.
  - Critics are a separate fourth layer that runs **after** the gate passes; they ARE per-phase. Each critic prompt is parameterised with `{{phase.baseRef}}` (captured at the start of the phase's implementer subtask), so critics inspect commits via `git log {{phase.baseRef}}..HEAD` and write findings files that the fix step then resolves.
  - The holdout-test guarantee composes across phases — when phase 3 runs, all of phase 1's and phase 2's tests are still in the test scope, so a regression to earlier work fails the gate.
analogies:
  - gauntlet
  - three locks on a door
  - phased features add a fourth layer (critics) that opens only after the first three close
---

Intent-only body; generated docs will expand this for the product lens.
