---
source: src/orchestrator/agent-env.ts
type: config-schema
---

Environment variables saifctl passes into the **agent container**. Two categories: (1) **public env** — normal `KEY=value` settings (LLM_MODEL, LLM_API_KEY, LLM_BASE_URL etc.), persisted with the run when run storage is enabled; (2) **secrets** — `--agent-secret KEY` keeps values out of logs and out of run storage. Plus saifctl-injected vars: `SAIFCTL_TASK_PATH`, `SAIFCTL_WORKSPACE_BASE`, `SAIFCTL_RUN_ID`. Distinct from `references/env-vars.md` (env vars saifctl itself reads on the host).
