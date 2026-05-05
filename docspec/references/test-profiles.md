---
source: src/test-profiles/index.ts
type: config-schema
---

Test profile inventory — predefined test-runner-container configurations. Default: Node + Vitest. Reference page lists every shipped profile, the test framework + language each targets, override mechanism (`--test-profile <name>`, custom via `--test-image`), and how to define a project-local profile. Distinct from sandbox profiles (which configure the *coder* container — where the agent edits code).
