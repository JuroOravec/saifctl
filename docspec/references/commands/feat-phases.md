---
source: src/cli/commands/feat-phases.ts
type: cli-command
---

Phase-graph inspection and validation for phased features (features with a `phases/` subdir). Subcommands:

- `feat phases list <feature>` — list discovered phases + critics for the feature.
- `feat phases validate <feature>` — same checks `feat run` does at start, but standalone (useful in CI / pre-commit).
- `feat phases compile <feature>` — write the deterministic `RunSubtaskInput[]` the orchestrator would dispatch, to `.saifctl/features/<feat>/phases.compiled.json`. Diff-friendly: lets users review what would run without starting an agent.

Contrast with `feat run`, which does the same compile internally, then actually executes.
