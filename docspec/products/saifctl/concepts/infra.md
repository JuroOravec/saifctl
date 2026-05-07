---
id: infra
explains: saifctl's two-phase execution model (coding vs staging) and the engine choices (docker, local, helm-planned) that decide where each phase actually runs
learning_outcomes:
  - The two phases — coding (agent edits code in container) and staging (tests run against the diff) — each with their own environment block in the feature config.
  - 'Engine choices: `docker` (default; Cedar/Leash isolation), `local` (no container; faster iteration; use only for trusted code), `helm` (planned; remote Kubernetes execution).'
  - 'When to use which: docker for production runs, local for fast inner-loop work, helm for distributed/remote execution.'
  - The relationship to Hatchet (orchestrator-level) — engines are about *where* a phase runs, Hatchet is about *how* runs are dispatched/resumed.
analogies:
  - test runner config (jest / vitest) but for the entire pipeline
  - the difference between `docker run` (local) and `docker run` (in CI) — same image, different host
---

Body intent: cover the engine taxonomy and selection criteria. This is the user-facing simplified version; an internal companion lives at `docs/contributing/infra.md`.
