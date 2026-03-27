#!/bin/bash
# OpenHands agent script — invokes OpenHands with the task read from $SAIFAC_TASK_PATH.
#
# Part of the openhands agent profile. Selected via --agent openhands (default).
# coder-start.sh writes the current task to $SAIFAC_TASK_PATH before each invocation.
#
# CLI reference: https://docs.openhands.dev/openhands/usage/cli/command-reference
#
# Model and API key:
#   OpenHands natively uses LLM_MODEL, LLM_API_KEY, and LLM_BASE_URL — the exact same
#   variable names the factory provides. No mapping needed.
#   --override-with-envs applies these env vars to override stored settings.
#
# Key flags:
#   --headless         Run without UI (required for automation).
#   --always-approve   Auto-approve all actions without confirmation.
#   --override-with-envs
#                      Apply LLM_MODEL, LLM_API_KEY, LLM_BASE_URL from environment.
#   --json             Emit JSONL output; parsed by the factory's openhands log formatter.
#   -t                 Task string to execute.

set -euo pipefail

# Set OpenHands state directory to somewhere where we have read-write access
export OPENHANDS_WORK_DIR="${OPENHANDS_WORK_DIR:-/tmp/openhands-state}"

echo "[agent/openhands] Starting agent openhands in agent.sh..."

_SAIFAC_TASK_SNIP="$(cat "$SAIFAC_TASK_PATH" 2>/dev/null || true)"
if [ "${#_SAIFAC_TASK_SNIP}" -gt 200 ]; then
  _SAIFAC_TASK_SNIP="${_SAIFAC_TASK_SNIP:0:200}..."
fi
echo "[agent/openhands] About to run: openhands --headless --always-approve --override-with-envs --json -t \"${_SAIFAC_TASK_SNIP}\""

_agent_exit=0
openhands --headless --always-approve --override-with-envs --json -t "$(cat "$SAIFAC_TASK_PATH")" || _agent_exit=$?

echo "[agent/openhands] Finished agent openhands in agent.sh (exit code ${_agent_exit})."
exit "${_agent_exit}"
