# Steer an agent mid-run with feedback rules

If you need to fix agent direction, add feedback to an agent, or apply `saifctl run rules` to redirect a run that is heading the wrong way — without restarting — this guide shows you how.

Run rules are short plain-language instructions injected into the agent's task prompt. The agent picks them up on the **next inner round**, not mid-round. You can add, update, or remove rules while the run is live, or set them up before resuming a stopped run.

Each rule has a **scope**: `once` (the default) injects the rule into the next round only and then marks it consumed; `always` injects it into every future round until you remove it.

## Prerequisites

- A run ID — from `saifctl run list` or run output
- The run must be in `running` state for live feedback, or `failed`/`interrupted` state for offline feedback before `saifctl run start`

If you are not familiar with how rounds and subtasks work, see [The `feat run` convergence loop](../concepts/feat-run-loop.md).

## Steps

### 1. Add a rule

```bash
saifctl run rules create <runId> --content "Do not rename existing exported symbols."
```

For longer instructions, use a file:

```bash
saifctl run rules create <runId> --content-file feedback.txt
```

Pass `--scope always` to inject the rule into every future round instead of just the next one (the default is `--scope once`):

```bash
saifctl run rules create <runId> --content "Always prefer async/await." --scope always
```

The command returns a rule ID. By default (`--scope once`) the rule fires on the next inner round only and is then marked consumed. Use `--scope always` if you want it to persist across all future rounds.

### 2. Verify the rule was recorded

```bash
saifctl run rules list <runId>
```

The output shows each rule's **ID**, **SCOPE**, **CONSUMED** status (`yes` / `no`), and **CONTENT** (truncated to 64 characters). SCOPE and CONSUMED are particularly useful for checking whether a `once` rule has already fired.

To read a specific rule:

```bash
saifctl run rules get <runId> <ruleId>
```

### 3. Wait for the next inner round

The agent reads the updated task prompt at the **start of its next inner round**. If the run is live and the agent is currently mid-round, your rule takes effect when that round completes and the next one begins. You do not need to interrupt or restart the run.

If the run is stopped (`failed` or `interrupted`), add your rules first, then resume:

```bash
saifctl run start <runId>
```

### 4. Update or remove a rule

To revise a rule after the agent has seen it:

```bash
saifctl run rules update <runId> <ruleId> --content "Updated instruction here."
```

To remove a rule entirely:

```bash
saifctl run rules rm <runId> <ruleId>
```

Removed rules are not injected into future rounds.

## Verification

After the next inner round starts, `saifctl run rules list <runId>` continues to show your active rules. Monitor run output to confirm the agent's behavior has shifted in the intended direction.

## Run rules vs. inspect-and-start

| | Run rules | Inspect-and-start |
|---|---|---|
| **What you provide** | Plain-language instructions | Direct code edits in the container |
| **When agent sees it** | Next inner round | On `run start` after your edits |
| **Requires stopping the run** | No (live mode) | Yes |

You can combine both: steer with rules while a run is live, then inspect the container and edit code directly before a resume if the rules alone are not sufficient. See [Inspect a run's sandbox and continue from your edits](./inspect-and-start.md).

## See also

- [The `feat run` convergence loop](../concepts/feat-run-loop.md) — how inner rounds, subtasks, and the gate pipeline work
- [Inspect a run's sandbox and continue from your edits](./inspect-and-start.md) — edit code directly inside the container
- [`saifctl run` reference](../../../references/commands/run.md)
- [`saifctl run rules` reference](../../../references/commands/run-rules.md)
