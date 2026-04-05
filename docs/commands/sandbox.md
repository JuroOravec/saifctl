<!--
doc-meta:
  happy-paths:
    - Why use this coomand
    - Explain command usage
    - Explain isolation
    - Explain extract
  out-of-scope:
    - Code examples for "Extract" section - too niche
  next:
    - ../sandbox.md
  audience:
    - end-users
-->

# saifctl sandbox

Run an agent in an [isolated environment](../sandbox.md). Use with OpenClaw or other agents.

Agent runs in a Docker container with a copy of your workspace. Agent can't touch your machine.

Nothing is written to your machine by default. Use `--extract` to apply the agent’s changes to your working tree.

## Usage

```bash
saifctl sandbox [options]
```

## Arguments

The arguments are the same as [`feat run`](feat-run.md), except for the following:

| Argument            | Alias | Type    | Description                                                                                    |
| ------------------- | ----- | ------- | ---------------------------------------------------------------------------------------------- |
| `--task`            | `-t`  | string  | Task prompt for the agent. Required unless `--task-file` is set.                               |
| `--task-file`       | —     | string  | Path to a file whose contents become the task (relative to `--project-dir` if not absolute).   |
| `--name`            | `-n`  | string  | Label for the run (kebab-case). Default: random `scratch-*`.                                   |
| `--extract`         | —     | boolean | Apply the agent’s git changes to the host working tree after the run.                         |
| `--extract-include` | —     | string  | Repo-relative prefix: only apply changes under this path (requires `--extract`).                 |
| `--extract-exclude` | —     | string  | Repo-relative prefix: exclude from the extracted changes (requires `--extract-include`).                   |

## Examples

**Isolation only** — non-coding agents; nothing written to the host:

```bash
saifctl sandbox --agent openclaw --task "Write email to customer X about feature Y"
```

**Extract to working tree** — When your agent writes or modifies files:

```bash
saifctl sandbox --agent openhands --extract --task "write marketing page for feature X"
```

## Notes

- This command uses the same Docker isolation as [`feat run`](feat-run.md), but skips tests, the reviewer, and the staging step.

## See also

- [Sandbox](../sandbox.md) — guide and use cases
- [Agents](../agents/README.md)
- [Models](../models.md)
- [Security & isolation](../security.md)
- [feat run](feat-run.md)
