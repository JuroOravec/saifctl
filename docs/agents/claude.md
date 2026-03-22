# Claude Code

[Claude Code](https://code.claude.com) is Anthropic's CLI for AI-assisted coding. Runs headlessly with `-p` (print mode).

**Usage:** `saifac feat run --agent claude`

## How we call it

```bash
claude \
  -p "$(cat "$SAIFAC_TASK_PATH")" \
  --model "$LLM_MODEL" \
  --dangerously-skip-permissions \
  --output-format stream-json \
  --verbose \
  --no-session-persistence \
  --disable-slash-commands
```

## Notes

- **API key** — `ANTHROPIC_API_KEY` or fallback to `LLM_API_KEY`.
- **No generic base URL** — Claude Code has no `LLM_BASE_URL`-style override.
- **`--disable-slash-commands`** — Prevents task text from being interpreted as Claude Code slash commands.
- **Install** — `agent-start.sh` runs `npm install -g @anthropic-ai/claude-code` when `claude` is missing (requires npm in the coder image). Use a Node-capable sandbox profile or bake the CLI into `--coder-image`.
