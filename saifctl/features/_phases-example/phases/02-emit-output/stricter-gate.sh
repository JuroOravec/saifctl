#!/usr/bin/env bash
# Phase-local stricter gate (Level 1 — script bytes the live container reads
# each loop round). Demonstrates per-phase `gate.script` override:
# - end-state contracts (the feature's tests/) still gate at the run's last
#   phase via the cumulative test scope,
# - this phase additionally asserts the emitted output exists and parses,
# - non-zero exit retries the inner round (up to gate.retries).
#
# Doc-only example — wired into the integration test's compile assertion at
# `src/specs/phases/phases-example.integration.test.ts`. A real phase would
# point this at an actual schema check (e.g. jq on the JSON output).
set -euo pipefail
echo "stricter-gate.sh: phase 02 placeholder"
exit 0
