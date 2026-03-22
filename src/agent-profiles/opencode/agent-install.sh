#!/bin/bash
# OpenCode agent setup script.
#
# Installs opencode-ai via npm when the opencode binary is not on PATH.
#
# Pinned version (checked npm 2026-03-21): https://www.npmjs.com/package/opencode-ai

OPENCODE_CLI_VERSION='1.2.27'

set -euo pipefail
trap 'ec=$?; echo "[agent-install/opencode] Finished OpenCode setup (agent-install.sh, exit code ${ec})."' EXIT
echo "[agent-install/opencode] Installing OpenCode (agent-install.sh)..."

if command -v opencode &>/dev/null; then
  echo "[agent-install/opencode] opencode is already available: $(opencode --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "[agent-install/opencode] ERROR: npm is not available in this image." >&2
  echo "[agent-install/opencode] Use a sandbox profile with Node.js or a *-node profile, or bake opencode-ai into a custom --coder-image." >&2
  exit 1
fi

echo "[agent-install/opencode] Installing opencode-ai@${OPENCODE_CLI_VERSION} via npm..."
npm install -g "opencode-ai@${OPENCODE_CLI_VERSION}"
echo "[agent-install/opencode] opencode is available: $(opencode --version 2>/dev/null || echo 'unknown version')"
