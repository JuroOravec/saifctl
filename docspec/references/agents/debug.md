---
source: src/agent-profiles/debug/agent.sh
type: cli-command
---

The **debug** profile is a built-in coding agent that **does not call an LLM** and does not install any agent CLI. Invoked as `saifctl feat run --agent debug`. Behaviour: `agent-install.sh` is a no-op; `agent.sh` writes a minimal `dummy.md` at the workspace root (`$SAIFCTL_WORKSPACE_BASE`, default `/workspace`). Use it for fast end-to-end smoke checks of the orchestration loop (startup scripts, gate, staging, tests) without LLM latency, and for tests that expect a root `dummy.md` (e.g. the bundled `dummy` saifctl feature). For real code changes, switch to a full agent profile (`openhands`, `aider`, etc.) or `--agent-script`.
