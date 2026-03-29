# saifctl run start

Start again from a **failed** or **interrupted** Run in storage. Continues with the same flow as [`feat run`](feat-run.md).

The new execution uses the same arguments as the original run (unless you override them on the CLI).

## Usage

```bash
saifctl run start <runId> [options]
```

## Requirements

- **Docker daemon** — Same as [`feat run`](feat-run.md).
- **LLM API keys** — Same as `feat run`.

## How to obtain the run ID

The run ID is a random string, e.g. `biehp82`.

At the end of a run, the CLI prints a message like this:

```bash
Start again with:
  saifctl run start <runId>
```

Alternatively, you can obtain the run ID by running `run list`.

```bash
saifctl run list
```

The run ID is the first column in the output.

```
RUN_ID   FEATURE    STATUS  STARTED                    UPDATED
28k7anx  add-login  failed  2026-03-23T18:00:00.000Z   2026-03-23T19:12:12.419Z
5wjddk1  add-login  failed  2026-03-24T00:00:00.000Z   2026-03-24T01:49:10.982Z
```

## Arguments

By default, `run start` uses the same arguments as the original run.

To customize the run, you can use the same flags as [`feat run`](feat-run.md). Use that page as the full argument reference.

Start-from-artifact behavior:

| Item | Behavior |
| ---- | -------- |
| **Positional `runId`** | Required. Identifies the artifact in run storage. Feature and task context come from that artifact. |
| **`--name` / `-n`** | Not used, feature name comes from the Run only. |

## Examples

Start again from a failed run:

```bash
saifctl run start biehp82
```

Start again with a different model:

```bash
saifctl run start biehp82 --model anthropic/claude-3-5-sonnet-latest
```

Start again with a different agent:

```bash
saifctl run start biehp82 --agent aider
```

Custom storage location:

```bash
saifctl run start biehp82 --storage runs=file:///tmp/my-runs
```

## How it works

Each time you run `feat run`, a new [Run](../runs.md) is created and its metadata is stored in run storage. You can start again with `saifctl run start <runId>`.

`run start` re-creates the exact copy of the workspace as it was when the coding agent stopped. It does this by creating a **temporary** git worktree that reconstructs your workspace at the time of the run started. And on top of it, `run start` applies changes made by the agent during the run.

Once the workspace is reconstructed, `run start` follows the same flow as `feat run`: the reconstructed workspace is copied into a container, and AI agent is run until it passes the checks and tests (or reaches the max runs).

## Notes

- `run start` MUST be run in the same git context as the original run. Otherwise the CLI fails with a clear error.

   Example: If you ran `feat run` on a branch with latest commit `abc123`, then the commit `abc123` must still exist when you run `run start`.
   
   We rely on git commits to faithfully reconstruct the workspace, while keeping the Run metadata light.

- The implementation does **not** reject when you start again from a Run that has a `completed` status, but re-running a completed run is usually unnecessary. Consider [`run test`](run-test.md) to re-test the patch only.

- If you set `--storage none` / `runs=none`, the CLI errors and exits non-zero (`Run storage is disabled (--storage none). Cannot start from a Run.`).

## See also

- [Guide: Run lifecycle](../guides/run-lifecycle.md) — `feat run`, `run start`, `run pause`, `run resume`, `run test`, `run apply`
- [Guide: Fix agent mistakes: inspect, then run start](../guides/inspect-and-start.md) — Step-by-step (VS Code / Cursor)
- [Guide: Provide user feedback to the agent](../guides/providing-user-feedback.md) — `run rules` then `run start`
- [Runs](../runs.md) — Storage backends, portability, resumption overview
- [`feat run`](feat-run.md) — Full flag list and new-run behavior
- [`run pause`](run-pause.md) — Pause a run in progress
- [`run list`](run-list.md) — List Run IDs
- [`run info`](run-info.md) — View a saved run (summary JSON)
- [`run test`](run-test.md) — Re-test a stored patch without the coding agent
- [`run apply`](run-apply.md) — Apply run commits to the host repo as a branch
- [`run remove`](run-remove.md) — Delete a Run
