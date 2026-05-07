# Plan — emit a manifest

Single-phase feature. The agent writes `manifest.json` to the workspace
root containing two fields: `version` (a non-empty string) and `entries`
(an array). The `assert-emitted.sh` gate confirms the file exists, is
non-empty, and parses as JSON with both fields present. No tests live
under the phase — the gate is the contract.
