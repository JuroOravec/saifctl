# Gate, Reviewer, and Holdout: the three-lock gauntlet

Before `saifctl feat run` opens a pull request, every iteration of the convergence loop must pass three checks in order. Think of them as three locks on a door: all three must open before your agent is done.

## The three locks

### Gate

The Gate runs your linters, type-checkers, and static analysis tools inside the container. It is purely mechanical — no inference, no interpretation. If a linter flags an unused import or a type-checker finds a type mismatch, your agent sees the raw output and must fix it. Speed matters here, but correctness is enforced structurally: your agent cannot proceed until the tools report clean.

### Reviewer

After the Gate passes, a separate LLM context — adversarial by design — reads the diff and the spec and looks for disagreements. It does not run your code; it reads it as a critic would. Findings are fed back to your agent as fix instructions.

The Reviewer always diffs from the run's initial "Base state" commit to `HEAD`. It is not scoped to a single phase; it sees the full cumulative diff of the run.

### Holdout tests

The Holdout suite is hidden from your agent throughout the run. Your agent sees your TDD tests; it does not see holdout tests and cannot inspect or reverse-engineer them. They run last, after the Reviewer passes, and confirm that the implementation generalises — that your agent solved the problem rather than fitting to the visible examples.

All three locks must open in sequence before a PR is opened. No lock can be skipped, and your agent cannot self-certify completion.

## How the gauntlet runs per phase

For phased features, the gauntlet runs once per phase — not once at the end of the entire run. Each phase must clear its own Gate and Holdout tests before the next phase begins.

The test scope for a given phase is cumulative:

- `tests/**` at the project root — project-wide tests
- `tests/**` at the feature root — feature-wide tests
- `phases/<earlier-phase-id>/tests/**` — tests from every completed phase
- `phases/<current-phase-id>/tests/**` — tests introduced in this phase

This means a regression to an earlier phase's behaviour fails the current phase's Gate. Correctness is maintained mechanically across the entire feature, not by convention or memory.

## Critics: the fourth layer

After a phase's Gate passes, critics run. Critics are distinct from the Reviewer: they are per-phase, they are configurable, and they represent specific quality dimensions (security, architecture, style, and so on).

Each critic captures a `baseRef` at the start of the phase's implementer subtask. The critic prompt is parameterised with `{{phase.baseRef}}`, so the critic inspects only the commits in `git log {{phase.baseRef}}..HEAD` — the work done in this phase. Findings are written to a findings file, and your agent addresses them in a fix subtask. After the fix subtask, the standard Gate runs again.

A phase is not complete until all its critics have run their discover-and-fix cycles and the Gate is green. Only then does the next phase begin.

Think of the three locks as the door, and critics as the building inspector who checks each floor before construction continues upward.

## The composing guarantee

The holdout guarantee composes across phases. When phase 3 runs, phase 1's and phase 2's holdout tests are still in scope. An agent that satisfies phase 3's requirements at the cost of phase 1's behaviour will fail the Gate of phase 3, not just phase 1's original Gate. You do not need to re-run earlier phases manually to catch regressions.

## Related pages

- [The `feat run` convergence loop](./feat-run-loop.md)
- [Feature lifecycle](./feature-lifecycle.md)
