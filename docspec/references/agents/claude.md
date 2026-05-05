---
source: src/agent-profiles/claude/agent.sh
type: cli-command
---

[Claude Code](https://code.claude.com) is Anthropic's CLI for AI-assisted coding. Runs headlessly via `-p` (print mode). Invoked as `saifctl feat run --agent claude`. `--disable-slash-commands` prevents task text being interpreted as Claude Code slash commands. Install: `npm install -g @anthropic-ai/claude-code` at runtime when missing — requires npm in the coder image.

**Auth (two paths):**

- **API key** (default): `ANTHROPIC_API_KEY` (fallback `LLM_API_KEY`). Pay-per-token, billed against the workspace key. No generic base-URL override (claude has no `--base-url` flag).
- **Claude Max OAuth** (`--claude-max` / `--claude-credentials <path>`): saifctl reads the host's `~/.claude/.credentials.json` (or a custom path), stages it into the coder container at `~/.claude/.credentials.json` (mode 600, owned by the unprivileged user), and the in-container claude CLI authenticates via the user's Max subscription. No API key needed; usage counts against the Max plan's rate limits. Mutually exclusive with `ANTHROPIC_API_KEY` for the same run — the agent script unsets API_KEY env vars before invoking claude in OAuth mode so they don't override the OAuth tokens. See [contributing/agent-profile-options.md](../../contributing/agent-profile-options.md) for the underlying profile-options mechanism.
