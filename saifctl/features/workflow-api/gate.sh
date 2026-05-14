#!/usr/bin/env bash
# Gate for workflow-api feature phases.
#
# Runs the project's `check:agent` script — types, lint, format, unit tests,
# custom constraints — with the agent reporter so failures surface as
# structured JSON the agent can parse. Exit code is what saifctl's inner
# loop reads: 0 = pass, non-zero = retry (up to SAIFCTL_GATE_RETRIES).
#
# `check:agent` covers everything the project test suite would run in CI,
# so the same gate passes both inside the convergence loop and on the
# regular `pnpm check` invocation outside it.
set -eu
cd /workspace
pnpm check:agent
