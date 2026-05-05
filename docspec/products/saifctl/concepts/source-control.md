---
id: source-control
explains: how saifctl pushes feature branches and opens pull requests automatically when a run completes — covering GitHub, GitLab, Bitbucket, Azure Repos, and Gitea
learning_outcomes:
  - "`--push` auto-pushes the resulting branch to the configured remote when a run passes; `--pr` opens a PR."
  - Default remote inference (origin); URL override; custom branch name.
  - "Per-provider auth: GitHub (gh CLI / token), GitLab (glab / token), Bitbucket (app password), Azure Repos (PAT), Gitea (token)."
  - PR title/body templating from the spec/plan content.
  - One PR per feature (even for phased features) — reviewers see the feature whole, not phase-by-phase.
analogies:
  - "`gh pr create` automation around a run's resulting commit graph"
---

Body intent: cover the complete push/PR pipeline for the supported providers. Reference `concepts/feature-lifecycle.md` for where push/PR sits in the lifecycle.
