# Source control integration

When `saifctl feat run` completes successfully, it can push the resulting branch and open a pull request without any manual git steps. This page explains how the push/PR pipeline works, how authentication is configured per provider, and how pull request content is generated.

## Where source control fits in the lifecycle

Source control integration is the final stage of a factory run. After all phases pass their gates and the reviewer approves, the commit graph is ready. At that point `--push` and `--pr` take effect. For a broader view of what happens before that point, see [Feature lifecycle](feature-lifecycle.md).

## Push and PR flags

Two flags control automatic source control actions:

- `--push` — pushes the feature branch to the configured remote when the run passes all gates.
- `--pr` — opens a pull request after pushing.

Neither flag does anything if the run fails; you only get a pushed branch or PR from a passing run.

## Remote and branch resolution

By default, saifctl pushes to the `origin` remote. You can override this by passing a remote name, slug (`owner/repo`), or URL directly to `--push`:

```
saifctl feat run --feature <id> --push upstream
```

The branch name defaults to `saifctl/<feature>-<runId>-<diffHash>`. Override it with `--branch`:

```
saifctl feat run --feature <id> --push --branch my-custom-branch
```

## Per-provider authentication

saifctl supports five providers. Each uses its own credential mechanism:

| Provider    | Authentication                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| GitHub      | `GITHUB_TOKEN` env var                                                                               |
| GitLab      | `GITLAB_TOKEN` env var; `GITLAB_URL` env var (optional, for self-hosted instances)                   |
| Bitbucket   | PAT or repository access token via `BITBUCKET_TOKEN` + `BITBUCKET_USERNAME` env vars                 |
| Azure Repos | Personal access token via `AZURE_DEVOPS_TOKEN` env var                                               |
| Gitea       | `GITEA_TOKEN` + `GITEA_USERNAME` env vars; `GITEA_URL` env var (optional, for self-hosted instances) |

Use the `--git-provider` flag to select the hosting provider (`github` | `gitlab` | `bitbucket` | `azure` | `gitea`; default: `github`).

## PR title and body

When `--pr` is set, saifctl generates the pull request content from the feature's spec and plan. The PR title is derived from the feature ID and its top-level description. The body includes:

- A summary of what the feature implements, drawn from the plan.
- The list of phases and what each produced.
- Links to relevant spec files.

You do not write PR descriptions manually; they come from the same source of truth that drove the run.

## One PR per feature

Even when a feature has many phases, saifctl opens a single pull request. Reviewers see the feature as a whole — all phases committed together on one branch — rather than a series of incremental PRs. This matches how reviewers evaluate work: by outcome, not by intermediate steps.

## What you do not control here

Source control integration does not rebase, squash, or amend history after the run. It pushes the commit graph exactly as the agents produced it. If your repository requires a specific commit structure, apply that before or after the run; do not rely on saifctl to reshape history.
