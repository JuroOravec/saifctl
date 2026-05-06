# Run OpenClaw safely with saifctl sandbox

If you want to run openclaw in a Docker sandbox — so the agent cannot touch your real project until you say so — `saifctl sandbox` gives you that in one command. This page shows you how to run OpenClaw safely, understand what stays in the container versus your host, and apply changes when you are ready.

## Prerequisites

- Docker is installed and running.
- `saifctl` is installed (`saifctl --version` should return a version number).
- Your project is a git repository (required if you plan to use `--extract`).

**Key concept:** saifctl copies your workspace into the container. The agent reads and writes that copy; your host files are untouched. Nothing persists back to your host unless you pass `--extract`. See [Docker isolation](../concepts/docker-isolation.md) for details.

> **Important:** By default, only committed (tracked and clean) files are copied into the container. Uncommitted edits and untracked files are excluded. If the agent needs to see your in-progress work, pass `--include-dirty` to include those files.

## Steps

### 1. Run OpenClaw in the sandbox

> **Note:** OpenClaw maps to the `openhands` agent profile in saifctl. `--agent openhands` is also the default, so you can omit the flag when running OpenClaw.

```bash
saifctl sandbox --agent openhands --task "your task description here"
```

The agent runs to completion inside an ephemeral container. When it finishes the container is destroyed, and your host working tree is unchanged.

### 2. Verify the task completed

Check the run output in your terminal. The agent's work stays inside the container until you opt in to extraction.

### 3. Apply the changes to your host (optional)

When you are satisfied with the run, add `--extract` to bring the agent's changes back:

```bash
saifctl sandbox --agent openhands --task "your task description here" --extract
```

saifctl takes the agent's git diff from inside the container and applies it to your host working tree via `git apply`. Your files are updated in place.

To apply only changes under a specific path:

```bash
saifctl sandbox --agent openhands --task "your task description here" \
  --extract \
  --extract-include src/
```

To exclude a nested path from extraction:

```bash
saifctl sandbox --agent openhands --task "your task description here" \
  --extract \
  --extract-include src/ \
  --extract-exclude src/generated/
```

### 4. Review the result

After extraction, inspect the changes with your normal git workflow:

```bash
git diff
git status
```

Nothing is committed automatically. You decide what goes into version control.

## See also

- [Docker isolation](../concepts/docker-isolation.md) — how the container boundary works and why `--extract` is opt-in
- [Sandbox mode](../concepts/sandbox.md) — concept guide for sandbox mode and when to use it vs. Factory mode
- [saifctl sandbox reference](../../../references/commands/sandbox.md) — full CLI reference with all flags and defaults
- [Apply OpenClaw output to your project](apply-agent-changes.md) — detailed guide to `--extract`, `--extract-include`, and `--extract-exclude`
