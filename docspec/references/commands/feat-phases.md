---
source: src/cli/commands/feat-phases.ts
type: cli-command
---

Phase-graph inspection and validation for phased features (features with a `phases/` subdir). Subcommands:

- `feat phases list <feature>` — list discovered phases + critics for the feature.
- `feat phases validate <feature>` — same checks `feat run` does at start, but standalone (useful in CI / pre-commit).
- `feat phases compile <feature>` — write the deterministic `RunSubtaskInput[]` the orchestrator would dispatch, to `.saifctl/features/<feat>/phases.compiled.json`. Diff-friendly: lets users review what would run without starting an agent. The compiled output reflects per-phase resolved config (the merged result of `phase.yml` > `feature.yml.phases.phases.<id>` > `feature.yml.phases.defaults` > `feature.yml` > saifctl defaults > built-in), so users can preview which `gate.script` / `agent.profile` / `container.image` / `runner.test-retries` / etc. each subtask will see before invoking `feat run`.

Contrast with `feat run`, which does the same compile internally, then actually executes.
