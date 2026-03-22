#!/bin/bash
# Gemini CLI agent setup script.
#
# Installs @google/gemini-cli via npm when the gemini binary is not on PATH.
#
# Pinned version (checked npm 2026-03-21): https://www.npmjs.com/package/@google/gemini-cli

GEMINI_CLI_VERSION='0.34.0'

set -euo pipefail
trap 'ec=$?; echo "[agent-start/gemini] Finished Gemini CLI setup (agent-start.sh, exit code ${ec})."' EXIT
echo "[agent-start/gemini] Installing Gemini CLI (agent-start.sh)..."

if command -v gemini &>/dev/null; then
  echo "[agent-start/gemini] gemini is already available: $(gemini --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "[agent-start/gemini] ERROR: npm is not available in this image." >&2
  echo "[agent-start/gemini] Use a sandbox profile with Node.js or a *-node profile, or bake @google/gemini-cli into a custom --coder-image." >&2
  exit 1
fi

echo "[agent-start/gemini] Installing @google/gemini-cli@${GEMINI_CLI_VERSION} via npm..."
npm install -g "@google/gemini-cli@${GEMINI_CLI_VERSION}"
echo "[agent-start/gemini] gemini is available: $(gemini --version 2>/dev/null || echo 'unknown version')"
