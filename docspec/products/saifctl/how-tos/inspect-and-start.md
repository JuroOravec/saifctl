---
persona: engineer
tasks:
  - fix-agent-mistakes
goal: Step into a saved run's sandbox, edit code by hand, then continue the agent loop from your fixes via run start
---

How-to intent: walk the user through `saifctl run inspect <runId>` (which opens the agent's container in VS Code via Dev Containers), making edits that persist to the sandbox, then `saifctl run start <runId>` to continue from those edits. Cover the prerequisites (Docker, Dev Containers extension, run ID, base commit still present), the explorer/git-history view, and the moment when the agent picks up the manual edits (next inner round).
