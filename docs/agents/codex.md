# Codex

[Codex](https://github.com/openai/codex) is OpenAI's CLI coding agent. Uses the `exec` subcommand for headless, non-interactive runs.

**Usage:** `saifac feat run --agent codex`

## How we call it

```bash
codex exec \
  --model "$LLM_MODEL" \
  --dangerously-bypass-approvals-and-sandbox \
  --json \
  --ephemeral \
  - < "$SAIFAC_TASK_PATH"
```

## Notes

- **API key** — `OPENAI_API_KEY` or fallback to `LLM_API_KEY`.
- **Base URL** — `LLM_BASE_URL` is forwarded as `OPENAI_BASE_URL` for custom endpoints.
- **Install** — `agent-start.sh` runs `npm install -g @openai/codex` when `codex` is missing (requires npm). Use a Node-capable profile or bake Codex into `--coder-image`.
