# Run lifecycle

A **Run** is a saved attempt pipeline — a named, resumable record of work that saifctl tracks from first invocation through final outcome. Understanding how a Run moves through its states helps you recover from interruptions, interpret the run log, and control how many agent attempts each subtask gets.

## What a Run is

When you execute `saifctl feat run`, saifctl creates a Run identified by a run ID. The Run stores:

- **Metadata** — feature ID, status, timestamps, flags used.
- **Patch history** — the sequence of git commits produced by each agent attempt, written to the configured storage backend (`local`, `file://`, `s3`, or `none`).

Because patch history is persisted externally, you can resume or restart a Run after a crash, a timeout, or a deliberate pause — without losing the work already committed.

## Status machine

A Run moves through a fixed set of statuses:

```
running ──► completed
   │
   ├──► paused ──► running  (via run resume)
   │
   └──► failed ──► running  (via run start)
```

- **running** — the active state; at least one subtask is in progress.
- **paused** — you called `saifctl run pause`; the sandbox and Docker network are preserved in cache.
- **failed** — an in-container error, an unrecoverable agent failure, or a timeout ended the run.
- **completed** — all subtasks reached their gate; the Run is done.

There is no direct transition from `paused` to `completed`; a paused run must be resumed first.

## Pause vs stop

These two commands both halt a running Run, but they leave the system in very different states.

| | `saifctl run pause` | `saifctl run stop` |
|---|---|---|
| Sandbox container | Stopped (not deleted) | Torn down |
| Docker network | Preserved | Removed |
| Resume path | `run resume` (fast) | `run start` (rebuild) |
| Use when | You plan to continue soon | You are done or starting over |

Think of it like the difference between suspending a process (`SIGSTOP`) and killing it (`SIGKILL`): pause halts the containers and preserves their state on disk so that resume is fast; stop frees all resources and makes recovery more expensive.

## Resuming vs restarting

**`saifctl run resume <id>`** is for paused runs. When the sandbox cache is present, resume re-enters the exact subtask that was in progress — no rebuild required. If the cache has been evicted (the container or network is gone), resume falls back to `start` semantics automatically.

**`saifctl run start <id>`** is for failed or interrupted runs. It reconstructs the workspace from git plus the saved patch history and re-runs from the last incomplete subtask. Do not use `run start` on a paused run — use `run resume`.

The analogy: `run resume` is like `git stash apply` (state is right there, just restore it); `run start` is like `git rebase --continue` after a crash (replay the history to get back to where you were).

## Subtask granularity

Pause and resume work at the **subtask** level, not the run level. For a phased feature run, each phase and each critic round is a subtask. When you resume, saifctl re-enters at the same subtask cursor — the subtask that was interrupted restarts from its beginning, not from the middle of an agent turn.

This means partial work within a subtask is not re-applied; the agent retries that subtask from scratch. Work from all previously completed subtasks is already committed to patch history and is not repeated.

## `--max-runs` is per subtask

The `--max-runs` flag controls how many agent attempts are allowed **per subtask**. It is not a global cap on the entire Run. If a subtask needs three attempts before passing its gate, that counts as three runs against `--max-runs` for that subtask. A separate subtask starts fresh against the same limit.

## Timeouts

Two timeout flags control how long saifctl waits before treating a run as failed:

- `--run-timeout` — total wall-clock time for the entire Run. Default: `none` (unbounded).
- `--subtask-timeout` — wall-clock time for a single subtask. Default: `1h`. If you do not set this flag, each subtask is silently subject to a one-hour wall-clock limit; exceeding it triggers a `failed` transition.

When either limit is exceeded, saifctl saves the run artifact exactly as it would for an in-container error and transitions the Run to `failed`. Recover with `saifctl run start <id>`.

CLI flags override the corresponding defaults in your config file (`defaults.timeouts.run` and `defaults.timeouts.subtask`).

## Related

Reference pages for the commands and storage backends below are forthcoming:

- `saifctl run pause` — pause a running run
- `saifctl run resume` — resume a paused run
- `saifctl run start` — restart a failed run
- `saifctl run stop` — stop and tear down a run
- Storage backends — where run metadata and patch history are saved
