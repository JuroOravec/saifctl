---
persona: engineer
tasks:
  - run-first-feature
goal: Run saifctl feat run end-to-end from spec file to opened PR
optional_walkthroughs:
  - title: Multi-phase feature
    when: The feature is large enough that the agent can't converge in one pass — typically anything spanning multiple modules, requiring a migration step, or needing adversarial review at intermediate checkpoints.
    steps:
      - Add a `phases/` directory under the feature; one subdirectory per phase (e.g. `phases/01-core/`, `phases/02-extras/`).
      - Each phase subdirectory carries its own `spec.md` and `tests/` (just like a single-phase feature, but scoped to that phase).
      - Optionally add `critics/` (at the feature root) with one `<id>.md` template per critic (e.g. `paranoid.md`, `security.md`); attach them to phases via `feature.yml`'s `phases.defaults.critics` or per-phase `phase.yml`.
      - Run `saifctl feat phases compile` to preview the subtask plan saifctl will execute.
      - Run `saifctl feat run` — the loop iterates phase-by-phase; each phase passes its gate before the next starts. Critic discover/fix pairs run after the implementer subtask in each phase.
    reference: |
      A complete, annotated phased feature lives at `saifctl/features/_phases-example/`. The
      leading underscore reserves it as docs, not a real feature. Its `_README.md` walks
      through every part of the contract (feature.yml, phase.yml override, multiple critics,
      mustache variables, file partials).
---

How-to intent for saifctl.
