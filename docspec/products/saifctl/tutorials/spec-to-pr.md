---
persona: engineer
prereq_concepts: []
learns_concepts:
  - feat-run-loop
  - gate-reviewer-holdout
goal: Walk through writing a spec and running feat run to produce a passing PR from scratch
alt_paths:
  - name: Phased features
    when: Use this path when the feature is too large to converge in a single pass — e.g. the spec naturally splits into "data model", "service layer", "API" steps, or you want adversarial critics to run at intermediate checkpoints.
    differences_from_main_path:
      - Replace the single `spec.md` + `tests/` with a `phases/` directory containing one subdirectory per phase, each with its own `spec.md` + `tests/`.
      - Add `critics/<id>.md` templates at the feature root if you want adversarial review per phase; wire them in via `feature.yml`'s `phases.defaults.critics`.
      - Use `saifctl feat phases compile` before `feat run` to preview the subtask plan and catch config errors early.
      - The PR opens after **all** phases pass their gauntlet; if a later phase regresses earlier work, the cumulative test scope catches it and the loop retries that phase.
---

Tutorial intent for saifctl.
