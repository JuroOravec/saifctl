---
source: src/agent-profiles/kilocode/agent.sh
type: cli-command
---

[Kilo Code](https://github.com/Kilo-Org/kilocode) is an OpenCode fork. Invoked as `saifctl feat run --agent kilocode`. Provider config (apiKey, baseURL) is injected via `OPENCODE_CONFIG_CONTENT` JSON. Model format: `provider/model` (e.g. `anthropic/claude-sonnet-4-5`); provider inferred from prefix when `LLM_PROVIDER` unset. Install: `npm install -g @kilocode/cli` at runtime — requires Node.js 20.18.1+. **Older CPUs**: the npm package may crash with "Illegal instruction" on CPUs without AVX; use the `-baseline` release instead.
