---
persona: engineer
tasks:
  - configure-a-phase
goal: Override one phase's gate, agent, container, runner, or attempt budget without affecting the rest of the run
---

Goal-oriented how-to. Reader has a phased feature and wants one phase to behave differently from the rest of the run.

Structure:

1. **Goal** — one phase needs to override a run-level setting (e.g. stricter gate for the last phase, cheaper model for a verification phase, different container image for a Python-only phase, lower attempt budget for a flaky phase).
2. **Prerequisites** — a phased feature on disk (`phases/<id>/spec.md` exists for each phase). Single-phase features should set the override at `feature.yml` top-level instead.
3. **Choose the right level** — link to `concept per-phase-config` for the cost table. Quick rule: Level-1 / 1.5 / 4 fields are free per round; Level-2 / 3 trigger a coder-container restart between phases (~10–30s for Level 2, minutes for Level 3 image pulls). Group phases by Level-2/3 settings to minimise restarts.
4. **Write `phase.yml`** — file form lives at `phases/<id>/phase.yml`; inline form lives at `feature.yml.phases.phases.<id>`. One example per group: `gate: { script: stricter-gate.sh }`, `agent: { model: 'openai/gpt-4o-mini' }`, `container: { sandbox-profile: python-uv }`, `runner: { test-retries: 5 }`, `limits: { max-attempts: 3 }`. Note kebab-case in YAML (e.g. `max-attempts`, `compose-file`); TypeScript types stay camelCase (round-tripped through the manifest).
5. **Preview with `feat phases compile <feature>`** — writes the resolved per-subtask manifest to `.saifctl/features/<feat>/phases.compiled.json`. Check that the override landed where expected; check the info-level transition previews emitted by the validator (Level-2 / Level-3 boundaries name the fields that changed and their cost class).
6. **Run** — `saifctl feat run <feature>`. The pre-flight runs the same validators as `feat phases validate`, then dispatches the compiled subtasks. Phase boundaries that cross Level-2/3 emit `[orchestrator] Phase boundary requires controlled coder-container restart …` to the run log; the sandbox dir is preserved across the restart.

Cross-link the worked example at `saifctl/features/_phases-example/` (each phase exercises a different level) and `how-to pure-output-phase` (the special-case `tests.none: true` shorthand).
