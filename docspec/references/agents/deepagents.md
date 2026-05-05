---
source: src/agent-profiles/deepagents/agent.sh
type: cli-command
---

[Deep Agents CLI](https://github.com/langchain-ai/deepagents) is LangChain's terminal agent. Installed at runtime via uv, pipx, or pip with provider extras (anthropic, groq, openrouter). Invoked as `saifctl feat run --agent deepagents`. Python required (Node-only images fail). Model format: `provider:model` (e.g. `openai:gpt-4o`, `anthropic:claude-sonnet-4-5`); if `LLM_MODEL` has no prefix and `LLM_PROVIDER` is set, saifctl prepends the provider. `LLM_API_KEY` is mapped to provider-specific keys; native keys take precedence. Base URL has no CLI flag — set it via `base_url` in deepagent's `config.toml`. `--agent factory` uses a separate config/memory dir so factory runs don't mix with the user's default agent.
