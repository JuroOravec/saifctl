---
source: src/cli/commands/cache.ts
type: cli-command
---

Cache management for sandbox workspace dirs under `/tmp/saifctl/sandboxes/`. Subcommands: `list` (show entries; `--all` for all projects, default scoped to current project from `package.json`), `clear` (remove entries). The temp root `/tmp/saifctl/` itself is shared with sibling caches (`/tmp/saifctl/bin/` for Argus etc.) and is not touched. `cache clear --all` is refused when `--sandbox-base-dir` resolves to the temp root, to prevent wiping shared state.
