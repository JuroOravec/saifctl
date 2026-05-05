---
source: src/agent-profiles/terminus/agent.sh
type: cli-command
---

[Terminus](https://pypi.org/project/terminus-ai/) is Harbor's reference agent. Uses a single tmux session as its only tool — sends keystrokes and reads the screen. Invoked as `saifctl feat run --agent terminus`. Python 3.12+ and tmux required (saifctl tries to install tmux if missing via apt/dnf/pacman). Installed via pipx. **`LLM_MODEL` is required** (Terminus has no default). Model format: litellm (e.g. `anthropic/claude-sonnet-4-5`, `openrouter/...`). `LLM_API_KEY` mapped to provider-specific keys; when using `LLM_BASE_URL`, `OPENAI_API_KEY` is used for OpenAI-compatible endpoints. Autonomous by design — no yolo flag; Terminus never prompts for confirmation.
