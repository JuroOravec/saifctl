#!/bin/bash
# Copilot CLI agent setup script.
#
# Copilot CLI is installed via npm if not already present.
# This script ensures it is available and exits with a clear error if npm is missing.
#
# Installation docs: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-in-the-cli
#
# Pinned version (checked npm 2026-03-21): https://www.npmjs.com/package/@github/copilot

COPILOT_CLI_VERSION='1.0.10'

set -euo pipefail
trap 'ec=$?; echo "[agent-start/copilot] Finished Copilot CLI setup (agent-start.sh, exit code ${ec})."' EXIT
echo "[agent-start/copilot] Installing Copilot CLI (agent-start.sh)..."

if command -v copilot &>/dev/null; then
  echo "[agent-start/copilot] copilot CLI is already installed: $(copilot --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "[agent-start/copilot] ERROR: npm is not available in this image." >&2
  echo "[agent-start/copilot] Install Node.js 25+ or supply --agent-script with a pre-installed copilot binary." >&2
  exit 1
fi

echo "[agent-start/copilot] Installing @github/copilot@${COPILOT_CLI_VERSION} via npm..."
npm install -g "@github/copilot@${COPILOT_CLI_VERSION}"
echo "[agent-start/copilot] copilot CLI installed: $(copilot --version 2>/dev/null || echo 'unknown version')"
