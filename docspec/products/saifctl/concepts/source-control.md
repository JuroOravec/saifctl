---
id: source-control
explains: how saifctl integrates with git — pushing feature branches, opening pull requests, and bringing run output back into the developer's working repo across GitHub, GitLab, Bitbucket, Azure Repos, and Gitea
learning_outcomes:
  - '`--push` auto-pushes the resulting branch to the configured remote when a run passes; `--pr` opens a PR.'
  - Default remote inference (origin); URL override; custom branch name.
  - 'Per-provider auth: GitHub (gh CLI / token), GitLab (glab / token), Bitbucket (app password), Azure Repos (PAT), Gitea (token).'
  - PR title/body templating from the spec/plan content.
  - One PR per feature (even for phased features) — reviewers see the feature whole, not phase-by-phase.
  - "Three ways to consume a finished run's commits locally: `saifctl run apply <id>` lays them on a fresh `saifctl/...` branch (optionally `--push <target>` and `--pr`); `saifctl run merge <id>` brings them into the current branch (or `--into <branch>`) directly; `saifctl run export <id>` writes a single `.patch` file."
  - "`run merge` is safe with a dirty working tree under `--allow-dirty` — it stashes the user's pre-merge state (including untracked + staged-but-uncommitted files) before applying and restores it via `git stash apply <sha>` after, leaving the stash entry in place as a recovery point. `run apply` is unaffected (it works on a separate branch via a temp worktree)."
  - '`run merge` strategies: `cherry-pick` (default — replay each agent commit, preserving message and author), `squash` (collapse to one commit), `worktree` (apply to working tree without committing, for review).'
  - "`run merge` never overrides the user's git identity. Author for `cherry-pick` is the original commit author; author and committer for `squash` follow git config (or `--author <id>`)."
analogies:
  - "`gh pr create` automation around a run's resulting commit graph"
  - "`run merge` ≈ `git cherry-pick`/`git apply` against the agent's commit stack, but safe with dirty trees"
---

Body intent: cover the complete push/PR pipeline for the supported providers, plus the three local-consumption paths (`apply`, `merge`, `export`). Reference `concepts/feature-lifecycle.md` for where push/PR sits in the lifecycle.
