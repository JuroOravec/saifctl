---
id: sandbox
explains: saifctl's Sandbox mode — `saifctl sandbox` — what it gives you, when to use it (vs. Factory mode), and the boundary it enforces
learning_outcomes:
  - Sandbox mode is one of saifctl's two modes (Sandbox / Factory per Decision release-readiness/D-20). Run any agent CLI in an ephemeral Docker container; nothing reaches the host unless you opt in via `--extract`.
  - 'Two operating modes within sandbox: non-interactive (`--task` / `--task-file` / `--subtasks`, agent runs autonomously and exits) and interactive (`--interactive`, drops you into a bash shell inside the container).'
  - 'The container boundary: saifctl copies your project into the container before the run; the agent sees the copy, not your real working tree. Container is destroyed at end of session.'
  - '`--extract` semantics + the narrowing flags `--extract-include` / `--extract-exclude`.'
  - 'What sandbox skips compared to Factory mode (`feat run`): no Gate, no Reviewer, no holdout tests, single attempt, no run storage by default.'
  - 'When to use sandbox: research, marketing copy, one-off agent tasks, manual environment setup before agent runs.'
  - Cross-link to the sister concept `docker-isolation.md` for the lower-level mechanics of how the boundary is enforced.
analogies:
  - browser private/incognito mode but for code-editing agents
  - VM snapshot rollback — start clean, throw away changes by default
---

Body intent: this is the higher-level Sandbox concept (what it is and when to use it), corresponding to the saifctl landing page's Sandbox half. The lower-level mechanics (Cedar, Leash, copy-not-mount, container teardown) live in the existing `docker-isolation.md` concept.
