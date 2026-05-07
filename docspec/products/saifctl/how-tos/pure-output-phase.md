---
id: pure-output-phase
intent: 'Goal-oriented how-to; reader has a phase that produces files but has no behavioural tests of its own (e.g. a docs/manifests/codegen phase). Tests would be tautological — the agent would test that the file it just wrote contains what it just wrote — so the phase needs the runner bypassed.'
---

Structure:

1. **Goal** — one phase emits output (generated docs, generated manifests, codegen, scaffolding) and has no behavioural assertion to run against itself. Without `tests.none`, the runner spins up just to skip an empty test dir, wasting the per-attempt container and forcing the user to ship a stub `tests/` dir to silence pre-flight warnings.
2. **Set `tests.none: true`** — at `phases/<id>/phase.yml`. The runner is bypassed for this phase. The phase still gets a gate (`gate.script`) — that's how you express "the file got written and looks right."
3. **Optionally tighten `gate.script`** — point it at an assertion script that checks the output file exists, is non-empty, and (if applicable) parses cleanly. Example: `gate: { script: assert-emitted-non-empty.sh }`. The script runs in the coder container after each round; non-zero exit retries the round (up to `gate.retries`, default 10).
4. **Run** — `saifctl feat run <feature>`. The compiled subtask manifest carries `noRunner: true` for this phase; the orchestrator's runner-bypass branch fires when the cumulative test scope has no sources (non-last phase) OR runs the runner against feature/project tests only (last phase — end-state contracts still gate). No empty test runs, no spurious pass/fail.
5. **Caveat: the last phase** — if the phase declaring `tests.none` is the LAST phase of the run, the runner still spins up if the feature has top-level `tests/` or the project has `<saifctlDir>/tests/`. That's intentional — those are end-state contracts that should hold once the whole run finishes, not phase-local assertions.

The runnable minimal example is at `saifctl/features/_phases-pure-output-example/`. Cross-link the saifdocs case (the original motivating user) and `concept per-phase-config` for where Level-4 routing fits in the lifecycle model.
