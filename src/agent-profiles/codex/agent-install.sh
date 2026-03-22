#!/bin/bash
# Codex agent setup script.
#
# Installs @openai/codex via npm when the codex binary is not on PATH.
#
# Pinned version (checked npm 2026-03-21): https://www.npmjs.com/package/@openai/codex

CODEX_CLI_VERSION='0.116.0'

set -euo pipefail
trap 'ec=$?; echo "[agent-install/codex] Finished Codex setup (agent-install.sh, exit code ${ec})."' EXIT
echo "[agent-install/codex] Installing Codex (agent-install.sh)..."

if command -v codex &>/dev/null; then
  echo "[agent-install/codex] codex is already available: $(codex --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "[agent-install/codex] ERROR: npm is not available in this image." >&2
  echo "[agent-install/codex] Use a sandbox profile with Node.js or a *-node profile, or bake @openai/codex into a custom --coder-image." >&2
  exit 1
fi

echo "[agent-install/codex] Installing @openai/codex@${CODEX_CLI_VERSION} via npm..."
npm install -g "@openai/codex@${CODEX_CLI_VERSION}"
echo "[agent-install/codex] codex is available: $(codex --version 2>/dev/null || echo 'unknown version')"
