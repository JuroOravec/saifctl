#!/bin/bash
# Debug agent setup — intentionally empty (no CLI install).
#
# Runs once inside the coder container after the project startup script and
# before the agent loop (SAIFAC_AGENT_START_SCRIPT in coder-start.sh).
# Use this profile to exercise the factory loop without waiting on pip/uv installs.

set -euo pipefail
trap 'ec=$?; echo "[agent-start/debug] Finished debug setup (agent-start.sh, exit code ${ec})."' EXIT
echo "[agent-start/debug] Skipping agent CLI install (debug profile noop)."
