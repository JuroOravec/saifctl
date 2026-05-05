---
prereq_concepts:
  - feat-run-loop
arrival_context: docs-link
search_terms:
  - saifctl run rules
  - steer agent
  - feedback to agent
  - fix agent direction
user_stage: established
---

# Task: steer the agent live with run rules

The reader has an executing run that's heading the wrong direction (or wants pre-emptive guidance for a re-run). They want to add short plain-language instructions to the agent's task prompt so the next inner round picks them up — without restarting the run.

Success: they can add/list/remove run rules via `saifctl run rules`, see them merged into the task prompt on the next round, and use this in two modes: live (during execution) and offline (between `run start` invocations).
