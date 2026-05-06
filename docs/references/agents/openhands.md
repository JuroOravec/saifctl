# Agent: openhands

Run AI-assisted coding tasks headlessly using [OpenHands](https://github.com/OpenHands/OpenHands), the default coding agent. Invoke with `saifctl feat run` (uses openhands by default) or `saifctl feat run --agent openhands`.

## Requirements

OpenHands requires Python. Node-only coder images will fail. Python is installed via `uv` (preferred), `pipx`, or `pip` at runtime when missing.

## Authentication

OpenHands natively uses the same environment variable names that saifctl provides — no mapping needed. The agent always passes `--override-with-envs`, so `LLM_MODEL`, `LLM_API_KEY`, and `LLM_BASE_URL` always override any stored OpenHands settings.

## CLI flags used by the agent

These flags are passed unconditionally on every invocation:

| Flag | Description |
|------|-------------|
| `--headless` | Run without UI. Required for automation. |
| `--always-approve` | Auto-approve all agent actions without confirmation prompts. |
| `--override-with-envs` | Apply `LLM_MODEL`, `LLM_API_KEY`, and `LLM_BASE_URL` from the environment, overriding any stored OpenHands settings. |
| `--json` | Emit JSONL on stdout. Parsed by the factory's OpenHands log formatter. |
| `-t <task>` | Task string to execute. The content of `$SAIFCTL_TASK_PATH` is passed here. |

## Output format

With `--json`, OpenHands emits newline-delimited JSON on stdout. The OpenHands agent profile's `stdoutStrategy` splits and formats these segments for readable CLI output:

| Prefix | Source |
|--------|--------|
| `[think]` | Model reasoning / thought steps |
| `[agent]` | Agent actions |
| `[inspect]` | Observation / inspection results |
| *(unmarked)* | Errors and other output |

## Privilege drop

The agent runs OpenHands as `$SAIFCTL_UNPRIV_USER` via `runuser`. The whitelisted environment is managed by `saifctl_unpriv_env_whitelist` (from `/saifctl/saifctl-agent-helpers.sh`), plus `OPENHANDS_WORK_DIR`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_MODEL` | Yes | Model identifier, passed directly to OpenHands. |
| `LLM_API_KEY` | Yes | API key for the model provider. |
| `LLM_BASE_URL` | No | Base URL override for the model API. |
| `SAIFCTL_TASK_PATH` | Yes | Path to the file containing the task prompt. |
| `SAIFCTL_UNPRIV_USER` | Yes | Unprivileged user to run OpenHands as. Baked into each coder Dockerfile. |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes | npm prefix whose `bin` directory is prepended to `PATH` before invoking `openhands`. |
| `SAIFCTL_WORKSPACE_BASE` | No | Workspace directory (default: `/workspace`). OpenHands is invoked with this as cwd. |
| `OPENHANDS_WORK_DIR` | No | OpenHands state directory (default: `/tmp/openhands-state`). |

## Usage examples

**Run a feature using the default openhands agent:**

```bash
export LLM_MODEL=anthropic/claude-sonnet-4-6
export LLM_API_KEY=sk-ant-…
saifctl feat run --feature my-feature-id
```

**Explicitly select the openhands agent:**

```bash
saifctl feat run --agent openhands --feature my-feature-id
```

**Use a self-hosted model endpoint:**

```bash
export LLM_MODEL=openai/my-local-model
export LLM_API_KEY=none
export LLM_BASE_URL=http://localhost:11434/v1
saifctl feat run --agent openhands --feature my-feature-id
```

## See also

- [OpenHands CLI reference](https://docs.openhands.dev/openhands/usage/cli/command-reference)
