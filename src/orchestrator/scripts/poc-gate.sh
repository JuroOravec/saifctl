#!/usr/bin/env bash
# POC gate — always passes.
#
# POC runs are exploration runs: the agent is not expected to produce working,
# test-passing code. There is no validation gate. The agent exits after one
# pass and the designer post-processes the saifctl/ changes it wrote.
exit 0
