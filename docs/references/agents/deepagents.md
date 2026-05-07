# Agent: deepagents

Run AI-assisted coding tasks using [Deep Agents CLI](https://github.com/langchain-ai/deepagents), LangChain's terminal agent. Invoke with `saifctl feat run --agent deepagents`.

## Installation

Deep Agents is installed automatically at runtime via `uv`, `pipx`, or `pip` with provider extras:

```bash
pip install deepagents[anthropic,groq,openrouter]
```

**Python is required.** Node-only coder images will fail.

## Authentication

`LLM_API_KEY` is mapped to provider-specific environment variables. Native provider keys take precedence if already set.

| Variable             | Provider   | Notes                                                                                                                                                                               |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | OpenAI     | Native key; takes precedence over `LLM_API_KEY`.                                                                                                                                    |
| `ANTHROPIC_API_KEY`  | Anthropic  | Native key; takes precedence over `LLM_API_KEY`.                                                                                                                                    |
| `OPENROUTER_API_KEY` | OpenRouter | Native key; takes precedence over `LLM_API_KEY`.                                                                                                                                    |
| `LLM_API_KEY`        | Any        | Fallback — exported as all three provider keys when native keys are unset.                                                                                                          |
| `GROQ_API_KEY`       | Groq       | Must be set directly. Groq is **not** covered by the `LLM_API_KEY` fallback — the agent only maps `LLM_API_KEY` to `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `OPENROUTER_API_KEY`. |

## Model format

Deep Agents expects models in `provider:model` form (colon-separated, e.g. `openai:gpt-4o`, `anthropic:claude-sonnet-4-5`).

The agent builds this from two env vars:

1. Start with `LLM_MODEL_ID` (bare model ID — **not** `LLM_MODEL`, which is the slash-separated LiteLLM form and would produce a double-prefixed string like `anthropic:anthropic/claude-…`).
2. If the value contains no colon and `LLM_PROVIDER` is set, prepend `${LLM_PROVIDER}:`.

A user who sets `LLM_MODEL_ID` already in `provider:model` form (e.g. via `--agent-env`) bypasses the auto-prefix because the colon check fails.

## Base URL

Deep Agents has no `--base-url` CLI flag. When `LLM_BASE_URL` is set, the agent writes a per-run `config.toml` at `~/.deepagents/factory/config.toml`:

```toml
[models.providers.<LLM_PROVIDER>]
base_url = "<LLM_BASE_URL>"
```

`LLM_PROVIDER` is always set when the orchestrator resolves an LLM config; the agent reads it directly rather than parsing `LLM_MODEL`. When `LLM_PROVIDER` is unset (e.g. when running deepagents ad-hoc outside the orchestrator), the agent falls back to `openai`, so the `config.toml` will always contain a `[models.providers.openai]` section regardless of the actual provider in use.

## CLI flags used by the agent

| Flag                              | Description                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `-n <task>`                       | Non-interactive mode — pass the task text directly; deepagents exits when done.                                                            |
| `-a` / `--agent factory`          | Use the `factory` named-agent, which has its own config and memory dir (`~/.deepagents/factory/`), isolated from the user's default agent. |
| `--auto-approve`                  | Autonomous mode — skip all interactive approval prompts.                                                                                   |
| `--shell-allow-list recommended`  | Enable the recommended set of safe shell commands.                                                                                         |
| `-M` / `--model <provider:model>` | Model in `provider:model` format. Set only when `LLM_MODEL_ID` is non-empty.                                                               |

## Privilege drop

The agent runs `deepagents` as `$SAIFCTL_UNPRIV_USER` via `runuser`, resetting `HOME` and `PATH` to that user's login environment. The `config.toml` base-URL override is written inside the `runuser` shell so the file is owned by the unprivileged user.

## Environment variables

| Variable                    | Required    | Description                                                                                                                                                                                       |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_MODEL_ID`              | No          | Bare model ID (e.g. `gpt-4o`, `claude-sonnet-4-5`). Passed to `--model` after provider prefix is prepended. When unset, `--model` is omitted and deepagents uses its own default model.           |
| `LLM_PROVIDER`              | No          | Provider name (e.g. `openai`, `anthropic`). Prepended to `LLM_MODEL_ID` to form `provider:model`. Also used to scope `config.toml` when `LLM_BASE_URL` is set. Falls back to `openai` when unset. |
| `LLM_API_KEY`               | Fallback    | Exported as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `OPENROUTER_API_KEY` when those are not already set.                                                                                       |
| `OPENAI_API_KEY`            | Conditional | Native OpenAI key. Takes precedence over `LLM_API_KEY`.                                                                                                                                           |
| `ANTHROPIC_API_KEY`         | Conditional | Native Anthropic key. Takes precedence over `LLM_API_KEY`.                                                                                                                                        |
| `OPENROUTER_API_KEY`        | Conditional | Native OpenRouter key. Takes precedence over `LLM_API_KEY`.                                                                                                                                       |
| `LLM_BASE_URL`              | No          | Custom provider base URL. Written to `~/.deepagents/factory/config.toml`.                                                                                                                         |
| `SAIFCTL_TASK_PATH`         | Yes         | Path to the file containing the task prompt. Read by `deepagents -n "$(cat …)"`.                                                                                                                  |
| `SAIFCTL_UNPRIV_USER`       | Yes         | Unprivileged user to run `deepagents` as.                                                                                                                                                         |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes         | npm binary prefix whose `bin/` is prepended to `PATH` inside the `runuser` shell. Baked into the coder image.                                                                                     |
| `SAIFCTL_WORKSPACE_BASE`    | No          | Working directory for the agent (default: `/workspace`).                                                                                                                                          |

## Usage examples

**Run a feature with an Anthropic model:**

```bash
export LLM_API_KEY=sk-ant-…
saifctl feat run --agent deepagents --feature my-feature-id
```

**Run with an OpenAI model specified explicitly:**

```bash
export OPENAI_API_KEY=sk-…
saifctl feat run --agent deepagents \
  --agent-env LLM_PROVIDER=openai \
  --agent-env LLM_MODEL_ID=gpt-4o \
  --feature my-feature-id
```

**Run against a custom base URL (e.g. a local proxy):**

```bash
saifctl feat run --agent deepagents \
  --agent-env LLM_BASE_URL=http://localhost:8080/v1 \
  --feature my-feature-id
```

## See also

- [Deep Agents CLI reference](https://docs.langchain.com/oss/python/deepagents/cli)
