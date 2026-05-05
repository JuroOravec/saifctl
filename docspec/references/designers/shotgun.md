---
source: src/designer-profiles/shotgun/profile.ts
type: cli-command
---

[Shotgun](https://github.com/shotgun-sh/shotgun) is an **optional** spec designer. Statically searches and traces the codebase to produce specs (no agent run, no LLM-driven exploration). Invoked as `saifctl feat design --designer shotgun`. Requires Python 3.11+ and `shotgun-sh` (`pip install shotgun-sh` or `uv add shotgun-sh`); one-time Shotgun config wizard (`config init`) for LLM provider/API keys. Note: Shotgun also serves as a codebase indexer (`--indexer shotgun`); these are two separate roles — see also `references/indexers/shotgun.md`. Contrast with the default `poc` designer (agent-driven exploration, slower but grounded in working code).
