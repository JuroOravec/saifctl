# Debug agent profile

The **`debug`** profile is a built-in coding agent that **does not call an LLM** and **does not install any agent CLI**. Use it to iterate quickly on factory behavior (startup scripts, gate, staging, tests) without waiting on OpenHands install or model latency.

**Usage:** `saifac feat run --agent debug`

## Behavior

| Script           | Role                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `agent-install.sh` | No-op: logs once and exits. Skips pip/uv/npm installs.                                  |
| `agent.sh`       | Writes a minimal `dummy.md` at the workspace root (`$SAIFAC_WORKSPACE_BASE`, default `/workspace`). |

Stdout is treated as **`raw`** log format (same as Aider and other non-OpenHands agents).

## When to use it

- End-to-end checks of the orchestration loop with a deterministic “agent” outcome.
- Developing or debugging features whose tests expect a root `dummy.md` (e.g. the bundled `dummy` saifac feature samples).

For real code changes, switch back to a full agent profile (`openhands`, `aider`, etc.) or `--agent-script`.
