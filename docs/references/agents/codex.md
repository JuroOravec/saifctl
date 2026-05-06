# Agent: codex

Run AI-assisted coding tasks headlessly using [Codex](https://github.com/openai/codex), OpenAI's CLI coding agent. Invoke with `saifctl feat run --agent codex`.

## Installation

Codex is installed automatically at runtime when missing:

```bash
npm install -g @openai/codex
```

Requires `npm` in the coder image.

## Authentication

Set `OPENAI_API_KEY` (or the fallback `LLM_API_KEY`) before invoking the agent. For custom endpoints, set `LLM_BASE_URL` or `OPENAI_BASE_URL`. See the [Environment variables](#environment-variables) section below for full details.

## CLI flags used by the agent

These flags are passed unconditionally on every invocation of `codex exec`:

| Flag | Description |
|------|-------------|
| `exec` | Non-interactive subcommand — run Codex headlessly and exit. |
| `--model <id>` | Model override, sourced from `LLM_MODEL_ID` (bare ID). Do **not** use `LLM_MODEL`; the prefixed `provider/model` form is rejected by Codex's CLI as an unknown model. |
| `-` (prompt arg) | Read the prompt from stdin rather than a string argument. The task file at `$SAIFCTL_TASK_PATH` is piped in. |
| `--dangerously-bypass-approvals-and-sandbox` / `--yolo` | Skip all approval prompts and sandbox restrictions. Safe here because the factory container is already sandboxed by Leash. (`--yolo` is an alias for the longer flag.) |
| `--json` | Emit newline-delimited JSON events. Compatible with the factory's log parser and enables streaming progress. |
| `--ephemeral` | Do not persist session files to disk. Each factory round is independent. |

## Privilege drop

The agent runs `codex` as `$SAIFCTL_UNPRIV_USER` via `runuser`, which resets `HOME`/`PATH` to the unprivileged user's login environment. The CLI binary is installed into `$SAIFCTL_UNPRIV_NPM_PREFIX/bin`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes (or via `LLM_API_KEY`) | OpenAI API key. Falls back to `LLM_API_KEY` when unset. |
| `LLM_API_KEY` | Fallback | Used when `OPENAI_API_KEY` is unset. |
| `LLM_MODEL_ID` | Yes | Bare model ID passed to `--model`. |
| `LLM_BASE_URL` | No | Forwarded as `OPENAI_BASE_URL` for custom endpoints. Ignored if `OPENAI_BASE_URL` is already set. |
| `OPENAI_BASE_URL` | No | Custom endpoint URL. Takes precedence over `LLM_BASE_URL`. |
| `SAIFCTL_TASK_PATH` | Yes | Path to the file containing the task prompt, piped to `codex exec` via stdin. |
| `SAIFCTL_UNPRIV_USER` | Yes | Unprivileged user to run `codex` as. Baked into each coder Dockerfile. |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes | npm prefix where the `codex` binary is installed. |
| `SAIFCTL_WORKSPACE_BASE` | No | Workspace directory (default: `/workspace`). `codex` is invoked with this as cwd. |

## Usage example

```bash
export OPENAI_API_KEY=sk-…
saifctl feat run --agent codex --feature my-feature-id
```

## See also

- [Codex CLI reference](https://developers.openai.com/codex/cli/reference)
