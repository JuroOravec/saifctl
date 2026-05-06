# Sandbox mode

Sandbox mode (`saifctl sandbox`) lets you run any agent CLI — including OpenClaw — inside an ephemeral Docker container. Your host machine is untouched unless you explicitly ask for output back. No specs, no tests, no convergence loop required.

## What the boundary guarantees

When you invoke `saifctl sandbox`, saifctl copies your project into the container. The agent sees that copy, not your real working tree. Every filesystem, process, and network boundary is enforced by Cedar policies via Leash. When the session ends the container is destroyed; nothing persists on your host.

Think of it like browser private/incognito mode, but for code-editing agents: whatever the agent does stays inside the session. Or like starting from a VM snapshot — you always get a clean slate, and throwing away the changes is the default.

For the lower-level mechanics (Cedar, Leash, copy-not-mount, container teardown), see [Docker isolation](docker-isolation.md).

## Two ways to run inside sandbox

**Non-interactive (autonomous):** pass a task and the agent runs to completion on its own, then exits.

- `--task "..."` — inline task string
- `--task-file <path>` — task loaded from a file
- `--subtasks <path>` — run a list of subtasks in sequence

**Interactive:** drop into a bash shell inside the container.

- `--interactive` — gives you a live shell; you can inspect files, run commands, or set up the environment manually before handing off to the agent

## Getting output back: `--extract`

By default, nothing leaves the container. When you pass `--extract`, saifctl takes the agent's git diff from inside the container and applies it to your host working tree via `git apply`. Your host files are updated in place — there is no separate output directory.

```
saifctl sandbox --task "..." --extract
```

You can narrow what gets applied:

- `--extract-include <path-prefix>` — only apply hunks under this repo-relative path prefix (requires `--extract`)
- `--extract-exclude <path-prefix>` — exclude hunks under this repo-relative path prefix from the applied patch (requires `--extract-include`)

## How sandbox differs from Factory mode

Factory mode (`saifctl feat run`) runs agents through a convergence loop with a Gate, Reviewer, and Holdout tests, storing each run. Sandbox intentionally skips all of that:

| | Sandbox | Factory |
|---|---|---|
| Gate | No | Yes |
| Reviewer | No | Yes |
| Holdout tests | No | Yes |
| Attempts | Single | Convergence loop |
| Run storage | No (default) | Yes |
| Spec required | No | Yes |

## When to use sandbox

Sandbox is the right choice when you want a safe place to run an agent without committing to a full spec-driven workflow:

- **Research and exploration** — try an approach without touching your working tree
- **Marketing copy or documentation** — one-off generation tasks that don't need test gates
- **One-off agent tasks** — anything that doesn't map to a feature spec
- **Manual environment setup** — use `--interactive` to configure a container before running an agent inside it

When you need correctness guarantees, regression prevention, and a traceable run history, use Factory mode (`saifctl feat run`) instead.
