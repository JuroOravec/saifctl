# Spec-driven development with saifctl

**What you will have by the end:** a working feature directory, a running agent loop you can observe, and a clear mental model of how saifctl enforces correctness mechanically — not by trusting the agent.

This is stage 1 of 2 in this tutorial series. It walks slowly through the feature directory layout and explains *why* each file exists. If you want to race straight to a finished PR, see [Run your first feature](../how-tos/run-first-feature.md) instead.

---

## What spec-driven development means here

You write the spec and the tests. saifctl runs an agent through a convergence loop — **Gate → Reviewer → Holdout tests** — until all three pass. The agent cannot stop early, cannot see the holdout tests, and cannot open a PR until the gauntlet clears. You are notified when the code emerges.

The guarantee is mechanical: correctness is enforced by the loop, not by the agent's good behaviour.

---

## Anatomy of a feature directory

A feature is a directory under `saifctl/features/<name>/`. saifctl is filesystem-driven — there is no database, no project config to update. The layout is the schema.

### Step 1 — Create the directory

```bash
mkdir saifctl/features/add-json-flag/
```

That is a valid (empty) feature at this point. saifctl will complain when you try to run it without required files, but the directory itself is enough to name the feature.

### Step 2 — Add `specification.md`

```bash
touch saifctl/features/add-json-flag/specification.md
```

`specification.md` is the precise behaviour contract the agent reads before writing any code. Be specific about interfaces, invariants, and acceptance criteria — the Reviewer will diff the agent's output against this file, so vague specs produce vague results.

A minimal spec for a tiny feature:

```markdown
# add-json-flag

Add a `--json` flag to `saifctl run list`.

When `--json` is present, output must be valid JSON (an array of run objects).
When absent, behaviour is unchanged.
Exit code must be 0 on success in both modes.
```

Three to five lines is enough to start. You can always add detail later.

> **Convention:** Some teams use `spec.md` (for phased features, each phase gets its own `phases/<id>/spec.md`). For single-phase features the top-level file is `specification.md`. See [features](../concepts/features.md) for the full layout.

### Step 3 — Add tests

```bash
mkdir -p saifctl/features/add-json-flag/tests/holdout/
```

Tests live under `tests/`. The agent can read everything directly under `tests/`, so these **visible tests** act as worked examples and give the agent concrete guidance:

```typescript
// tests/01-json-flag.spec.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(exec);

test("--json produces valid JSON array", async () => {
  const { stdout } = await run("saifctl run list --json");
  const parsed = JSON.parse(stdout); // throws if invalid
  expect(Array.isArray(parsed)).toBe(true);
});
```

**Holdout tests** go under `tests/holdout/`. The agent cannot see that subdirectory, which is what makes them a genuine correctness guarantee: they cannot be observed or gamed. Duplicate the key assertions there (or add stricter variants) so the agent cannot pass by hard-coding the visible test's expectations.

```typescript
// tests/holdout/01-json-flag.spec.ts  ← agent cannot read this
// ... same assertions, possibly stricter
```

That is the minimum viable feature. You can run it now.

---

## Walkthrough: building the feature end-to-end

### 1. Confirm the directory layout

```
saifctl/features/add-json-flag/
├── specification.md
└── tests/
    └── holdout/
        └── 01-json-flag.spec.ts
```

### 2. Run the feature

```bash
saifctl feat run --name add-json-flag
```

saifctl will:

1. Copy your workspace into an ephemeral Docker container.
2. Start the **implementer** subtask — the agent reads `specification.md` and writes code.
3. Run **Gate** — linters, type-checkers, and static analysis. Failures are fed back to the agent.
4. Run the **Reviewer** — an adversarial AI that checks the diff against your spec. Failures are fed back to the agent.
5. Run **Holdout tests** — your hidden tests run against the agent's output. Failures are fed back to the agent.
6. Loop back to step 2 on any failure.
7. When all three pass: save the result (and open a PR if you passed `--push origin --pr`).

The loop is bounded by wall-clock timeouts (`--run-timeout`, `--subtask-timeout`); see [feat-run-loop](../concepts/feat-run-loop.md) for the defaults and how to adjust them.

### 3. Watch progress

```bash
saifctl run list
saifctl run info <run-id>
```

Each line of output corresponds to a gate check, a reviewer finding, or a holdout test result. You do not need to babysit the loop — you will be notified when the run completes.

### 4. When it finishes

A successful run ends with:

```
Gate:     PASS
Reviewer: PASS
Holdout:  PASS
```

The agent's code is on a branch (`feat/add-json-flag` by default). Review it like any other PR.

---

## Optional: `feature.yml`

Omit `feature.yml` entirely to use defaults. Add it when you need to override something:

```yaml
# saifctl/features/add-json-flag/feature.yml
branch: feat/add-json-flag
agent: openhands
max-runs: 5
```

Common overrides: `branch` (default is derived from the feature name), `agent` (which agent runs the implementer), `max-runs` (cap on convergence attempts). See the [feat reference](../../../references/commands/feat.md) for the full config surface.

---

## Optional: phased features

When a feature is too large to converge in one shot, split it into phases. Each phase has its own spec and tests; the gauntlet runs per phase, and each phase must pass before the next starts.

```
saifctl/features/add-json-flag/
├── feature.yml
├── critics/
│   └── security.md          # adversarial review template
└── phases/
    ├── 01-flag-parsing/
    │   ├── spec.md
    │   └── tests/holdout/
    └── 02-output-format/
        ├── spec.md
        └── tests/holdout/
```

Later phases always include earlier phases' holdout tests, so regressions to earlier work fail the gate mechanically. Critics are an optional fourth layer that runs *after* a phase's gate passes — useful for security review, performance budgets, or any adversarial check you want automated.

A minimal `feature.yml` for a phased feature:

```yaml
phases:
  defaults:
    critics: [security]
```

The annotated examples at `saifctl/features/_phases-example/` and `saifctl/features/_phases-and-critics/` are runnable — read them when you are ready to go deeper. This tutorial does not try to cover phased features fully.

---

## Observing a run

To step inside the agent's container after a failure:

```bash
saifctl run inspect <runId>
```

This starts the saved container and makes it available for VS Code Dev Containers attachment. You can browse the in-container workspace, read the agent's commits, and make edits. Then continue the loop from your edits:

```bash
saifctl run start <runId>
```

See [Inspect and resume a run](../how-tos/inspect-and-start.md) for the full walkthrough.

---

## Where to go next

- **[Gate, Reviewer, and Holdout](../concepts/gate-reviewer-holdout.md)** — detailed mechanics of the three-stage gauntlet and how critics compose with it.
- **[feat-run-loop](../concepts/feat-run-loop.md)** — the convergence loop, timeout options, and how phased features extend the loop.
- **[features](../concepts/features.md)** — the full feature directory layout as a concept reference.
- **[Feature lifecycle](../concepts/feature-lifecycle.md)** — the proposal → design → build → ship arc.
- **`saifctl/features/_phases-example/`** — annotated phased feature with the full contract surface; read this when you are ready to run a real multi-phase feature.
- **`saifctl/features/_phases-and-critics/`** — annotated example that adds critics to the phased layout; shows the full four-layer gauntlet in action.
- **[Run your first feature](../how-tos/run-first-feature.md)** — goal-oriented companion: skip the explanation, get to a merged PR.
- **[SKILL.md](../../../../SKILL.md)** — reference manual for agents driving the spec-driven workflow; denser and more prescriptive than this tutorial.

**Next tutorial (stage 2 of 2):** [spec-to-PR](./spec-to-pr.md) — a faster-paced run through a complete realistic feature, including critics and a multi-phase layout.
