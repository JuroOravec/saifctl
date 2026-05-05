---
persona: engineer
tasks:
  - fix-agent-mistakes
goal: Step into a saved run's sandbox, edit code by hand, then continue the agent loop from your fixes via run start
---

How-to intent: walk the user through `saifctl run inspect <runId>` (which opens the agent's container in VS Code via Dev Containers), making edits that persist to the sandbox, then `saifctl run start <runId>` to continue from those edits. Cover the prerequisites (Docker, Dev Containers extension, run ID, base commit still present), the explorer/git-history view, and the moment when the agent picks up the manual edits (next inner round).

Embed the following screenshots from `docspec/assets/` at the matching steps. The page output lives at `docs/products/saifctl/how-tos/inspect-and-start.md`; until saifdocs gains first-class asset support (SDR-11), the agent should compute the relative path from the output dir to `docspec/assets/<name>.png` and embed via standard markdown image syntax `![alt](relative/path.png)`:

- `inspect-and-start--palette.png` — VS Code command palette, just before invoking the Dev Containers attach action.
- `inspect-and-start--palette-select-container.png` — the palette showing the list of containers to attach to (the run's container is the named one).
- `inspect-and-start--dev-containers.png` — the Dev Containers status bar / attached state.
- `inspect-and-start--explorer.png` — VS Code file explorer view of the in-container workspace.
- `inspect-and-start--edit.png` — making an edit in the container.
- `inspect-and-start--git-history.png` — git history view inside the container, showing the run's commits.
