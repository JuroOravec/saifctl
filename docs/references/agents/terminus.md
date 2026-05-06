# Terminus agent

Run [Terminus](https://pypi.org/project/terminus-ai/) as a saifctl coding agent. Terminus is Harbor's reference agent — it uses a single tmux session as its only tool, sending keystrokes and reading back the screen. Fully autonomous: no confirmation prompts.

## Requirements

- Python 3.12+ must be available in the coder image.
- `tmux` is required. saifctl attempts to install it automatically via `apt`, `dnf`, or `pacman` if missing.
- `terminus` is installed at runtime via `pipx`.

## Selecting the agent

```bash
saifctl feat run --agent terminus
```

## Model

`LLM_MODEL` is **required** — Terminus has no built-in default. Use litellm model strings:

| Provider   | Example model string                      |
|------------|-------------------------------------------|
| Anthropic  | `anthropic/claude-sonnet-4-5`             |
| OpenRouter | `openrouter/anthropic/claude-3-5-sonnet`  |
| OpenAI     | `openai/gpt-4o`                           |

## API key and base URL

`LLM_API_KEY` is exported as a fallback for all common provider environment variables. Native provider keys take precedence.

| Variable              | Purpose                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `LLM_API_KEY`         | Generic fallback, mapped to all provider keys below.                    |
| `ANTHROPIC_API_KEY`   | Anthropic — native key, takes precedence over `LLM_API_KEY`.           |
| `OPENAI_API_KEY`      | OpenAI and OpenAI-compatible endpoints — also used when `LLM_BASE_URL` is set. |
| `GEMINI_API_KEY`      | Gemini — native key, takes precedence over `LLM_API_KEY`.              |
| `OPENROUTER_API_KEY`  | OpenRouter — native key, takes precedence over `LLM_API_KEY`.          |
| `OR_API_KEY`          | OpenRouter alias — native key, takes precedence over `LLM_API_KEY`.    |
| `LLM_BASE_URL`        | Custom API base URL, forwarded as `--api-base` to Terminus.            |

## Flags used by the agent script

These flags are passed automatically; you do not set them directly.

| Flag                  | Value / default | Description                                         |
|-----------------------|-----------------|-----------------------------------------------------|
| `--model`             | `$LLM_MODEL`    | litellm provider/model string (required).           |
| `--api-base`          | `$LLM_BASE_URL` | Custom LLM API base URL. Omitted when not set.      |
| `--parser`            | `json`          | Response format (`json` or `xml`).                  |
| `--temperature`       | `0.7`           | Sampling temperature.                               |

The task is passed as the first positional argument, read from `$SAIFCTL_TASK_PATH`.

## Privileges

The agent runs under an unprivileged user via `runuser`. The working directory is set to `$SAIFCTL_WORKSPACE_BASE` (default `/workspace`).

## Usage examples

```bash
# Run with an Anthropic model
LLM_MODEL=anthropic/claude-sonnet-4-5 \
LLM_API_KEY=sk-ant-... \
saifctl feat run --agent terminus --feature my-feature-id

# Run with OpenRouter
LLM_MODEL=openrouter/anthropic/claude-3-5-sonnet \
OPENROUTER_API_KEY=sk-or-... \
saifctl feat run --agent terminus --feature my-feature-id

# Run with a custom base URL (OpenAI-compatible endpoint)
LLM_MODEL=openai/gpt-4o \
LLM_API_KEY=... \
LLM_BASE_URL=https://my-proxy.example.com/v1 \
saifctl feat run --agent terminus --feature my-feature-id
```
