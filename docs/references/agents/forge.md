# Forge agent

Run coding tasks headlessly with [Forge Code](https://forgecode.dev), a self-contained Rust binary — no Node or Python runtime required. Forge is installed automatically via a `curl` script into `~/.local/bin` and works in minimal coder images.

## Selecting the agent

```bash
saifctl feat run --agent forge
```

## Model

Forge has no `--model` CLI flag. The agent script runs `forge config set model "$LLM_MODEL"` before invoking the binary to pin the model for that invocation.

**Model string format is provider-dependent:**

| Provider      | Format                | Example                                      |
|---------------|-----------------------|----------------------------------------------|
| OpenRouter    | `provider/org/model`  | `openrouter/anthropic/claude-3-5-sonnet`     |
| HuggingFace   | `org/model`           | `meta-llama/Llama-3.3-70B-Instruct`          |
| OpenAI        | bare id               | `o1`, `gpt-5`                                |
| Anthropic     | bare id               | `claude-sonnet-4.5`                          |

`LLM_MODEL` is passed verbatim to `forge config set model`. This works correctly for OpenRouter and HuggingFace (slash-separated). For OpenAI and Anthropic, the saifctl-prefixed form (e.g. `openai/gpt-4o`) may be rejected by Forge's model registry. In that case use one of:

- **(a)** Pre-configure the model in `.forge.toml` (`[session] model_id = "gpt-4o"`). This takes precedence when `forge config set` fails (the call is guarded with `|| true`).
- **(b)** Supply a bare model ID via `--agent-env LLM_MODEL=<bare-id>` to override the orchestrator's auto-prefixed value.

## API key and base URL

Forge reads API keys directly from environment variables. Priority order:

| Variable              | Purpose                                     |
|-----------------------|---------------------------------------------|
| `FORGE_KEY`           | Forge-native key (highest priority)         |
| `OPENROUTER_API_KEY`  | OpenRouter                                  |
| `OPENAI_API_KEY`      | OpenAI                                      |
| `ANTHROPIC_API_KEY`   | Anthropic                                   |
| `LLM_API_KEY`         | Generic fallback, mapped to all keys above  |

All four provider keys fall back to `LLM_API_KEY` when unset.

**Base URL:**

| Variable        | Purpose                                                  |
|-----------------|----------------------------------------------------------|
| `LLM_BASE_URL`  | Forwarded as `OPENAI_URL` for OpenAI-compatible endpoints |
| `OPENAI_URL`    | OpenAI-compatible base URL (set directly or via `LLM_BASE_URL`) |
| `ANTHROPIC_URL` | Anthropic-compatible base URL (set directly)             |

## CLI flags used by the agent script

These flags are passed automatically on every invocation.

| Flag             | Effect                                                      |
|------------------|-------------------------------------------------------------|
| `--agent forge`  | Full read-write execution agent (default; set explicitly for clarity). |
| `--verbose`      | Verbose output for factory log inspection.                  |
| `-p "$(cat …)"`  | Reads the task from `$SAIFCTL_TASK_PATH`; non-interactive single-shot mode. |

## Privileges

The agent runs under an unprivileged user via `runuser`. The working directory is set to `$SAIFCTL_WORKSPACE_BASE` (default `/workspace`).

## Usage examples

```bash
# Run with OpenRouter
LLM_MODEL=openrouter/anthropic/claude-3-5-sonnet \
LLM_API_KEY=sk-or-... \
saifctl feat run --agent forge --feature my-feature-id

# Run with HuggingFace
LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct \
LLM_API_KEY=hf_... \
saifctl feat run --agent forge --feature my-feature-id

# Run with Anthropic (bare model id via --agent-env to bypass prefix)
LLM_MODEL=anthropic/claude-sonnet-4-5 \
LLM_API_KEY=sk-ant-... \
saifctl feat run --agent forge --agent-env LLM_MODEL=claude-sonnet-4-5 --feature my-feature-id
```

## See also

- [Forge CLI reference](https://forgecode.dev/docs/cli-reference/)
- [Forge environment configuration](https://forgecode.dev/docs/environment-configuration/)
