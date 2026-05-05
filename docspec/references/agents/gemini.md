---
source: src/agent-profiles/gemini/agent.sh
type: cli-command
---

[Gemini CLI](https://github.com/google-gemini/gemini-cli) is Google's terminal agent. Invoked as `saifctl feat run --agent gemini`. The prompt is passed as a positional argument (NOT `-p`, which Gemini uses for `--profile`). API key: `GEMINI_API_KEY` (fallback `LLM_API_KEY`). No base-URL override — `LLM_BASE_URL` is not forwarded. Pre-installed in the Leash image; if you supply a custom `--coder-image`, you must install Gemini CLI yourself. Otherwise installed at runtime via `npm install -g @google/gemini-cli` — requires npm.
