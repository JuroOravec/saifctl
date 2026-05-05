---
source: src/agent-profiles/aider/agent.sh
type: cli-command
---

[Aider](https://github.com/Aider-AI/aider) is an AI pair-programmer. Uses litellm so it works with OpenAI, Anthropic, OpenRouter, Gemini, etc. Invoked as `saifctl feat run --agent aider`. Notable: Python + pipx required (Node-only images fail); auto-commits disabled (`--no-auto-commits`) since saifctl tracks changes via diff; model format follows litellm conventions; `LLM_API_KEY` is mapped to provider-specific keys (e.g. `ANTHROPIC_API_KEY`) — native keys take precedence.
