# Run your first feature with saifctl feat run

Use `saifctl feat run` to implement a feature end-to-end with AI: the agent writes code, passes every gate, survives an adversarial reviewer, and opens a PR (if you pass `--push origin --pr`) — without you touching the implementation. This is spec-driven development with AI; you define what to build, saifctl enforces correctness.

## Prerequisites

- saifctl installed and a Git repository initialised
- Docker available (saifctl runs every agent in an ephemeral container)
- A feature directory with a spec and at least one test (see structure below)

## How it works (short version)

saifctl locks the agent in a convergence loop — **Gate → Reviewer → Holdout tests** — and the agent cannot exit until all three pass. Gate runs linters, type-checkers, and static analysis. Reviewer is an adversarial AI that checks the diff against your spec. Holdout tests are hidden from the agent so they cannot be faked. Only when all three clear does saifctl open the PR and notify you. See [feat-run-loop](../concepts/feat-run-loop.md) and [Gate, Reviewer, and Holdout](../concepts/gate-reviewer-holdout.md) for the full mechanics.

## Steps

### 1. Create the feature directory

```
saifctl/features/my-feature/
├── spec.md          # what to build
├── feature.yml      # optional overrides (agent, timeouts, branch name)
└── tests/
    └── holdout/     # tests hidden from the agent
```

Minimal `feature.yml` (omit to use defaults):

```yaml
branch: feat/my-feature
```

### 2. Write the spec

`spec.md` describes the outcome, not the implementation. Be precise about interfaces, invariants, and acceptance criteria. The Reviewer will diff the agent's code against this file — vague specs produce vague results.

### 3. Add holdout tests

Place tests the agent must not see under `tests/holdout/`. These are your correctness guarantee: the agent cannot observe them, so they cannot be gamed. At minimum, one test that fails before the feature is implemented is enough to get started.

### 4. Run the feature

```bash
saifctl feat run --feature my-feature
```

saifctl will:

1. Spin up an ephemeral container with your workspace copied in.
2. Run the implementer subtask (agent reads `spec.md`, writes code).
3. Run Gate — linters, type-checkers, static analysis.
4. Run the Reviewer — adversarial AI checks the diff against the spec.
5. Run Holdout tests — hidden tests executed against the agent's output.
6. Loop back to step 2 on any failure, showing the agent what broke.
7. Open a PR when all three pass (only if `--push` and `--pr` are supplied).

### 5. Monitor progress

```bash
saifctl run list
saifctl run info <run-id>
```

You are notified when the code emerges from the loop. There is nothing to babysit.

## Verification

When the run completes you will see:

```
Gate:     PASS
Reviewer: PASS
Holdout:  PASS
PR opened: https://github.com/your-org/your-repo/pull/...
```

If any stage fails permanently (e.g. a timeout), saifctl saves an artifact and you can resume:

```bash
saifctl run resume <run-id>
```

## Multi-phase features (optional)

If your feature spans multiple modules or needs intermediate checkpoints, split it into phases:

```
saifctl/features/my-feature/
├── feature.yml
└── phases/
    ├── 01-core/
    │   ├── spec.md
    │   └── tests/holdout/
    └── 02-extras/
        ├── spec.md
        └── tests/holdout/
```

The gate-and-holdout gauntlet runs per phase; each phase must pass before the next starts. Later phases always include earlier phases' tests, so regressions are mechanically prevented.

**Critics (optional fourth layer):** You can add a `critics/` directory at the feature root, with one `<id>.md` template per critic (e.g. `paranoid.md`, `security.md`). Attach them to phases via `feature.yml`'s `phases.defaults.critics` or a per-phase `phase.yml`. After each phase's gate passes, saifctl runs the attached critics in discover/fix pairs. See [Gate, Reviewer, and Holdout](../concepts/gate-reviewer-holdout.md) for details.

Preview the subtask plan before running:

```bash
saifctl feat phases compile --feature my-feature
saifctl feat run --feature my-feature
```

A fully annotated example lives at `saifctl/features/_phases-example/`.

## See also

- [feat-run-loop](../concepts/feat-run-loop.md) — convergence loop mechanics and timeout options
- [Gate, Reviewer, and Holdout](../concepts/gate-reviewer-holdout.md) — what each stage checks and why holdout tests cannot be faked
- [Run an agent safely (sandbox)](./run-agent-safely.md) — one-off agent execution without a spec
- [Inspect and resume a run](./inspect-and-start.md) — pick up a stopped or timed-out run
