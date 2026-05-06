# The `feat run` convergence loop

`saifctl feat run` drives an AI agent through a **convergence loop**: the agent writes or modifies code, a set of gates evaluates the result, and if anything fails the agent sees the failures and must fix them. The loop repeats until every gate passes. You are notified only when the code emerges from the loop in a passing state.

Think of it like a compiler error cycle — write, compile, fix, repeat — except the "compiler" is a multi-layer test and review pipeline and the "programmer" is an agent you never need to watch.

## The gate pipeline

Each iteration of the loop runs three checks in order:

1. **Gate tests** — your TDD tests run inside the container. Any failure is fed back to the agent as-is; no summary, no interpretation.
2. **Reviewer** — a separate LLM context reads the diff and the spec and flags issues. Issues become another round of agent fixes.
3. **Holdout tests** — a hidden test suite runs last, confirming the implementation generalises beyond the examples the agent saw. All three must pass before the loop exits.

The agent cannot skip or reorder these checks. It cannot declare itself done. The only exit is a fully green pipeline.

## Phased features

When a feature directory contains a `phases/` subdirectory, `feat run` repeats the convergence loop **once per phase** in declaration order. Each phase has its own spec, its own tests, and its own critic configuration.

A phase's gate must pass before the next phase begins — similar to a CI matrix where each row gates the next. This gives you a natural checkpoint: earlier behaviour is frozen before later phases extend it.

### Test scope accumulates across phases

When a phase's gate runs, the test suite includes:

- `phases/<current-phase-id>/tests/**` — tests introduced in this phase
- `phases/<earlier-phase-id>/tests/**` — tests from every completed phase
- `tests/**` at the feature root — feature-wide tests

Later phases cannot silently break earlier ones. Regressions are caught mechanically, not by memory or convention.

### Critic rounds

After a phase's gate passes, critics run. Each critic represents a quality dimension (security, style, architecture, and so on). A critic adds two subtasks: a **discover** subtask, where a fresh LLM context reads the diff and produces findings, followed by a **fix** subtask, where the agent addresses those findings. After the fix subtask completes, the loop's standard gate pass runs again — this is the normal convergence mechanism, not an additional critic-owned step.

A phase is not considered done until all its critics have completed their discover-and-fix cycles with a green gate. Only then does the next phase begin.

## Timeouts

Two wall-clock timeouts bound the entire run:

- **`--subtask-timeout`** (default: 1 hour) — resets for each subtask (implement, discover, fix). A subtask that hangs is aborted; the run saves its artifact and can be resumed.
- **`--run-timeout`** (default: unbounded) — a total budget across all subtasks. Useful when you want to cap spend on a run regardless of how many phases or critic rounds remain.

Either timeout fires the same abort-and-save path. Resume any interrupted run with:

```
saifctl run start <run-id>
```

## What you see

While the loop runs you receive no intermediate output — the agent iterates silently inside the container. When the run finishes you see the final gate results, critic summaries, and a PR if the feature is configured to open one.

This is intentional. Interrupting an in-progress agent loop to show intermediate failures would not give you actionable information; the agent is already handling them. Your time is spent reviewing a finished, passing result, not watching a red/green cycle.

## Related pages

<!-- how-to/define-phased-feature.md — forthcoming -->
<!-- reference/feat-run.md — forthcoming -->
<!-- concepts/gate-pipeline.md — forthcoming -->
