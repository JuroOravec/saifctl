---
source: src/designer-profiles/poc/profile.ts
type: cli-command
---

POC Explorer is the **default** spec designer for `saifctl feat design`. It runs a sandboxed coding agent to build a proof-of-concept exploring the feature *before* writing the spec — so the spec is grounded in what actually works in the user's codebase, not just static analysis. Invoked as `saifctl feat design` (default) or `saifctl feat design --designer poc`. Output files land in `saifctl/features/<feature>/`: `specification.md` (precise behaviour contract), `plan.md` (implementation roadmap), `poc-findings.md` (optional freeform notes — edge cases, open questions, design decisions surfaced during exploration). Contrast with shotgun (static-trace-based, faster but less grounded).
