---
source: src/constants.ts
type: config-schema
---

Saifctl-side environment variables. Categories: LLM credentials (`LLM_API_KEY`, plus per-provider keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DASHSCOPE_API_KEY`, etc.), LLM config (`LLM_MODEL`, `LLM_PROVIDER`, `LLM_BASE_URL`), Hatchet (`HATCHET_CLIENT_TOKEN`, `HATCHET_SERVER_URL`, `SAIFCTL_EXPERIMENTAL_HATCHET`), saifctl internals (`SAIFCTL_INTEG`, `SAIFCTL_NO_LLM`, `SAIFCTL_TEST_RETRY`, `SAIFCTL_TEST_SKIP_NETWORK_PROBE`, `SAIFCTL_REVIEWER_BIN_DIR`). Reference page documents each: required/optional, default, where it's read, what setting it changes. Distinct from `references/agent-environment.md` (env vars passed _into_ the agent container).
