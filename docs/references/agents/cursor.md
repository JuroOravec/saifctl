# Agent: cursor

Run tasks headlessly with [Cursor](https://cursor.com), an AI-powered IDE with a headless CLI.

## Usage

```bash
saifctl feat run --agent cursor
```

## Authentication

Cursor requires an active Cursor subscription. Obtain an API key from [cursor.com/dashboard/cloud-agents](https://cursor.com/dashboard/cloud-agents).

| Variable | Description |
|---|---|
| `CURSOR_API_KEY` | Primary auth credential (preferred). |
| `LLM_API_KEY` | Generic fallback; mapped to `CURSOR_API_KEY` if `CURSOR_API_KEY` is not set. |

Pass the key via `--agent-secret CURSOR_API_KEY` to keep it out of logs:

```bash
saifctl feat run --agent cursor --agent-secret CURSOR_API_KEY
```

## Model selection

Set `LLM_MODEL_ID` to a Cursor-managed model identifier. Cursor uses its own model namespace — not `provider/model` strings.

**Examples:**

```
LLM_MODEL_ID=claude-4.6-sonnet-medium
LLM_MODEL_ID=gpt-5.2
LLM_MODEL_ID=gemini-3.1-pro
```

`LLM_BASE_URL` is not supported; Cursor always connects to its own API.

## CLI flags (invoked internally)

| Flag | Description |
|---|---|
| `-p` / `--print` | Non-interactive (headless) mode. |
| `--force` / `--yolo` | Allow file edits without confirmation (required for headless use). |
| `--trust` | Trust the workspace without prompting (required for headless use). |
| `--model <id>` | Cursor model identifier. Passed when `LLM_MODEL_ID` is set. |
| `--output-format stream-json` | Emit newline-delimited JSON events. |

## Installation

The agent script installs the Cursor CLI at runtime if absent:

```bash
curl https://cursor.com/install -fsS | bash
```

Requires `curl` and `bash` in the coder image.

## Privilege model

The agent runs the Cursor CLI as an unprivileged user via `runuser`. Only explicitly whitelisted environment variables (including `CURSOR_API_KEY`) are forwarded into that shell.
