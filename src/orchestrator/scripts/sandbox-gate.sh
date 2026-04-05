#!/usr/bin/env bash
# Sandbox gate — always passes.
#
# In sandbox runs (`saifctl sandbox`), the agent is not expected to produce working,
# test-passing code. There is no validation gate. The agent exits after one round.
exit 0
