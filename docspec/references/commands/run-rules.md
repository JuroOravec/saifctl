---
source: src/cli/commands/run-rules.ts
type: cli-command
---

Manage **user-feedback rules** attached to a run. Rules are injected into the agent task prompt and let users steer a coding agent live (rules added during execution are picked up on the next inner round). Subcommands: `create` (with `--content` or `--content-file`), `ls` (alias `list`), `get`, `update`, `rm` (alias `remove`).

Note: separate from `run` — this is its own top-level command because it operates *while* a run is executing, not on completed runs in storage.
