#!/usr/bin/env bash
# Per-phase gate (Level 1). The runner is bypassed for this phase via
# `tests.none: true`; the only assertion the inner loop runs is this gate.
# Non-zero exit retries the round (up to gate.retries, default 10).
set -euo pipefail

manifest="manifest.json"

if [[ ! -f "$manifest" ]]; then
  echo "gate: $manifest does not exist" >&2
  exit 1
fi

if [[ ! -s "$manifest" ]]; then
  echo "gate: $manifest is empty" >&2
  exit 1
fi

# Use jq if available; fall back to a python one-liner. The standard
# saifctl coder image ships both, so the failure branch below is
# unreachable in the documented setup. If a custom coder image strips
# both tools, prefer adding one back to the image rather than relying
# on a slimmed runtime — the gate has no way to recover from a missing
# verifier mid-round, so retrying it (`gate.retries`, default 10) just
# burns attempts.
if command -v jq >/dev/null 2>&1; then
  if ! jq -e 'type == "object" and (.version | type == "string" and length > 0) and (.entries | type == "array")' "$manifest" >/dev/null; then
    echo "gate: $manifest must contain a non-empty string \`version\` and an array \`entries\`" >&2
    exit 1
  fi
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$manifest" <<'PY'
import json, sys
p = sys.argv[1]
with open(p) as f:
    d = json.load(f)
assert isinstance(d, dict), "not an object"
v = d.get("version")
assert isinstance(v, str) and v, "version must be non-empty string"
e = d.get("entries")
assert isinstance(e, list), "entries must be an array"
PY
else
  # Environment problem, not a content problem. The orchestrator treats
  # any non-zero gate exit as failure-retry (`gate.retries`, default 10),
  # so we can't actually fail-fast from inside the script — the loop
  # will burn its retry budget on the missing verifier before the run
  # gives up. We still emit a clear "SETUP ERROR" message so the user
  # sees the underlying cause in the per-round logs and knows to fix
  # the coder image rather than the manifest. Exit 1 (not 2) keeps the
  # exit code in the standard pass/fail surface; promoting to exit 2
  # would not change the orchestrator's behaviour today.
  echo "gate: SETUP ERROR — neither jq nor python3 available in the coder container; cannot verify $manifest. Add jq or python3 to the coder image (the standard saifctl coder image ships both)." >&2
  exit 1
fi

echo "gate: $manifest OK"
exit 0
