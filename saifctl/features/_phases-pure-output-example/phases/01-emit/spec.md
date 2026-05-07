# Phase 01 — Emit manifest

Write `manifest.json` at the workspace root. The file MUST:

- exist after the round,
- be non-empty,
- parse as JSON,
- contain a top-level `version` field (a non-empty string),
- contain a top-level `entries` field (an array, possibly empty).

The agent has no behavioural test to satisfy beyond the gate script
(`assert-emitted.sh`). Get the file shape right and the round passes.
