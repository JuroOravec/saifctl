# saifac run inspect

Open an **idle** coding environment for a **saved run** — the same kind of isolated workspace and container setup as when you [`run resume`](run-resume.md), but **without** starting the automated agent. The container stays running so you can attach your editor or a shell, edit the code yourself, then finish when you are done.

When you stop the command (**Ctrl+C**, or the process is stopped with **SIGTERM**), saifac shuts the session down, picks up any edits you made in that workspace, and **updates the saved run** if something actually changed. If nothing changed, the saved run is left as-is.

## Usage

```bash
saifac run inspect <runId> [options]
```

## Requirements

- **Docker daemon** — Same as [`feat run`](feat-run.md).
- **LLM API keys** — Same as `feat run` (your profile may still expect them even though the agent loop is not started here).

## How to obtain the run ID

Same as [`run resume`](run-resume.md): use the id from the end of a run, or from `saifac run list` / `saifac run ls` (first column).

```bash
saifac run list
```

## Flags overview

By default, options follow the **saved run**, like resume. You can override many of them the same way as [`feat run`](feat-run.md); use that page as the full reference.

Inspect-specific notes:

| Item | Behavior |
| ---- | -------- |
| **Positional `runId`** | Required. Identifies the saved run. Feature and task context come from that run. |
| **`--name` / `-n`** | Not used; the feature comes from the stored run only. |
| **`--leash`** | Run the idle container **under Leash/Cedar** (same as the coding agent). Default is **off** so you can run `git commit` inside the container. |

Other flags from `feat run` (models, agent profile, sandbox paths, images, `--verbose`, etc.) are accepted when they affect the coding environment.

Options that only apply to automated tests or push/PR steps have **no effect** here — `inspect` does not run those steps.

## Examples

With the Run ID `eed5lz6`:

```bash
saifac run inspect eed5lz6
```

Override the model (same rules as `feat run`):

```bash
saifac run inspect eed5lz6 --model anthropic/claude-4-6-sonnet-latest
```

Match the coding agent’s Leash/Cedar environment:

```bash
saifac run inspect eed5lz6 --leash
```

## What it does

1. Loads the saved run for the ID you gave.
2. Rebuilds a **temporary copy** of your project in the same way as [`run resume`](run-resume.md).
3. Copies that into the sandbox and starts the **coding container** in an idle mode (waiting for you to attach).
4. Logs the **container name** and workspace path. Attach with **Dev Containers**, **`docker exec`**, or your usual workflow.
5. When you stop the command, saifac saves the changes you made into the saved run, and tears the session down.

## Notes

- Run `inspect` from the **same git repository (and branch history)** as the original run, like resume and [`run test`](run-test.md). If the base commit is gone, you will get a clear error.

- If run storage is disabled (`--storage none` / `runs=none`), the command exits with an error (`Run storage is disabled … Cannot inspect a stored run.`).

- Concurrency: When saving changes you made in the container, `saifac` has protection from race conditions. If `saifac` detects that the Run was modified in the meantime, it will write your steps to a fallback file **`.saifac-inspect-stale-<runId>.json`** next to the project root instead of overwriting — check the CLI message for what to do next.


## See also

- [Guide: Fix agent mistakes with inspect + resume](../guides/inspect-and-resume.md) — Step-by-step (VS Code / Cursor)
- [Runs](../runs.md) — Saved runs and storage
- [`run resume`](run-resume.md) — Continue with the agent after a failure
- [`run list`](run-list.md) — List saved run ids
- [`run info`](run-info.md) — View a saved run (summary JSON)
- [`run test`](run-test.md) — Re-run tests for a saved run without the agent
- [`feat run`](feat-run.md) — Full flag list and new-run behavior
