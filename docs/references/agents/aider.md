# Aider agent

Run [Aider](https://github.com/Aider-AI/aider) as a saifctl coding agent. Aider is an AI pair-programmer that supports OpenAI, Anthropic, OpenRouter, Gemini, and any other provider available via [litellm](https://github.com/BerriAI/litellm).

## Requirements

- `uv` must be available in the coder image (the `python-uv*` sandbox profiles satisfy this). Node-only images will fail.
- `aider` is installed automatically by `agent-install.sh` at runtime via `uv tool install aider-chat`; you do not need to install it manually.

## Selecting the agent

```bash
saifctl feat run --agent aider
```

## Model

Aider uses litellm model strings. Pass the model via the `LLM_MODEL` environment variable or the saifctl `--model` flag. The format follows litellm conventions, for example:

| Provider   | Example model string              |
|------------|-----------------------------------|
| Anthropic  | `anthropic/claude-sonnet-4-6`     |
| OpenAI     | `openai/gpt-4o`                   |
| OpenRouter | `openrouter/anthropic/claude-3-5-sonnet` |
| Gemini     | `gemini/gemini-1.5-pro`           |

## API key and base URL

`LLM_API_KEY` is exported as a fallback for all common provider environment variables. Native provider keys take precedence.

| Variable               | Purpose                                              |
|------------------------|------------------------------------------------------|
| `ANTHROPIC_API_KEY`    | Anthropic — native key, takes precedence over `LLM_API_KEY` |
| `OPENAI_API_KEY`       | OpenAI — native key, takes precedence over `LLM_API_KEY`    |
| `OPENROUTER_API_KEY`   | OpenRouter — native key, takes precedence over `LLM_API_KEY` |
| `GEMINI_API_KEY`       | Gemini — native key, takes precedence over `LLM_API_KEY`    |
| `LLM_API_KEY`          | Generic fallback, mapped to all provider keys above  |
| `LLM_BASE_URL`         | Forwarded as `OPENAI_API_BASE` for custom endpoints  |

## Flags used by the agent script

These flags are passed automatically; you do not set them directly.

| Flag                          | Effect                                                                  |
|-------------------------------|-------------------------------------------------------------------------|
| `--model`                     | Selects the model (value from `LLM_MODEL`).                            |
| `--message-file`              | Reads the task from `$SAIFCTL_TASK_PATH`; exits after completion (single-shot mode). |
| `--yes`                       | Auto-confirms all prompts — required for headless operation.           |
| `--no-auto-commits`           | Disables aider's own git commits. saifctl extracts changes via `git diff HEAD` after the agent exits. |
| `--no-check-update`           | Suppresses the update-available banner.                                 |
| `--no-suggest-shell-commands` | Suppresses shell-command suggestions (not useful headlessly).           |

## Privileges

The agent runs under an unprivileged user via `runuser`. The working directory is set to `$SAIFCTL_WORKSPACE_BASE` (default `/workspace`).

## Usage example

```bash
# Run with an Anthropic model
LLM_MODEL=anthropic/claude-sonnet-4-6 \
LLM_API_KEY=sk-ant-... \
saifctl feat run --agent aider --name my-feature-id

# Run with OpenRouter
LLM_MODEL=openrouter/anthropic/claude-3-5-sonnet \
OPENROUTER_API_KEY=sk-or-... \
saifctl feat run --agent aider --name my-feature-id

# Run with a custom base URL (e.g. a proxy)
LLM_MODEL=openai/gpt-4o \
LLM_API_KEY=... \
LLM_BASE_URL=https://my-proxy.example.com/v1 \
saifctl feat run --agent aider --name my-feature-id
```
