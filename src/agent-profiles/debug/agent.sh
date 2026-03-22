#!/bin/bash
# Debug agent script — writes a minimal dummy.md at the workspace root.
#
# Part of the debug agent profile. Selected via --agent debug.
# No LLM: use for fast e2e / pipeline debugging (startup, gate, tests).
#
# Writes to SAIFAC_WORKSPACE_BASE (default /workspace). Content matches the
# public structure checks for saifac/features/dummy (H1, Purpose, Structure, Next Steps).

set -euo pipefail

echo "[agent/debug] Starting agent debug in agent.sh..."

_WORKSPACE="${SAIFAC_WORKSPACE_BASE:-/workspace}"
_dummy_path="$_WORKSPACE/dummy.md"

echo "[agent/debug] Writing placeholder dummy.md at ${_dummy_path} (task file: ${SAIFAC_TASK_PATH:-<unset>})"

cat > "$_dummy_path" <<'EOF'
# Dummy

Placeholder for the documentation pipeline and project scaffold.

## Purpose

This file is a placeholder in the documentation pipeline. It acts as a scaffold until real content replaces it.

## Structure

Use consistent heading hierarchy (H1 title, H2 sections) and follow markdown conventions for documentation organization.

## Next Steps

Replace this placeholder content with actual project documentation when you are ready.
EOF

echo "[agent/debug] Finished agent debug in agent.sh (exit code 0)."
exit 0
