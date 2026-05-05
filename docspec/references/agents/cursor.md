---
source: src/agent-profiles/cursor/agent.sh
type: cli-command
---

[Cursor](https://cursor.com) is an AI-powered IDE with a headless CLI. Requires an active Cursor subscription and an API key from [cursor.com/dashboard/cloud-agents](https://cursor.com/dashboard/cloud-agents). Invoked as `saifctl feat run --agent cursor`. Auth: `CURSOR_API_KEY` (preferred) or `LLM_API_KEY`; pass via `--agent-secret CURSOR_API_KEY` to keep it out of logs. No base-URL override (always Cursor's API). `LLM_MODEL` must be a Cursor-managed identifier (e.g. `claude-4.6-sonnet-medium`, `gpt-5.2`, `gemini-3.1-pro`), not `provider/model`. Install: `curl https://cursor.com/install -fsS | bash` at runtime — requires curl + bash.
