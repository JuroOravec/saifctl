---
source: src/agent-profiles/codex/agent.sh
type: cli-command
---

[Codex](https://github.com/openai/codex) is OpenAI's CLI coding agent. Uses the `exec` subcommand for headless, non-interactive runs. Invoked as `saifctl feat run --agent codex`. API key: `OPENAI_API_KEY` (fallback `LLM_API_KEY`); `LLM_BASE_URL` forwarded as `OPENAI_BASE_URL` for custom endpoints. Install: `npm install -g @openai/codex` at runtime when missing — requires npm.
