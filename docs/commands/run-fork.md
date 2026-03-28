# saifctl run fork

Copy an existing stored [Run](../runs.md) to a **new run ID**. The new artifact keeps the same git snapshot as the source run.

Any flags you pass are **saved as defaults** on the new Run.

After forking, start execution with [`run start`](run-start.md) on the **new** ID.

The original run is unchanged.

## Usage

```bash
saifctl run fork <sourceRunId> [options]
```

## How to obtain the source run ID

Use [`run list`](run-list.md), or use the ID printed when a run ends ([`feat run`](feat-run.md) or [`run start`](run-start.md)).

## Arguments

You can pass the **same options as [`feat run`](feat-run.md)** (models, agent, scripts, `--max-runs`, `--storage`, `--verbose`, etc.).

Given flags will be saved as new defaults.

The rest of the defaults will be set from the old Run's config.

Fork-specific behavior:

| Item | Behavior |
| ---- | -------- |
| **Positional `sourceRunId`** | Required. Run to copy from. |

## Examples

Fork a run:

```bash
saifctl run fork biehp82
```

Fork and set the default model:

```bash
saifctl run fork biehp82 --model anthropic/claude-3-5-sonnet-latest
```

The CLI prints the new run ID and:

```text
Start the agent with:
  saifctl run start <newRunId>
```

## Notes

- Use fork when you want **two independent run IDs** pointing at the same stored workspace state—for example, one branch of experiments vs. another, or avoiding a sandbox name clash (see the hint in sandbox errors).
- If run storage is disabled, the CLI exits with an error (`Run storage is disabled (--storage none). Cannot fork a stored run.`).

## See also

- [`run start`](run-start.md) — Start the agent loop
- [`feat run`](feat-run.md) — Full flag list
- [Runs](../runs.md) — Run storage overview
- [`run list`](run-list.md) — List run IDs
