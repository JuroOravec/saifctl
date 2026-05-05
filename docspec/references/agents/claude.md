---
source: src/agent-profiles/claude/agent.sh
type: cli-command
---

[Claude Code](https://code.claude.com) is Anthropic's CLI for AI-assisted coding. Runs headlessly via `-p` (print mode). Invoked as `saifctl feat run --agent claude`. API key: `ANTHROPIC_API_KEY` (fallback `LLM_API_KEY`). No generic base-URL override. `--disable-slash-commands` prevents task text being interpreted as Claude Code slash commands. Install: `npm install -g @anthropic-ai/claude-code` at runtime when missing — requires npm in the coder image.
