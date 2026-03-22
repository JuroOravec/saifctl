#!/bin/bash
# coder-start.sh — inner agentic loop; copied into the sandbox and bind-mounted at /saifac/coder-start.sh.
#
# Runtime requirements (all SAIFAC coder target images — profile Dockerfile.coder — should provide these):
#   - bash on PATH  — this script is bash; gate scripts are invoked as `bash "$GATE_SCRIPT"`.
#   - sh on PATH    — semantic reviewer is invoked as `sh "$SAIFAC_REVIEWER_SCRIPT"` when set.
#
# Runs the agent script, then calls /saifac/gate.sh (injected read-only per-run).
# If the gate passes (exit 0), the container exits successfully.
# If the gate fails, the failure output is appended to the task prompt and
# the agent is re-invoked, up to SAIFAC_GATE_RETRIES times.
#
# Environment variables:
#   SAIFAC_INITIAL_TASK        — the full task prompt (required)
#   SAIFAC_GATE_RETRIES        — max inner rounds before giving up (default: 5)
#   SAIFAC_GATE_SCRIPT         — path to the gate script (default: /saifac/gate.sh)
#   SAIFAC_STARTUP_SCRIPT      — path to the installation script (required); run once before
#                                 the agent loop. Set via --profile (default: node-pnpm-python) or
#                                 --startup-script.
#   SAIFAC_AGENT_INSTALL_SCRIPT — (optional) path to an agent install script; run once after
#                                 the startup script and before the agent loop. Use to
#                                 install the coding agent (e.g. pipx install aider-chat).
#                                 When unset or empty, this step is skipped.
#   SAIFAC_AGENT_SCRIPT        — path to the agent script (default: /saifac/agent.sh)
#                                 The script is called once per inner round. It must read
#                                 the task from $SAIFAC_TASK_PATH and run the coding agent.
#   SAIFAC_TASK_PATH           — path where the current task prompt is written before each
#                                 agent invocation (default: /workspace/.saifac/task.md).
#                                 Agent scripts should read from this file rather than from
#                                 command-line arguments to avoid escaping and length issues.
#   SAIFAC_REVIEWER_SCRIPT     — (optional) path to semantic reviewer script. When set and
#                                 present, runs after the gate passes. If it fails, the round
#                                 is treated as a gate failure and the agent retries.

set -euo pipefail

# Fail fast if a minimal or misconfigured image omits these (should not happen on supported images).
if ! command -v bash >/dev/null 2>&1; then
  echo "[coder-start] ERROR: bash is required on PATH (SAIFAC coder images provide it)." >&2
  exit 127
fi
if ! command -v sh >/dev/null 2>&1; then
  echo "[coder-start] ERROR: sh is required on PATH (for the semantic reviewer when enabled)." >&2
  exit 127
fi

GATE_SCRIPT="${SAIFAC_GATE_SCRIPT:-/saifac/gate.sh}"
AGENT_SCRIPT="${SAIFAC_AGENT_SCRIPT:-/saifac/agent.sh}"
GATE_RETRIES="${SAIFAC_GATE_RETRIES:-5}"
TASK_PATH="${SAIFAC_TASK_PATH:-/workspace/.saifac/task.md}"

if [ -z "${SAIFAC_INITIAL_TASK:-}" ]; then
  echo "[coder-start] ERROR: SAIFAC_INITIAL_TASK is not set." >&2
  exit 1
fi

if [ -z "${SAIFAC_STARTUP_SCRIPT:-}" ]; then
  echo "[coder-start] ERROR: SAIFAC_STARTUP_SCRIPT is not set." >&2
  exit 1
fi

if [ ! -f "$SAIFAC_STARTUP_SCRIPT" ]; then
  echo "[coder-start] ERROR: startup script not found: $SAIFAC_STARTUP_SCRIPT" >&2
  exit 1
fi

if [ ! -f "$AGENT_SCRIPT" ]; then
  echo "[coder-start] ERROR: agent script not found: $AGENT_SCRIPT" >&2
  exit 1
fi

echo "[coder-start] Running startup script: $SAIFAC_STARTUP_SCRIPT"
bash "$SAIFAC_STARTUP_SCRIPT"
echo "[coder-start] Startup script completed."

if [ -n "${SAIFAC_AGENT_INSTALL_SCRIPT:-}" ]; then
  if [ ! -f "$SAIFAC_AGENT_INSTALL_SCRIPT" ]; then
    echo "[coder-start] ERROR: agent install script not found: $SAIFAC_AGENT_INSTALL_SCRIPT" >&2
    exit 1
  fi
  echo "[coder-start] Running agent install script: $SAIFAC_AGENT_INSTALL_SCRIPT"
  bash "$SAIFAC_AGENT_INSTALL_SCRIPT"
  echo "[coder-start] Agent install script completed."
fi

INITIAL_TASK="$SAIFAC_INITIAL_TASK"
round=0
current_task="$INITIAL_TASK"

while [ "$round" -lt "$GATE_RETRIES" ]; do
  round=$((round + 1))
  echo "[coder-start] ===== Round $round/$GATE_RETRIES ====="

  # Write the current task to SAIFAC_TASK_PATH so the agent script can read it.
  # Agent scripts must consume the task from this file (not from env var or CLI args).
  export SAIFAC_TASK_PATH="$TASK_PATH"
  mkdir -p "$(dirname "$TASK_PATH")"
  printf '%s' "$current_task" > "$TASK_PATH"

  # This is where we call the actual agent, e.g. OpenHands, Aider, Claude, Codex, etc.
  # Instead of calling openhands directly, we call the agent script - a bash script
  # that can contain anything. This way we can use any agent, not just OpenHands.
  echo "[coder-start] Running agent: $AGENT_SCRIPT"
  bash "$AGENT_SCRIPT"
  echo "[coder-start] Agent completed."

  if [ -f "$GATE_SCRIPT" ]; then
    echo "[coder-start] Running gate: $GATE_SCRIPT"
    # Use explicit bash: bind-mounted scripts may lack +x (e.g. from the host filesystem).
    # Capture stdout+stderr; preserve exit code without triggering set -e.
    gate_output=$(bash "$GATE_SCRIPT" 2>&1) && gate_exit=0 || gate_exit=$?
  else
    # If no gate scripts, still set gate_exit to 0 so we proceed to the reviewer.
    echo "[coder-start] No gate script at $GATE_SCRIPT — skipping static checks."
    gate_output=""
    gate_exit=0
  fi

  # Print captured output from gate.sh if not empty.
  if [ -n "${gate_output:-}" ]; then
    printf '%s\n' "$gate_output"
  fi

  # User-supplied gate script succeeded, now let's run the semantic reviewer (argus-ai) if enabled.
  if [ "$gate_exit" -eq 0 ]; then
    # Success branch: No reviewer configured.
    if [ -z "${SAIFAC_REVIEWER_SCRIPT:-}" ] || [ ! -f "${SAIFAC_REVIEWER_SCRIPT}" ]; then
      echo "[coder-start] Gate PASSED."
      exit 0
    fi

    # Run the reviewer
    # Use explicit sh: reviewer.sh is mounted read-only from the repo and may not be +x.
    echo "[coder-start] Running semantic reviewer: $SAIFAC_REVIEWER_SCRIPT"
    gate_output=$(sh "$SAIFAC_REVIEWER_SCRIPT" 2>&1) && gate_exit=0 || gate_exit=$?

    # Print captured output from reviewer.sh if not empty.
    if [ -n "${gate_output:-}" ]; then
      printf '%s\n' "$gate_output"
    fi

    # Success branch: both gate and reviewer passed.
    if [ "$gate_exit" -eq 0 ]; then
      echo "[coder-start] Gate PASSED (static checks + reviewer)."
      exit 0
    else
      # Log and proceed to error branch.
      echo "[coder-start] Reviewer FAILED (round $round/$GATE_RETRIES):"
    fi
  else
    # Log and proceed to error branch.
    echo "[coder-start] Gate FAILED (round $round/$GATE_RETRIES):"
  fi

  ######################
  # Failure branch: append the output to the task prompt and retry.
  ######################

  # If we've reached the max number of retries, exit with failure.
  if [ "$round" -ge "$GATE_RETRIES" ]; then
    break
  fi

  # Rebuild prompt: original task + failure feedback.
  current_task="$(printf '%s\n\n## Validation Failed — Fix Before Finishing\n\n```\n%s\n```\n\nFix the above issues.' \
    "$INITIAL_TASK" "$gate_output")"
done

echo "[coder-start] Exhausted $GATE_RETRIES inner round(s) without gate passing."
exit 1
