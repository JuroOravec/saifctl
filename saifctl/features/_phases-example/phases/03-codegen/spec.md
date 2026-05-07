# Phase 03 — Codegen (Level-4 `tests.none` demo)

Generate a JSON manifest from the validated records produced by phases 01 and
02. The manifest is the artifact this phase ships — there are no behavioural
assertions to run against the generator itself, so the test runner is bypassed
for this phase via `tests.none: true`.

## Tests

A real codegen phase has nothing to test. The gate would assert "the manifest
file got written, is non-empty, and parses as JSON" — that's a `gate.script`
concern (Level 1), not a `tests/` concern (Level 4). End-state contracts
(`features/_phases-example/tests/`) still gate at the run's last phase, so
anything that the manifest must satisfy globally still gets checked
somewhere — just not here.

This doc-only example does **not** ship `phases/03-codegen/tests/` — that's
the whole point of `tests.none: true`. See `how-to pure-output-phase` for
the standalone walkthrough at `_phases-pure-output-example/`.
