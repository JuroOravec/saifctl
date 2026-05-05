---
source: src/config/schema.ts
type: config-schema
---

Project-level saifctl configuration: `saifctl/config.{json,yaml,yml,ts}` stores defaults so you don't have to pass options on the CLI every time. Reference page documents every field, its type, default, and which CLI flag it corresponds to. **`agents.<id>.<name>`** is the agent-profile options block — mirrors the `--<agent-id>-<name>` CLI flags declared by each profile (e.g. `agents.claude.max: true` ≡ `--claude-max`). Precedence: CLI flag > config file > profile default. See `docs/contributing/agent-profile-options.md` for the underlying mechanism and how to declare new profile options.
