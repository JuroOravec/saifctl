---
source: src/cli/commands/feat.ts
type: cli-command
---

Spec-driven feature loop: `feat run` and related subcommands. Contrast with `sandbox` for isolated runs without tests, reviewer, or staging.

`feat run` auto-detects phased features: if the feature dir contains a `phases/` subdirectory, saifctl pre-flight-validates `feature.yml` + every `phase.yml`, then **compiles** the phase graph into per-phase implementer subtasks plus per-critic discover/fix subtask pairs (Block 3). The compiled subtask plan can be previewed with `feat phases compile` without running anything. The `--strict` / `--no-strict` flag (Block 7) flips the project-wide default for `tests.mutable` — strict (the default) keeps test files immutable unless `tests.mutable: true` is set; `saifctl/tests/` is always immutable regardless.

Pre-flight runs the §6.9 lockstep validators alongside the structural checks: `container.cedar` paired with `container.no-leash: true` errors; `tests.none: true` paired with any `tests.*` / `runner.*` field warns; `agent.profile` paired with explicit `agent.script` / `agent.install` warns; `container.sandbox-profile` paired with explicit `container.image` warns. Adjacent phases that differ on Level-2 / Level-3 settings emit info-level previews of the controlled coder-container restart cost. See `concept per-phase-config` for the lifecycle-cost model.

`feat phases` subcommands (introduced with phased features):

- `feat phases list` — list discovered phases + critics for a feature.
- `feat phases validate` — same checks `feat run` does at start, but standalone (useful in CI / pre-commit).
- `feat phases compile` — print the subtask plan that a `feat run` would execute, without invoking the agent.
