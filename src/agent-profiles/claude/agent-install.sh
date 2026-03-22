#!/bin/bash
# Claude Code agent setup script.
#
# Installs @anthropic-ai/claude-code via npm when the claude binary is not on PATH
# (same packages as StrongDM's reference coder image). Requires Node/npm in the coder image.
#
# Pinned version (checked npm 2026-03-21): https://www.npmjs.com/package/@anthropic-ai/claude-code

CLAUDE_CLI_VERSION='2.1.81'

set -euo pipefail
trap 'ec=$?; echo "[agent-install/claude] Finished Claude Code setup (agent-install.sh, exit code ${ec})."' EXIT
echo "[agent-install/claude] Installing Claude Code (agent-install.sh)..."

if command -v claude &>/dev/null; then
  echo "[agent-install/claude] claude is already available: $(claude --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "[agent-install/claude] ERROR: npm is not available in this image." >&2
  echo "[agent-install/claude] Use a sandbox profile with Node.js (e.g. node-pnpm-python) or a *-node profile, or bake @anthropic-ai/claude-code into a custom --coder-image." >&2
  exit 1
fi

echo "[agent-install/claude] Installing @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION} via npm..."
npm install -g "@anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}"
echo "[agent-install/claude] claude is available: $(claude --version 2>/dev/null || echo 'unknown version')"
