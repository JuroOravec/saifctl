---
source: src/agent-profiles/copilot/agent.sh
type: cli-command
---

[GitHub Copilot CLI](https://github.com/github/copilot-cli) routes AI requests through GitHub's API. Requires an active Copilot subscription. Invoked as `saifctl feat run --agent copilot`. Auth: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`; fallback `LLM_API_KEY`. No base-URL override (always GitHub). `LLM_MODEL` must be a GitHub-managed identifier (e.g. `claude-sonnet-4.5`, `gpt-4.1`), not arbitrary `provider/model` strings. Install: `npm install -g @github/copilot` at runtime — requires Node.js. Copilot doesn't expose `--no-auto-commits`; saifctl detects changes via `git log` (diff + recent commits).
