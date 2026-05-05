---
source: src/agent-profiles/forge/agent.sh
type: cli-command
---

[Forge Code](https://forgecode.dev) is a Rust binary that runs fully headlessly. Installed at runtime via a curl script — no Node or Python required. Invoked as `saifctl feat run --agent forge`. The model is set via `forge config set model "$LLM_MODEL"` before the prompt; the agent then runs with `--agent forge --verbose -p "$task"`. Self-contained binary — no language runtime dependency, so works in minimal coder images.
