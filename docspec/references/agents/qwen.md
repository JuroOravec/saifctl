---
source: src/agent-profiles/qwen/agent.sh
type: cli-command
---

[Qwen Code](https://github.com/QwenLM/qwen-code) is Alibaba's terminal agent. Invoked as `saifctl feat run --agent qwen`. Supports DASHSCOPE (native Qwen) plus OpenAI-compatible, Anthropic, Google. `LLM_API_KEY` is mapped to `DASHSCOPE_API_KEY` and `OPENAI_API_KEY`; `LLM_BASE_URL` forwarded as `OPENAI_BASE_URL` (works with OpenRouter, proxies). Pre-installed in the Leash image; otherwise installed at runtime via `npm install -g @qwen-code/qwen-code` — requires npm.
