# Environment variables

Saifctl-side environment variables — read by the **host process** (`saifctl` CLI). These are distinct from the variables passed *into* the agent container (see `references/agent-environment.md`).

---

## LLM credentials

At least one provider API key is required for `saifctl init` and agent workflows. Saifctl auto-discovers the first set key and selects the matching provider.

| Variable | Provider | Default model |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | `anthropic/claude-sonnet-4-6` |
| `OPENAI_API_KEY` | OpenAI | `openai/gpt-5.4` |
| `OPENROUTER_API_KEY` | OpenRouter | `openrouter/anthropic/claude-sonnet-4-6` |
| `GEMINI_API_KEY` | Google Gemini | `google/gemini-3.1-pro-preview` |
| `XAI_API_KEY` | xAI (Grok) | `xai/grok-4-1-fast-reasoning` |
| `MISTRAL_API_KEY` | Mistral | `mistral/mistral-large-2512` |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek/deepseek-chat` |
| `GROQ_API_KEY` | Groq | `groq/llama-3.3-70b-versatile` |
| `COHERE_API_KEY` | Cohere | `cohere/command-a-03-2025` |
| `TOGETHER_API_KEY` | Together AI | `together/meta-llama/Llama-3.3-70B-Instruct` |
| `FIREWORKS_API_KEY` | Fireworks | `fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct` |
| `DEEPINFRA_API_KEY` | DeepInfra | `deepinfra/meta-llama/Llama-3.3-70B-Instruct` |
| `DASHSCOPE_API_KEY` | Alibaba DashScope | `alibaba/qwen3.5-plus` |
| `CEREBRAS_API_KEY` | Cerebras | `cerebras/llama3.3-70b` |
| `HF_TOKEN` | HuggingFace | `huggingface/meta-llama/Llama-3.3-70B-Instruct` |
| `MOONSHOT_API_KEY` | Moonshot (Kimi) | `moonshotai/kimi-k2.5` |
| `GOOGLE_VERTEX_API_KEY` | Google Vertex AI | `vertex/gemini-3.1-pro-preview` |
| `BASETEN_API_KEY` | Baseten | `baseten/Qwen/Qwen3-235B-A22B-Instruct-2507` |
| `PERPLEXITY_API_KEY` | Perplexity | `perplexity/sonar-pro` |

Ollama (`ollama/…` model strings) requires no key.

**Auto-discovery order:** Anthropic → OpenAI → OpenRouter → Gemini → xAI → Mistral → DeepSeek → Groq → Cohere → Together → Fireworks → DeepInfra → Cerebras → HuggingFace → Moonshot → DashScope → Vertex → Baseten → Perplexity → Ollama.

Override at any time with `--model <provider>/<model>` — saifctl selects the matching key for the given provider.

```bash
# Zero-config: pick up ANTHROPIC_API_KEY automatically
export ANTHROPIC_API_KEY=sk-ant-…
saifctl run --task task.md

# Explicit provider via --model
export OPENAI_API_KEY=sk-…
saifctl run --task task.md --model openai/gpt-4o
```

---

## LLM configuration

These variables configure model selection and routing on the host. Saifctl resolves them from CLI flags (`--model`, `--base-url`) and forwards the resolved values into agent containers — do not set them directly; use the CLI flags instead.

| Variable | Description | Set by |
|---|---|---|
| `LLM_MODEL` | Full `provider/model` string forwarded into the coder container (e.g. `anthropic/claude-sonnet-4-6`). Multi-provider agents (aider, openhands, opencode) read this. | Orchestrator |
| `LLM_MODEL_ID` | Bare model id without the provider prefix (e.g. `claude-sonnet-4-6`). Single-provider native CLIs (claude, codex, cursor) that reject `provider/model` form read this. | Orchestrator |
| `LLM_PROVIDER` | Provider name (e.g. `anthropic`, `openai`). Container-side scripts use this for API convention selection. | Orchestrator |
| `LLM_BASE_URL` | Base URL for a custom or proxied provider endpoint. | Orchestrator (from `--base-url`) |
| `LLM_API_KEY` | Generic API key forwarded into the coder container. Set by the orchestrator from the resolved provider key; do not set this to override — use the provider-specific key instead. | Orchestrator |

---

## Reviewer LLM configuration

When the semantic reviewer runs (`--reviewer` / `reviewer.enabled: true`), these are injected into the reviewer environment. Configured the same way as the main LLM via `--model reviewer=<provider>/<model>`.

| Variable | Description |
|---|---|
| `REVIEWER_LLM_MODEL` | Reviewer model id (bare, no provider prefix). |
| `REVIEWER_LLM_PROVIDER` | Reviewer provider name. |
| `REVIEWER_LLM_BASE_URL` | Reviewer base URL (optional; omitted when using the provider's default). |
| `REVIEWER_LLM_API_KEY` | Reviewer API key. |
| `SAIFCTL_REVIEWER_ENABLED` | Set to `1` inside the container by the orchestrator when a reviewer is configured. Read-only from the agent's perspective. |
| `SAIF_REVIEWER_BIN_DIR` | Host directory where the Argus reviewer binary is cached. Optional; defaults to `/tmp/saifctl/bin`. Override when the default temp path is not writable or when you want to share a single binary cache across multiple saifctl installs. |

---

## Hatchet (distributed mode)

By default saifctl runs in local in-process mode. Set `HATCHET_CLIENT_TOKEN` to switch to distributed Hatchet mode.

| Variable | Required | Default | Description |
|---|---|---|---|
| `HATCHET_CLIENT_TOKEN` | No | — | Hatchet authentication token. When set, saifctl dispatches work via a remote Hatchet server instead of running locally. |
| `HATCHET_SERVER_URL` | No | `localhost:7077` | gRPC address of the Hatchet server. Only used when `HATCHET_CLIENT_TOKEN` is set. |
| `SAIFCTL_EXPERIMENTAL_HATCHET` | No | — | Set to `1` to opt in to the experimental Hatchet path. Required when `HATCHET_CLIENT_TOKEN` is set; saifctl refuses to run the distributed path without it. |

```bash
# Local mode (default — no env vars needed)
saifctl run --task task.md

# Distributed mode (experimental)
export HATCHET_CLIENT_TOKEN=hatchet-token-…
export HATCHET_SERVER_URL=my-hatchet-host:7077
export SAIFCTL_EXPERIMENTAL_HATCHET=1
saifctl run --task task.md
```

`saifctl doctor` checks connectivity to `HATCHET_SERVER_URL` and reports the active mode.

---

## Test and CI internals

These variables control the integration test harness. They have no effect on normal `saifctl run` / `saifctl feat run` invocations.

| Variable | Values | Default | Description |
|---|---|---|---|
| `SAIFCTL_INTEG` | `1` | unset | Opt in to Docker-running integration scenarios. When unset, all integration tests skip silently. |
| `SAIFCTL_NO_LLM` | `1` | unset | Skip LLM-bearing scenarios. Combine with `SAIFCTL_INTEG=1` on per-PR CI that does not carry API secrets. |
| `SAIFCTL_TEST_RETRY` | integer ≥ 0 | `0` | Within-run retry budget for LLM test scenarios. Set to `2` on weekly CI to tolerate transient network errors. |
| `SAIFCTL_TEST_TIMEOUT_MS` | integer | `900000` (15 min) | Hard timeout in milliseconds for LLM integration scenarios. Override per-test or globally. |
| `SAIFCTL_SKIP_NETWORK_PROBE` | `0`, `1` | `0` | Passed into the debug agent container. Set to `1` on CI runners or dev boxes without egress to skip the Cedar/Leash network connectivity probe. |
| `SAIFCTL_TEST_SKIP_NETWORK_PROBE` | `1` | unset | Host-side global opt-out for the network probe across all harness runs. |

**Typical CI matrix:**

```bash
# Per-PR — Docker only, no LLM secrets
SAIFCTL_INTEG=1 SAIFCTL_NO_LLM=1 pnpm test:integration

# Weekly — full LLM scenarios with retry budget
SAIFCTL_INTEG=1 SAIFCTL_TEST_RETRY=2 ANTHROPIC_API_KEY=… pnpm test:integration
```
