# Agent: mini-swe-agent

Run coding tasks using [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent), a lightweight agent from Princeton & Stanford built on litellm. Invoke with `saifctl feat run --agent mini-swe-agent`.

## Requirements

Python and pipx must be available in the coder image. Node-only images will fail.

## Authentication

mini-SWE-agent uses litellm for model access. The agent maps `LLM_API_KEY` to all supported provider-specific keys. Native provider keys take precedence.

| Provider key | Fallback source |
|---|---|
| `ANTHROPIC_API_KEY` | `LLM_API_KEY` |
| `OPENAI_API_KEY` | `LLM_API_KEY` |
| `GEMINI_API_KEY` | `LLM_API_KEY` |
| `OPENROUTER_API_KEY` | `LLM_API_KEY` |

## Model selection

Specify models in litellm provider/model format (e.g. `anthropic/claude-sonnet-4-5`, `openrouter/anthropic/claude-3-5-sonnet`). Pass via `LLM_MODEL`; falls back to `MSWEA_MODEL_NAME` if `LLM_MODEL` is unset.

## Base URL

There is no CLI flag for base URL. When `LLM_BASE_URL` is set, saifctl writes a temporary YAML config that injects `model_kwargs.api_base` and `custom_llm_provider` so litellm routes correctly. The provider is resolved from `LLM_PROVIDER`, or inferred from the prefix of `LLM_MODEL` (the part before `/`). The temp file is removed after the run.

## CLI flags used by the agent

| Flag | Description |
|---|---|
| `-t <task>` | Task text (non-interactive mode). Sourced from `SAIFCTL_TASK_PATH`. |
| `--yolo` | Execute LLM-proposed bash commands without prompting. Always set. |
| `--exit-immediately` | Exit when the agent signals `COMPLETE_TASK`. Always set. |
| `-m <model>` | litellm provider/model string. Set when `LLM_MODEL` is non-empty. |
| `-c <config>` | Config file(s). Set to `mini.yaml` plus a temp override file when `LLM_BASE_URL` is provided. |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SAIFCTL_TASK_PATH` | Yes | Path to the file containing the task prompt. |
| `LLM_MODEL` | Recommended | Model in litellm format (e.g. `anthropic/claude-sonnet-4-5`). |
| `LLM_API_KEY` | Fallback | Generic API key mapped to all supported provider keys when provider-specific keys are unset. |
| `ANTHROPIC_API_KEY` | No | Anthropic key; overrides `LLM_API_KEY` for Anthropic models. |
| `OPENAI_API_KEY` | No | OpenAI key; overrides `LLM_API_KEY` for OpenAI models. |
| `GEMINI_API_KEY` | No | Gemini key; overrides `LLM_API_KEY` for Gemini models. |
| `OPENROUTER_API_KEY` | No | OpenRouter key; overrides `LLM_API_KEY` for OpenRouter models. `OR_API_KEY` is an internal alias derived inside the runuser shell from `OPENROUTER_API_KEY` or `LLM_API_KEY`; it is not a passthrough variable and cannot be set independently from outside. |
| `LLM_BASE_URL` | No | Custom base URL. Triggers temp config generation when set. Requires `LLM_PROVIDER` or a prefixed `LLM_MODEL`. |
| `LLM_PROVIDER` | No | Provider name for custom base URL config (e.g. `openai`). Inferred from `LLM_MODEL` prefix if omitted. |
| `MSWEA_MODEL_NAME` | No | Fallback model name when `LLM_MODEL` is unset. |
| `MSWEA_COST_TRACKING` | No | Defaults to `ignore_errors` — prevents litellm from aborting on unknown models or custom endpoints. |
| `SAIFCTL_UNPRIV_USER` | Yes | Unprivileged user to run `mini` as. |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes, injected by factory | npm prefix whose `bin/` directory is prepended to `PATH` inside the runuser shell. |
| `SAIFCTL_WORKSPACE_BASE` | No | Working directory (default: `/workspace`). |

## Privilege drop

The agent runs `mini` as `$SAIFCTL_UNPRIV_USER` via `runuser`. `PATH` is extended with `$HOME/.local/bin` (where pipx installs `mini`) and the unprivileged npm prefix bin.

## Usage examples

**Run a feature with an Anthropic model:**

```bash
export LLM_API_KEY=sk-ant-…
export LLM_MODEL=anthropic/claude-sonnet-4-5
saifctl feat run --agent mini-swe-agent --feature my-feature-id
```

**Run with an OpenRouter model:**

```bash
export LLM_API_KEY=sk-or-…
export LLM_MODEL=openrouter/anthropic/claude-3-5-sonnet
saifctl feat run --agent mini-swe-agent --feature my-feature-id
```

**Run against a custom endpoint:**

```bash
export LLM_BASE_URL=https://my-proxy.example.com/v1
export LLM_MODEL=openai/gpt-4o
export LLM_API_KEY=my-key
saifctl feat run --agent mini-swe-agent --feature my-feature-id
```

## See also

- [mini-SWE-agent CLI reference](https://mini-swe-agent.com/latest/usage/mini/)
- [litellm provider/model format](https://docs.litellm.ai/docs/providers)
