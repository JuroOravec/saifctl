# `_phases-pure-output-example/` — minimal `tests.none` walkthrough

This directory is **not** a real feature. The `_` prefix tells `saifctl`'s
feature discovery to skip it. It exists as the smallest runnable reference
for the per-phase-config Level-4 `tests.none: true` declaration — the
"phase has no own tests, gate the output instead" pattern.

The motivating user is [saifdocs](https://github.com/safe-ai-factory/saifdocs).
v0.3.0 shipped a per-phase `tests/gate.sh` that the test runner couldn't
see: the runner spun up against an empty `tests/` dir, the user shipped
an empty `tests/` to silence pre-flight warnings, and the actual gate
logic lived in a script the runner didn't know about. Per-phase-config
v1 ships `tests.none: true` so an output-only phase can declare itself
runner-bypassed cleanly, and `gate.script` so the per-phase assertion
("the file got written, looks right") lives where the loop reads it.

## Layout

```
_phases-pure-output-example/
├── _README.md          ← this file
├── feature.yml         ← reviewer disabled (no signal for codegen)
├── plan.md             ← single-paragraph plan
└── phases/
    └── 01-emit/
        ├── phase.yml         ← tests.none + gate.script
        ├── spec.md           ← what the agent should write
        └── assert-emitted.sh ← `gate.script` body — checks the manifest exists, is non-empty, parses
```

## What the compiler emits

`feat phases compile _phases-pure-output-example` produces one subtask:

```
phase:01-emit impl
```

No critic subtasks (the feature declares an empty critic list). No runner
spin-up (`noRunner: true` on the subtask manifest, courtesy of
`tests.none: true` resolving through to the Level-4 picker). The
`assert-emitted.sh` body is the `gateScript` for this one subtask —
when the agent writes `manifest.json`, the gate exits 0; when it doesn't,
the gate fails and the inner round retries.

## Compared to `_phases-example/`

`_phases-example/` is the comprehensive reference — every lifecycle level
is exercised across four phases. This directory is the opposite: one
phase, one config field that matters, no critics. Reach for this one
when you want to see the minimum config a `tests.none` phase needs.

See `concept per-phase-config` for the lifecycle-cost model and
`how-to pure-output-phase` for the full walkthrough.
