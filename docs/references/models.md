# Models reference

Run AI agents with any supported provider by passing `--model <provider/model>` to any `saifctl` command. This page lists every supported provider, its API key, default model, and how model resolution works.

---

## Model string format

All model identifiers use `provider/model` format:

```
anthropic/claude-sonnet-4-6
openai/gpt-5.4
google/gemini-3.1-pro-preview
openrouter/anthropic/claude-sonnet-4-6
ollama/llama3.1
```

The provider prefix determines API key selection, base URL routing, and which SDK is instantiated. For multi-segment model names (e.g. `openrouter/google/gemini-2.5-pro`) the first segment is the provider; everything after is the model ID.

The legacy `provider:model` separator is also accepted and normalised automatically.

If no slash is present, the provider defaults to `openai` (backwards compatibility).

---

## Supported providers

### Native SDK providers

These providers use a dedicated `@ai-sdk/<name>` package.

| Provider    | Aliases            | API key env var         | Default model                   |
| ----------- | ------------------ | ----------------------- | ------------------------------- |
| `anthropic` | `anthropic`        | `ANTHROPIC_API_KEY`     | `anthropic/claude-sonnet-4-6`   |
| `openai`    | `openai`           | `OPENAI_API_KEY`        | `openai/gpt-5.4`                |
| `google`    | `google`, `gemini` | `GEMINI_API_KEY`        | `google/gemini-3.1-pro-preview` |
| `vertex`    | `vertex`           | `GOOGLE_VERTEX_API_KEY` | `vertex/gemini-3.1-pro-preview` |

### OpenAI-compatible providers

These providers expose an OpenAI-compatible endpoint; saifctl routes them through `@ai-sdk/openai` with the registered `baseURL`.

| Provider      | Aliases                  | API key env var      | Default model                                                 | Base URL                                            |
| ------------- | ------------------------ | -------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `openrouter`  | `openrouter`             | `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-sonnet-4-6`                      | `https://openrouter.ai/api/v1`                      |
| `xai`         | `xai`                    | `XAI_API_KEY`        | `xai/grok-4-1-fast-reasoning`                                 | `https://api.x.ai/v1`                               |
| `mistral`     | `mistral`                | `MISTRAL_API_KEY`    | `mistral/mistral-large-2512`                                  | `https://api.mistral.ai/v1`                         |
| `deepseek`    | `deepseek`               | `DEEPSEEK_API_KEY`   | `deepseek/deepseek-chat`                                      | `https://api.deepseek.com/v1`                       |
| `groq`        | `groq`                   | `GROQ_API_KEY`       | `groq/llama-3.3-70b-versatile`                                | `https://api.groq.com/openai/v1`                    |
| `cohere`      | `cohere`                 | `COHERE_API_KEY`     | `cohere/command-a-03-2025`                                    | `https://api.cohere.com/compatibility/v1`           |
| `together`    | `together`, `togetherai` | `TOGETHER_API_KEY`   | `together/meta-llama/Llama-3.3-70B-Instruct`                  | `https://api.together.xyz/v1`                       |
| `fireworks`   | `fireworks`              | `FIREWORKS_API_KEY`  | `fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct` | `https://api.fireworks.ai/inference/v1`             |
| `deepinfra`   | `deepinfra`              | `DEEPINFRA_API_KEY`  | `deepinfra/meta-llama/Llama-3.3-70B-Instruct`                 | `https://api.deepinfra.com/v1/openai`               |
| `cerebras`    | `cerebras`               | `CEREBRAS_API_KEY`   | `cerebras/llama3.3-70b`                                       | `https://api.cerebras.ai/v1`                        |
| `huggingface` | `huggingface`, `hf`      | `HF_TOKEN`           | `huggingface/meta-llama/Llama-3.3-70B-Instruct`               | `https://router.huggingface.co/v1`                  |
| `moonshotai`  | `moonshotai`, `moonshot` | `MOONSHOT_API_KEY`   | `moonshotai/kimi-k2.5`                                        | `https://api.moonshot.cn/v1`                        |
| `alibaba`     | `alibaba`, `dashscope`   | `DASHSCOPE_API_KEY`  | `alibaba/qwen3.5-plus`                                        | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `baseten`     | `baseten`                | `BASETEN_API_KEY`    | `baseten/Qwen/Qwen3-235B-A22B-Instruct-2507`                  | `https://inference.baseten.co/v1`                   |
| `perplexity`  | `perplexity`             | `PERPLEXITY_API_KEY` | `perplexity/sonar-pro`                                        | `https://api.perplexity.ai`                         |
| `ollama`      | `ollama`                 | _(none required)_    | `ollama/llama3.1`                                             | `http://localhost:11434/v1`                         |

Ollama requires no API key; saifctl passes the placeholder `sk-none` to satisfy SDK validation.

---

## Model resolution cascade

For each agent, the model is resolved in this order (highest priority first):

1. **Per-agent `--model`** — `--model coder=anthropic/claude-sonnet-4-6`
2. **Global `--model`** — `--model anthropic/claude-sonnet-4-6`
3. **Zero-config auto-discovery** — saifctl iterates providers in declaration order (anthropic → openai → openrouter → google → xai → mistral → deepseek → groq → cohere → together → fireworks → deepinfra → cerebras → huggingface → moonshotai → alibaba → vertex → baseten → perplexity → ollama); the first provider whose API key env var is set in the environment wins, and its default model is used. Note: the tables above group providers by SDK type for readability and do not reflect this auto-discovery order.

If no credentials are found and no model is specified, saifctl throws an error listing which env vars to set.

---

## Per-agent model overrides

Use `agent=provider/model` comma-separated pairs to set different models per agent:

```sh
saifctl run \
  --model "coder=anthropic/claude-sonnet-4-6,reviewer=openai/gpt-5.4"
```

### Supported agent names

| Agent               | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `coder`             | Writes code inside the coding container              |
| `discovery`         | Explores the codebase to plan changes                |
| `reviewer`          | Reviews and critiques the coder's output             |
| `vague-specs-check` | Checks task specs for ambiguity before coding starts |
| `pr-summarizer`     | Summarises pull requests                             |
| `tests-catalog`     | Catalogues existing tests                            |
| `tests-writer`      | Writes new tests                                     |

---

## Base URL overrides

Override the endpoint URL for any provider with `--base-url`. Accepts a global value or per-agent pairs:

```sh
# Global override — all agents use this URL
saifctl run --model openai/gpt-5.4 --base-url https://my-proxy.example.com/v1

# Per-agent override
saifctl run \
  --model "coder=openai/gpt-5.4,pr-summarizer=openai/gpt-4o-mini" \
  --base-url "coder=https://my-proxy.example.com/v1"
```

Base URL resolution order (highest priority first):

1. Per-agent `--base-url`
2. Global `--base-url`
3. Registered provider default (from the table above)

---

## Custom / unknown providers

Any provider name not in the table above is treated as an OpenAI-compatible endpoint. Supply a `--base-url` and set `OPENROUTER_API_KEY` or `OPENAI_API_KEY` as the credential:

```sh
saifctl run \
  --model myprovider/my-model \
  --base-url https://my-custom-endpoint.example.com/v1
```

---

## Environment variable fallback for unknown providers

For unknown providers, saifctl falls back to `OPENROUTER_API_KEY`, then `OPENAI_API_KEY`. There is no generic `LLM_API_KEY` variable; use the provider-specific env var shown in the table above.

---

## Examples

```sh
# Use Anthropic Claude with explicit model
saifctl run --model anthropic/claude-sonnet-4-6

# Use OpenRouter as a proxy for Claude
saifctl run --model openrouter/anthropic/claude-sonnet-4-6

# Zero-config: set ANTHROPIC_API_KEY; saifctl picks anthropic/claude-sonnet-4-6
export ANTHROPIC_API_KEY=sk-ant-...
saifctl run

# Different models per agent
saifctl run \
  --model "coder=anthropic/claude-sonnet-4-6,reviewer=openai/gpt-5.4,pr-summarizer=openai/gpt-4o-mini"

# Local Ollama (no API key needed)
saifctl run --model ollama/llama3.1
```
