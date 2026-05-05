---
source: src/agent-profiles/openhands/agent.sh
type: cli-command
---

[OpenHands](https://github.com/OpenHands/OpenHands) is the **default** coding agent. Uses the same env var names as saifctl, no mapping needed. Invoked via `saifctl feat run` (default) or `--agent openhands`. Python required (Node-only images fail) — installed via uv (preferred), pipx, or pip. Uses `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` directly; `--override-with-envs` applies them over stored settings. Emits JSONL on stdout; the OpenHands profile's `stdoutStrategy` splits and formats segments for readable CLI output (`[think]`, `[agent]`, `[inspect]`, errors).
