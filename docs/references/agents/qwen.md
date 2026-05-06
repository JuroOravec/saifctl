# Qwen agent

Run [Qwen Code](https://github.com/QwenLM/qwen-code) — Alibaba's terminal agent — as the saifctl coder.

```bash
saifctl feat run --agent qwen
```

## Authentication

Qwen Code supports four authentication protocols. The agent script provides `LLM_*` fallbacks for DashScope and OpenAI-compatible only; Anthropic and Google GenAI require their env vars to be set directly.

**saifctl `LLM_*` fallbacks (DashScope and OpenAI-compatible)**

| Variable | Maps to | Protocol |
|---|---|---|
| `LLM_API_KEY` | `DASHSCOPE_API_KEY` | Alibaba DashScope (native Qwen models) |
| `LLM_API_KEY` | `OPENAI_API_KEY` | OpenAI-compatible (OpenRouter, proxies) |
| `LLM_BASE_URL` | `OPENAI_BASE_URL` | Custom endpoint for OpenAI-compatible protocol |

**All supported protocols (set directly to use Anthropic or Google GenAI)**

| Variable | Protocol |
|---|---|
| `DASHSCOPE_API_KEY` | Alibaba DashScope |
| `OPENAI_API_KEY` + `OPENAI_BASE_URL` | OpenAI-compatible |
| `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` | Anthropic (no `LLM_*` fallback) |
| `GEMINI_API_KEY` | Google GenAI (no `LLM_*` fallback) |

See the [Qwen Code auth docs](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/) for full details.

## Model selection

Pass the model ID via `LLM_MODEL_ID`. It is forwarded to `--model "$LLM_MODEL_ID"`.

## Prompt passing

The task is read from `$SAIFCTL_TASK_PATH` and passed via `--prompt`:

```bash
qwen \
  --prompt "$(cat "$SAIFCTL_TASK_PATH")" \
  --model "$LLM_MODEL_ID" \
  --yolo \
  --output-format stream-json
```

## Flags used by the agent script

| Flag | Value | Purpose |
|---|---|---|
| `--prompt` / `-p` | task text | Headless mode; exits when done |
| `--model` | `$LLM_MODEL_ID` | Override the model for the session |
| `--yolo` / `-y` | — | Auto-approve all tool calls; required for headless use |
| `--output-format` | `stream-json` | Newline-delimited JSON events; compatible with saifctl log parsing |

## Installation

Qwen Code is pre-installed in the Leash coder image. If you supply a custom `--coder-image`, install it yourself (requires `npm` in the image):

```bash
npm install -g @qwen-code/qwen-code
```

The agent script adds `$SAIFCTL_UNPRIV_NPM_PREFIX/bin` and `$HOME/.local/bin` to `PATH`, so a user-scoped npm install works without root.

## Example

```bash
# DashScope (native Qwen)
LLM_API_KEY=your-dashscope-key LLM_MODEL_ID=qwen-max saifctl feat run --agent qwen

# OpenRouter / OpenAI-compatible proxy
LLM_API_KEY=your-key LLM_BASE_URL=https://openrouter.ai/api/v1 LLM_MODEL_ID=qwen/qwen-2.5-coder-32b-instruct saifctl feat run --agent qwen
```
