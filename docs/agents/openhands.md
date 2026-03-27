# OpenHands

[OpenHands](https://github.com/OpenHands/OpenHands) is the default coding agent. Uses the same env var names as the factory — no mapping needed.

**Usage:** `saifac feat run` (default) or `--agent openhands`

## How we call it

```bash
openhands --headless --always-approve --override-with-envs --json -t "$(cat "$SAIFAC_TASK_PATH")"
```

## Notes

- **Python required** — Installed via uv (preferred), pipx, or pip. Node-only images will fail.
- **Env vars** — Uses `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` directly. `--override-with-envs` applies them over stored settings.
- **Stdout** — Emits JSONL; the OpenHands profile’s `stdoutStrategy` splits and formats segments for readable CLI output (e.g. `[think]` snippets, `[agent]` / `[inspect]` summaries, errors, etc.).
