---
source: src/agent-profiles/mini-swe-agent/agent.sh
type: cli-command
---

[mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent) is a lightweight agent from Princeton & Stanford using litellm. Invoked as `saifctl feat run --agent mini-swe-agent`. Python + pipx required (Node-only images fail). Model format: litellm style (e.g. `anthropic/claude-sonnet-4-5`, `openrouter/anthropic/...`); fallback `MSWEA_MODEL_NAME`. `LLM_API_KEY` is mapped to provider-specific keys; native keys take precedence. Base URL has no CLI flag — set via `model_kwargs.api_base` config field (saifctl writes a tmp config when `LLM_BASE_URL` is set). `MSWEA_COST_TRACKING=ignore_errors` prevents litellm aborting on unknown models or custom endpoints.
