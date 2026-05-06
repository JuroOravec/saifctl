# Apply OpenClaw output to your project

After you run `saifctl sandbox`, the agent's changes live inside the container by default — nothing is written to your host working tree. This guide shows you how to use `--extract` to apply those changes, and how to filter them to specific paths.

## Prerequisites

- You have run `saifctl sandbox` at least once and the agent completed successfully.
- Your project is a git repository (extract uses `git apply` under the hood).

**Key concept:** saifctl copies your workspace into the container; the agent writes to that copy. Nothing reaches your host unless you pass `--extract`. See [Docker isolation](../concepts/docker-isolation.md) for details.

## Steps

### 1. Run sandbox with `--extract`

Add `--extract` to your existing `saifctl sandbox` command:

```bash
saifctl sandbox --agent openhands --task "your task here" --extract
```

When the run finishes, saifctl takes the agent's git diff from inside the container and applies it to your host working tree via `git apply`. Your files are updated in place.

### 2. Limit extraction to a subdirectory (optional)

If the agent touched files you don't want, use `--extract-include` to apply only changes under a specific path prefix. This flag requires `--extract`:

```bash
saifctl sandbox --agent openhands --task "your task here" \
  --extract \
  --extract-include src/
```

Only changes to files under `src/` are applied; everything else is discarded.

### 3. Exclude a nested path (optional)

To drop a subset of the included paths, add `--extract-exclude`. This flag requires `--extract-include`:

```bash
saifctl sandbox --agent openhands --task "your task here" \
  --extract \
  --extract-include src/ \
  --extract-exclude src/generated/
```

Changes under `src/generated/` are skipped; the rest of `src/` is applied.

## Verify the result

After extraction, review the changes with your normal git workflow:

```bash
git diff
git status
```

Nothing is committed automatically. You stay in full control of what goes into version control.

## See also

- [Docker isolation](../concepts/docker-isolation.md) — how the container boundary works and why `--extract` is opt-in
- [Sandbox mode](../concepts/sandbox.md) — understanding how sandbox mode works
- [saifctl feat run](../concepts/feat-run-loop.md) — for correctness-gated, multi-attempt feature runs that promote changes via a branch and PR
