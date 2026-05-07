---
prereq_concepts:
  - per-phase-config
  - feat-run-loop
arrival_context: docs-link
search_terms:
  - configure phase
  - phase override
  - phase.yml
  - per-phase model
  - per-phase gate
  - per-phase container
user_stage: established
---

# Task: configure one phase to behave differently from the rest of the run

The reader has a phased feature on disk and wants one phase to override a run-level setting (different gate, model, container, runner, or attempt budget) without changing the other phases.

Success: they can write a `phases/<id>/phase.yml` (or inline override at `feature.yml.phases.phases.<id>`), preview the resolved subtask manifest with `saifctl feat phases compile`, and run `saifctl feat run` knowing which lifecycle level their override sits at and what it costs at the phase boundary.
