# Agent: debug

Run fast end-to-end smoke checks of the orchestration loop without LLM latency. Invoke with `saifctl feat run --agent debug`.

## Overview

The **debug** profile is a built-in agent that calls no LLM and installs no agent CLI. It is designed to verify that the orchestration pipeline (startup scripts, gate, staging, tests) works correctly without the cost or delay of a real coding agent.

`agent-install.sh` is a no-op. `agent.sh` writes a minimal `dummy.md` at the workspace root and exits 0.

For real code changes, use a full agent profile (`claude`, `openhands`, `aider`, etc.) or `--agent-script`.

## What the agent does

1. Optionally performs an HTTP network probe (exercises Leash `NetworkConnect` policy).
2. Optionally waits for a human-feedback file (manual Cedar policy test only).
3. Writes `dummy.md` at `$SAIFCTL_WORKSPACE_BASE` (default `/workspace`) with fixed content expected by the bundled `dummy` saifctl feature.
4. Exits 0.

## Output file

`$SAIFCTL_WORKSPACE_BASE/dummy.md` (default `/workspace/dummy.md`).

Content is a fixed placeholder with H1 `Dummy`, and sections `Purpose`, `Structure`, `Next Steps`. These match the public structure checks in the bundled `dummy` feature.

## Prerequisites

When the network probe is active (i.e. `SAIFCTL_SKIP_NETWORK_PROBE` is unset), `curl` must be present in the environment. If `curl` is not found the agent exits 1 with an error. In minimal images or unit-test environments, set `SAIFCTL_SKIP_NETWORK_PROBE=1` to bypass the probe.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SAIFCTL_WORKSPACE_BASE` | No | `/workspace` | Workspace root. `dummy.md` is written here. |
| `SAIFCTL_SKIP_NETWORK_PROBE` | No | unset | Set to any non-empty value to skip the HTTP network probe entirely (useful in unit tests). |
| `SAIFCTL_NETWORK_PROBE_URL` | No | `https://example.com` | URL used for the network probe `GET` request (15 s timeout). |
| `SAIFCTL_DEBUG_REQUIRE_HUMAN_FEEDBACK` | No | unset | Set to any non-empty value to enable the manual human-feedback test: the agent waits 10 s for a pending-rules file and asserts it contains the exact string `Say hello in a comment in src/foo.ts`. |
| `SAIFCTL_TASK_PATH` | No | `/workspace/.saifctl/task.md` | Path to the task file. Used only when `SAIFCTL_DEBUG_REQUIRE_HUMAN_FEEDBACK` is set to locate the pending-rules file. |
| `SAIFCTL_PENDING_RULES_PATH` | No | `$(dirname $SAIFCTL_TASK_PATH)/pending-rules.md` | Explicit path to the pending-rules file. Overrides the default derived from `SAIFCTL_TASK_PATH`. Used only when `SAIFCTL_DEBUG_REQUIRE_HUMAN_FEEDBACK` is set. |

## Usage examples

**Smoke-test the pipeline for a feature:**

```bash
saifctl feat run --agent debug --feature my-feature-id
```

**Skip the network probe (e.g. in a unit test environment):**

```bash
SAIFCTL_SKIP_NETWORK_PROBE=1 saifctl feat run --agent debug --feature my-feature-id
```

**Override the network probe URL:**

```bash
SAIFCTL_NETWORK_PROBE_URL=https://my-internal-host saifctl feat run --agent debug --feature my-feature-id
```

## See also

- [references/agents/claude.md](claude.md) — Claude Code agent profile
- [references/agents/aider.md](aider.md) — Aider agent profile
- [references/agents/codex.md](codex.md) — OpenAI Codex CLI agent profile
- [references/agents/copilot.md](copilot.md) — GitHub Copilot agent profile
- [references/agents/cursor.md](cursor.md) — Cursor agent profile
