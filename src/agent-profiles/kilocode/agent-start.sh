#!/bin/bash
# Kilo Code CLI agent setup script.
#
# Installs @kilocode/cli via npm if not already present.
# Requires Node.js 20.18.1+ (LTS) — the project's .nvmrc minimum.
# Docs: https://kilocode.ai/docs/cli
#
# On older CPUs without AVX support (Intel Xeon Nehalem, AMD Bulldozer, etc.)
# the standard npm package will crash with "Illegal instruction". In that case,
# download the -baseline variant from GitHub releases manually.
#
# Pinned version (checked npm 2026-03-21): https://www.npmjs.com/package/@kilocode/cli
KILOCODE_CLI_VERSION='7.1.0'

set -euo pipefail
trap 'ec=$?; echo "[agent-start/kilocode] Finished Kilo Code CLI setup (agent-start.sh, exit code ${ec})."' EXIT
echo "[agent-start/kilocode] Installing Kilo Code CLI (agent-start.sh)..."

if command -v kilo &>/dev/null; then
  echo "[agent-start/kilocode] kilo CLI is already installed: $(kilo --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

if ! command -v npm &>/dev/null; then
  echo "[agent-start/kilocode] ERROR: npm is not available in this image." >&2
  echo "[agent-start/kilocode] Install Node.js 20.18.1+ or supply --agent-script with a pre-installed kilo binary." >&2
  exit 1
fi

echo "[agent-start/kilocode] Installing @kilocode/cli@${KILOCODE_CLI_VERSION} via npm..."
npm install -g "@kilocode/cli@${KILOCODE_CLI_VERSION}"
echo "[agent-start/kilocode] kilo CLI installed: $(kilo --version 2>/dev/null || echo 'unknown version')"
