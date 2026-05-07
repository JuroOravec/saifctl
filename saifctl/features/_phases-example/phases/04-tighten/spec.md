# Phase 04 — Tighten (Level-1.5 model + reviewer demo)

Final-pass cleanup: tighten doc strings, normalise error messages, drop
unused imports. A verification-only step where a smaller cheaper model is
sufficient and the semantic reviewer (Argus) doesn't add signal — anything
the reviewer would flag is already gated by the strict / paranoid critics
upstream.

This is the canonical Level-1.5 case: `agent.model` and `agent.reviewer`
both rewrite the per-subtask env file (`<saifctlPath>/subtask-env.sh`) at
the phase boundary; the long-lived coder container sources the file each
inner round, so neither setting triggers a restart. See `concept
per-phase-config` for the lifecycle-cost model.

## Tests

A real tightening phase would gate on lint + typecheck via the cumulative
scope; this doc-only example does not ship `phases/04-tighten/tests/`.
