# Features

A **feature** lets you define a complete change as a directory — specs, tests, configuration — and have saifctl drive agents to implement it until all tests pass. You create that directory under `saifctl/features/<feature-id>/`. saifctl reads that directory to understand what to run; there is no database, no registration step, no migration. The filesystem _is_ the schema.

This is the same convention-over-configuration idea you know from Rails or Next.js: the shape of the directory tells saifctl exactly what to do, and deviations from the convention are errors.

## What a feature directory contains

### Single-phase features

The minimum layout for a runnable feature:

```
saifctl/features/<feature-id>/
  specification.md   # what to build — the agent's instruction
  tests/             # test suite; must pass for the gate to open
```

Two optional files broaden the picture without changing the run behaviour:

| File          | Purpose                                                   |
| ------------- | --------------------------------------------------------- |
| `proposal.md` | Human-readable rationale; not read by the agent           |
| `plan.md`     | Agent-generated or hand-written build plan; informational |

### Phased features

When a change is large enough to split into increments, add a `phases/` subdirectory. Each phase is a numbered subdirectory:

```
saifctl/features/<feature-id>/
  feature.yml           # phase defaults (optional)
  phases/
    01-first-thing/
      spec.md           # phase-specific instruction
      tests/            # phase-specific tests
      phase.yml         # per-phase overrides (optional)
    02-second-thing/
      spec.md
      tests/
  critics/
    review-style.md     # optional critic prompt(s)
  tests/                # final-phase-only tests
```

Phase directories use zero-padded numbers (`01`, `02`, …`NN`). Lexicographic order is run order — no separate ordering configuration is needed.

## How the filesystem drives execution

When you run `saifctl feat run --feature <feature-id>`, saifctl:

1. Validates the directory structure before starting anything.
2. For single-phase features, runs the convergence loop once.
3. For phased features, runs the loop once per phase in lex order; a phase must pass its gate before the next begins.

Test scope accumulates as phases complete: just as a test suite mirrors the source tree being tested, each phase adds its own `tests/` to the running scope, so the gate for phase _N_ runs against all earlier phases' tests plus phase _N_'s own tests. Feature-root `tests/` and project-level tests run only on the final phase, because intermediate phases may be mid-migration — the end-state contracts cannot pass until the change is complete. Regressions are caught mechanically, not by convention or memory.

## Configuration: `feature.yml` and `phase.yml`

`feature.yml` at the feature root sets defaults for every phase:

- Which critics to run after each phase
- Mutability mode (whether specs and tests can be modified during a run)
- Maximum loop iterations per phase

`phase.yml` inside a phase directory overrides any of these settings for that phase only. Most features do not need either file — the defaults are sensible.

## The mutability gate

By default, saifctl treats spec and test files as immutable during a run. If the agent modifies them, the round is rolled back and penalised. This prevents the most common form of agent drift: deleting a failing test to make the gate green, or weakening a spec to justify a shortcut.

The `--strict` flag (the default) enforces this. Pass `--no-strict` only when a phase is explicitly meant to refine its own tests.

## Reference subdirectories

Directories whose names start with `_` are reserved as documentation, not runnable features:

| Directory              | Contents                                   |
| ---------------------- | ------------------------------------------ |
| `_phases-example/`     | Annotated full example of a phased feature |
| `_phases-and-critics/` | Smaller example with critics configured    |

saifctl ignores these during `feat run`. They exist so you can copy them as starting points without accidentally triggering a real build.

## Related pages

- [Feature lifecycle](feature-lifecycle.md) — proposal through PR: how a feature moves from idea to merged code
- [The `feat run` convergence loop](feat-run-loop.md) — what happens inside a single loop iteration
- [Spec-driven development](../tutorials/spec-driven-development.md) — step-by-step walkthrough of authoring a feature from scratch
