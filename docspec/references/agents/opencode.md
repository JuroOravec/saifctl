---
source: src/agent-profiles/opencode/agent.sh
type: cli-command
---

[OpenCode](https://github.com/opencode-ai/opencode) is an open-source coding agent with a TUI. Invoked as `saifctl feat run --agent opencode`. API keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. (fallback `LLM_API_KEY`). Base URL: no global env — when `LLM_BASE_URL` is set, saifctl injects `OPENCODE_CONFIG_CONTENT` with a provider-scoped `baseURL`. Provider from `LLM_PROVIDER` or inferred from `LLM_MODEL` prefix; set `--provider` when ambiguous. Tool approval is controlled by `OPENCODE_PERMISSION` (saifctl sets `{"*":"allow"}` for headless), no `--yolo` flag. Pre-installed in the Leash image; otherwise installed at runtime via `npm install -g opencode-ai`.
