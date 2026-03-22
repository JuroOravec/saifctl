#!/bin/bash
# Qwen Code agent setup script.
#
# Installs @qwen-code/qwen-code via npm when the qwen binary is not on PATH.
#
# Pinned version (checked npm 2026-03-21): https://www.npmjs.com/package/@qwen-code/qwen-code

QWEN_CLI_VERSION='0.12.6'

set -euo pipefail
trap 'ec=$?; echo "[agent-start/qwen] Finished qwen setup (agent-start.sh, exit code ${ec})."' EXIT
echo "[agent-start/qwen] Installing qwen (agent-start.sh)..."

if command -v qwen &>/dev/null; then
  echo "[agent-start/qwen] qwen is already available: $(qwen --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "[agent-start/qwen] ERROR: npm is not available in this image." >&2
  echo "[agent-start/qwen] Use a sandbox profile with Node.js or a *-node profile, or bake @qwen-code/qwen-code into a custom --coder-image." >&2
  exit 1
fi

echo "[agent-start/qwen] Installing @qwen-code/qwen-code@${QWEN_CLI_VERSION} via npm..."
npm install -g "@qwen-code/qwen-code@${QWEN_CLI_VERSION}"
echo "[agent-start/qwen] qwen is available: $(qwen --version 2>/dev/null || echo 'unknown version')"
