---
source: src/cli/commands/run.ts
type: cli-command
---

Run-lifecycle management. A "Run" is a persisted execution of `feat run` or `sandbox` — saifctl saves run state to storage (local `.saifctl/runs/` by default; `file://`, `s3`, `none` also supported) so users can resume, fork, inspect, or apply changes after the fact. Subcommands:

- `ls` (alias `list`) — list runs with optional `--status` / `--task` / `--format=table|json` filters.
- `info` / `get` — print metadata for a single run.
- `inspect` — open an idle container reproducing the run's workspace state for manual inspection.
- `start` — start fresh from a failed/interrupted run (same args as the original unless overridden).
- `resume` — continue a paused run from where it stopped.
- `pause` — pause a running run; preserves sandbox + Docker network.
- `stop` — stop a running/paused run with full teardown; the run becomes `failed`. Differs from `pause` by tearing the sandbox down.
- `fork` — branch off a saved run as a starting point for a new run.
- `apply` — apply a run's git changes to the host working tree.
- `export` — export run artifacts (workspace tree, logs, diff) to a directory or tarball.
- `rm` (alias `remove`) — delete a saved run from storage.
- `clear` — bulk-remove runs by filter.
- `test` — re-run a saved run's holdout tests against its final state.

`run rules` is a separate top-level command (see `run-rules.md`) — it manages user-feedback rules attached to a run, and operates while a run is *executing*.
