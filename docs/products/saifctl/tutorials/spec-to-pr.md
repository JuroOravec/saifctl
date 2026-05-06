# Spec to PR: a complete feature walkthrough

**What you will have by the end:** a PR opened from a phased feature, with a clear mental model of how the convergence loop and the gauntlet interact — phase by phase, check by check.

This is stage 2 of 2. It builds on the vocabulary from [Spec-driven development with saifctl](./spec-driven-development.md) and moves at a faster pace. Commands are the same; the focus is on mechanics that matter when something goes wrong or you want to go all the way to a merged PR.

---

## The scenario

You are adding a `--format csv` flag to a `saifctl run list` command. The feature has two natural seams: flag parsing and output formatting. You will split it into phases, attach a critic, and open the PR automatically.

---

## Step 1 — Write the spec

Create the feature directory and populate both phases:

```
saifctl/features/csv-export/
├── feature.yml
├── critics/
│   └── contract.md
└── phases/
    ├── 01-flag/
    │   ├── spec.md
    │   └── tests/holdout/
    └── 02-output/
        ├── spec.md
        └── tests/holdout/
```

**`phases/01-flag/spec.md`** — describe only the flag's surface contract:

```markdown
# csv-export / phase 01: flag parsing

Add `--format csv` to `saifctl run list`.

Acceptance criteria:
- `--format` accepts `table` (existing default) and `csv` (new value).
- Any other value exits with code 2 and an error to stderr.
- `--format csv` produces UTF-8 CSV on stdout; no change to `--format table` output.
- Exit code is 0 on success.
```

**`phases/02-output/spec.md`** — describe the CSV shape precisely:

```markdown
# csv-export / phase 02: CSV output

CSV output from `saifctl run list --format csv` must:
- Include a header row: `id,status,started_at,finished_at`.
- Represent each run as one data row with the same fields.
- Properly quote fields that contain commas or newlines (RFC 4180).
- Produce valid CSV parseable by standard libraries.
```

The Reviewer will diff every agent commit against these specs. Precise acceptance criteria produce precise code; vague specs produce vague results.

---

## Step 2 — Add holdout tests

Holdout tests are hidden from the agent during implementation — the agent never reads the `tests/holdout/` subdirectory. That is the guarantee: the agent cannot observe the tests, so it cannot tailor code to pass them by inspection.

```
phases/01-flag/tests/holdout/flag.spec.ts
phases/02-output/tests/holdout/csv.spec.ts
```

A minimal holdout test for phase 1:

```typescript
// phases/01-flag/tests/holdout/flag.spec.ts
test("unknown format value exits 2", async () => {
  const { code } = await run("saifctl run list --format xml");
  expect(code).toBe(2);
});
```

A minimal holdout test for phase 2:

```typescript
// phases/02-output/tests/holdout/csv.spec.ts
import { parse } from "csv-parse/sync";

test("csv output parses as valid RFC 4180", async () => {
  const { stdout } = await run("saifctl run list --format csv");
  const rows = parse(stdout, { columns: true });
  expect(rows[0]).toHaveProperty("id");
  expect(rows[0]).toHaveProperty("status");
});
```

These are the tests the loop enforces. The agent will not see them until after its code is submitted to the gate.

---

## Step 3 — Configure `feature.yml`

```yaml
# saifctl/features/csv-export/feature.yml
branch: feat/csv-export
phases:
  defaults:
    critics: [contract]
```

`critics: [contract]` attaches `critics/contract.md` to every phase. After each phase's Gate passes, saifctl runs the critic to inspect the phase's commits and produce a findings file. Each critic adds a discover subtask (which writes findings) and a fix subtask (where the agent resolves them); once the fix subtask completes, the Gate runs again before the phase is considered done.

---

## Step 4 — Preview the subtask plan (optional)

Before committing run time, see what saifctl will execute:

```bash
saifctl feat phases compile --name csv-export
```

This prints the full subtask plan: implementer → gate → reviewer → holdout → critic discover → critic fix, for each phase in order. Use it to catch config mistakes — missing spec files, bad critic references — before the container starts.

---

## Step 5 — Run the feature

```bash
saifctl feat run --name csv-export --push origin --pr
```

`--push origin --pr` tells saifctl to push the branch and open the PR as soon as the final check passes. Without it, saifctl stops at a passing run but does not touch the remote.

What happens inside the loop:

1. saifctl copies your workspace into an ephemeral container and starts phase `01-flag`.
2. **Implementer subtask** — the agent reads `phases/01-flag/spec.md` and writes code.
3. **Gate** — linters, type-checkers, and static analysis run. Failures go back to the agent.
4. **Reviewer** — an adversarial AI diffs the accumulated changes from the run's initial base commit to HEAD. It checks the diff against your spec. Failures go back to the agent.
5. **Holdout tests** — the full `phases/01-flag/tests/**` directory, plus feature-level `tests/**` and project-level `tests/**`, run against the agent's output. Failures go back to the agent.
6. The loop repeats steps 2–5 until all three pass.
7. **Critic round** — `contract.md` inspects the phase's commits via `git log <baseRef>..HEAD` and writes findings. The agent resolves them in a fix subtask.
8. Phase `01-flag` is done. Phase `02-output` starts and the same sequence runs again — this time the holdout scope is cumulative: project-level `tests/**`, feature-level `tests/**`, all prior phases' tests, and phase `02-output`'s own tests.
9. When phase `02-output` clears all checks: saifctl pushes the branch and opens the PR.

You are not notified until the code emerges. There is nothing to babysit.

---

## Step 6 — Monitor progress

```bash
saifctl run list
saifctl run info <run-id>
```

Each line in the run log names the subtask and the check result. You can see exactly which phase the agent is on, which gate check failed, and how many inner rounds the agent has taken.

**Two timeouts bound the loop.** `--subtask-timeout` (default 1 hour) resets per subtask; if a single implementer or fix round runs over an hour, that subtask is aborted and the run enters `interrupted` state. `--run-timeout` (default unbounded) is the total wall-clock budget across all subtasks — useful if you want a hard cap. Either timeout saves the run artifact so you can resume:

```bash
saifctl run start <run-id>
```

---

## Step 7 — Steer the agent when it goes wrong

If the agent is heading in the wrong direction — writing the wrong abstraction, ignoring a spec constraint — you can inject feedback without stopping the run:

```bash
saifctl run rules create <run-id> --content "Use the existing CSVWriter class in pkg/output; do not add a new dependency."
```

The rule lands on the next inner round. The current round completes first; you do not interrupt it. For a rule you want to persist across all future rounds:

```bash
saifctl run rules create <run-id> --content "Never rename exported symbols." --scope always
```

For the full feedback workflow — updating, removing, and verifying rules — see [Steer an agent mid-run with feedback rules](../how-tos/provide-feedback.md). For a more surgical fix — editing the agent's code directly inside the container — see [Inspect a run's sandbox and continue from your edits](../how-tos/inspect-and-start.md). Run rules and inspect-and-start compose: steer with rules while the run is live, then drop into the container for direct edits if rules are not enough.

---

## Step 8 — Review the PR

When the run completes:

```
Gate:     PASS
Reviewer: PASS
Holdout:  PASS
PR opened: https://github.com/your-org/your-repo/pull/...
```

Verify three things:

1. **PR diff** — touches only files consistent with the spec; no unrelated changes.
2. **CI on the PR** — your existing test suite runs against the agent's output exactly as it would for a human PR.
3. **Run log** — saifctl surfaces any deviations the agent made from the spec or plan during the run.

The holdout guarantee composes across phases: when phase `02-output` ran, all of phase `01-flag`'s tests were in scope. A regression to flag parsing would have failed the gate on phase 2. There is no separate regression suite to configure.

---

> For a deep dive on how the Reviewer works — including why the agent cannot game it — see [Gate, Reviewer, and Holdout](../concepts/gate-reviewer-holdout.md).

---

## Where to go next

You have now taken a feature from a blank directory to a merged PR. From here:

- **[Gate, Reviewer, and Holdout](../concepts/gate-reviewer-holdout.md)** — the detailed mechanics of all four layers, including how critics are parameterised with `{{phase.baseRef}}`.
- **[How the feat run loop works](../concepts/feat-run-loop.md)** — subtask graph, timeout semantics, and the per-phase test scope guarantee.
- **[Understand saifctl's safety guarantees](../how-tos/understand-safety-guarantees.md)** — confirmation that regressions are mechanically prevented, not hoped for.
- **[Run your first feature](../how-tos/run-first-feature.md)** — goal-oriented how-to for running a complete feature end-to-end, skipping the tutorial pacing.
- **`saifctl/features/_phases-and-critics/`** — runnable annotated example with the full four-layer gauntlet.

You are ready to apply this workflow to production features.
