# Understand saifctl's safety guarantees

If you're wondering whether saifctl can accidentally break your existing tests, delete passing code, or let an agent skip the spec — this page answers that. The short answer: **regressions are mechanically prevented**, not just hoped for. saifctl's AI agent safety model means you can safely run AI agents on your codebase without manually verifying every output; the loop enforces correctness for you.

## Prerequisites

- A feature directory with specs (`phases/<id>/spec.md` or a root-level spec) and tests.
- `saifctl feat run --feature <feature-id>` — see `feat run` for flags.

You do not need to configure the Gate, Reviewer, or Holdout separately; they are part of every `feat run` invocation.

## What the loop guarantees

When you run `saifctl feat run`, the agent is locked in a convergence loop. It cannot stop until three independent checks all pass — in order, every iteration:

### Gate

Runs linters, type-checkers, and static analysis against the agent's output. If anything fails, the agent sees the failure and must fix it before the next attempt. There is no way to proceed with a broken build.

### Reviewer

An adversarial AI reads the diff against your spec. It is not the same agent that wrote the code. If the implementation deviates from the spec — adds unrequested behavior, removes required behavior, or leaves the spec partially implemented — the reviewer fails the round and sends the agent back to fix it.

**Note:** The Reviewer always diffs from the run's initial "Base state" commit to HEAD — it is not phase-scoped. Even in a phased feature, the Reviewer sees the entire accumulated diff since the run started, not just the current phase's commits.

### Holdout tests

These are your tests. The agent never sees them during implementation; they are withheld from its context. Because the agent cannot read them, it cannot tailor code to pass them by inspection. All three — Gate, Reviewer, and Holdout — must pass before a PR is opened.

## Why earlier work cannot regress

For phased features (where each phase has its own spec and tests), the test scope is **cumulative**: when phase 3 runs, the holdout set includes phase 1's tests, phase 2's tests, and phase 3's tests. A change that breaks earlier work fails the gate immediately. There is no separate "regression suite" to configure — the guarantee composes automatically across phases.

## The fourth layer: critics

After the Gate passes for a phase, critic rounds run. Each critic is a separate adversarial prompt that inspects the phase's commits (via `git log <baseRef>..HEAD`) and writes a findings file. The agent must resolve those findings before the phase is considered done. Critics are per-phase and do not block the Gate — they run after it.

## Steps

To confirm the guarantees are active for your run:

1. Run your feature normally: `saifctl feat run --feature <feature-id>`.
2. Watch the run log — each iteration shows Gate, Reviewer, and Holdout results. A phase only advances when all three pass.
3. After the run completes, check the opened PR: the diff should touch only files permitted by the spec.

## Verification

Once a run completes, saifctl opens a PR. You can confirm safety by checking:

1. **PR diff** — only touches files permitted by the spec; no unrelated changes.
2. **CI on the PR** — your existing test suite runs against the agent's output in the same way it would for any human PR.
3. **Run log** — saifctl surfaces any deviations the implementer made from the plan or spec.

## See also

- [How the feat run loop works](../concepts/feat-run-loop.md) — the convergence loop, timeouts, and phased features explained.
- [Gate, Reviewer, and Holdout](../concepts/gate-reviewer-holdout.md) — detailed breakdown of each layer and how critics fit in.
- [Run a feature end to end](./run-first-feature.md) — step-by-step walkthrough from spec to PR.
