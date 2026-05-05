---
prereq_concepts:
  - feat-run-loop
  - run-lifecycle
arrival_context: docs-link
search_terms:
  - saifctl run inspect
  - saifctl run start
  - fix agent mistake
  - resume from failed run
user_stage: established
---

# Task: fix agent mistakes by editing in-sandbox, then continuing

The reader has a failed or off-track run. They want to step into the agent's container, edit the workspace by hand (using VS Code Dev Containers or similar), then continue the agent loop from their fixes via `saifctl run start`.

Success: they can attach to the saved run's sandbox, make edits that persist, and have the agent pick up from those edits on `run start`.
