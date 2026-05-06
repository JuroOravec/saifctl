# Agent: copilot

Run AI-assisted coding tasks using [GitHub Copilot CLI](https://github.com/github/copilot-cli), routing requests through GitHub's API. Invoke with `saifctl feat run --agent copilot`.

## Installation

Copilot CLI is installed automatically at runtime when missing:

```bash
npm install -g @github/copilot
```

Requires Node.js in the coder image.

## Authentication

Copilot CLI authenticates via a GitHub token. Variables are checked in this order of precedence:

| Variable | Notes |
|----------|-------|
| `COPILOT_GITHUB_TOKEN` | Native Copilot token variable — highest precedence. |
| `GH_TOKEN` | GitHub CLI token — second precedence. |
| `GITHUB_TOKEN` | Standard GitHub Actions token — third precedence. |
| `LLM_API_KEY` | Generic saifctl credential — fallback. Mapped to `COPILOT_GITHUB_TOKEN` automatically. |

Set any one of the above; the agent resolves them in order so you only need `LLM_API_KEY` if you have no Copilot-native token.

No base-URL override is supported. Copilot CLI routes all requests through GitHub's API — there is no way to point it at a custom endpoint.

## Model selection

Set `LLM_MODEL_ID` to a GitHub-managed model identifier (e.g. `claude-sonnet-4.5`, `gpt-4.1`, `gemini-3-pro`). These are **not** arbitrary `provider/model` strings — they must match names from GitHub's Copilot model list.

If `LLM_MODEL_ID` is unset, Copilot uses its default (currently Claude Sonnet 4.5).

## CLI flags used by the agent

| Flag | Description |
|------|-------------|
| `--prompt` / `-p` | Non-interactive (programmatic) mode. |
| `--model <id>` | Model override, sourced from `LLM_MODEL_ID`. Omitted when `LLM_MODEL_ID` is unset. |
| `--allow-all` | Approve all file, shell, and network tool use without prompts. Safe because Leash sandboxes the container. |
| `--no-ask-user` | Disable the `ask_user` tool so Copilot does not pause for interactive input. |
| `--no-auto-update` | Suppress automatic CLI self-update during a run. |
| `--autopilot` | Enable autonomous multi-step continuation. |

## Change detection

Copilot CLI does not expose a `--no-auto-commits` flag. saifctl detects changes made by the agent via `git log` (diff + recent commits) rather than relying on the agent to signal completion via an explicit flag.

## Privilege drop

The agent runs `copilot` as `$SAIFCTL_UNPRIV_USER` via `runuser`, which resets `HOME`/`PATH` to the unprivileged user's login environment. The CLI binary is installed into `$SAIFCTL_UNPRIV_NPM_PREFIX/bin`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `COPILOT_GITHUB_TOKEN` | One of these is required | See [Authentication](#authentication) — highest precedence. |
| `GH_TOKEN` | One of these is required | See [Authentication](#authentication) — second precedence. |
| `GITHUB_TOKEN` | One of these is required | See [Authentication](#authentication) — third precedence. |
| `LLM_API_KEY` | Fallback | See [Authentication](#authentication) — mapped to `COPILOT_GITHUB_TOKEN`. |
| `LLM_MODEL_ID` | No | GitHub-managed model identifier forwarded via `--model`. |
| `SAIFCTL_TASK_PATH` | Yes | Path to the file containing the task prompt. |
| `SAIFCTL_UNPRIV_USER` | Yes | Unprivileged user to run `copilot` as. Baked into each coder Dockerfile. |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes | npm prefix where the `copilot` binary is installed. |
| `SAIFCTL_WORKSPACE_BASE` | No | Workspace directory (default: `/workspace`). `copilot` is invoked with this as cwd. |

## Usage examples

**Run a feature using the copilot agent:**

```bash
export LLM_API_KEY=ghp_…
saifctl feat run --agent copilot --feature my-feature-id
```

**Run with a Copilot-native token and a specific model:**

```bash
export COPILOT_GITHUB_TOKEN=ghp_…
export LLM_MODEL_ID=gpt-4.1
saifctl feat run --agent copilot --feature my-feature-id
```

**Run with a GitHub Actions token:**

```bash
export GITHUB_TOKEN="${{ secrets.GITHUB_TOKEN }}"
saifctl feat run --agent copilot --feature my-feature-id
```

## Requirements

- An active [GitHub Copilot subscription](https://github.com/features/copilot).
- A valid GitHub token with Copilot access (see Authentication above).
- Node.js available in the coder image (for `npm install -g @github/copilot`).
