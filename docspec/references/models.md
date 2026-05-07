---
source: src/llm-config.ts
type: config-schema
---

LLM provider/model configuration. Per Decision release-readiness/D-05 saifctl ships native support for Anthropic, OpenAI, Google, Google Vertex, plus an OpenAI-compatible fallback for any other provider via `--provider <name>` and a documented `baseURL`. Reference page lists: supported providers, the four kept native SDKs, the OpenAI-compat dispatch logic (with each provider's documented baseURL), how `--model` resolves, per-agent model override (`--model-agent`, `--model-reviewer`, etc.), and key env-var fallbacks (`LLM_API_KEY` → provider-specific keys).
