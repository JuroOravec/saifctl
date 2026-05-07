# Command: feat

Run AI agents safely against a feature's specs, or scaffold and design features end-to-end.

```
saifctl feat <subcommand> [options]
```

Alias: `saifctl feature`

## Subcommands

| Subcommand                                   | Description                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| [`new`](#feat-new)                           | Create scaffolding for a new feature.                                   |
| [`design-discovery`](#feat-design-discovery) | Gather context with MCP/tools; write `discovery.md`.                    |
| [`design-specs`](#feat-design-specs)         | Generate specs from a feature's proposal (step 1 of design).            |
| [`design-tests`](#feat-design-tests)         | Generate tests from existing specs (step 2 of design).                  |
| [`design-fail2pass`](#feat-design-fail2pass) | Verify generated tests initially fail (step 3 of design).               |
| [`design`](#feat-design)                     | Full design workflow: discovery (optional) → specs → tests → fail2pass. |
| [`run`](#feat-run)                           | Start an agent to implement the specs.                                  |
| [`phases`](#feat-phases)                     | Inspect or validate a phased feature's compilation.                     |

---

## feat new

Create scaffolding for a new feature. Prompts for name (and optional description) when run interactively.

```
saifctl feat new [options]
```

| Flag            | Alias | Type    | Default               | Description                                                 |
| --------------- | ----- | ------- | --------------------- | ----------------------------------------------------------- |
| `--name`        | `-n`  | string  | _(prompted)_          | Feature name (kebab-case, e.g. `add-greeting-cmd`).         |
| `--yes`         | `-y`  | boolean | `false`               | Non-interactive mode. Requires `--name`/`-n`.               |
| `--desc`        |       | string  | _(prompted)_          | Brief description. Skips the description prompt.            |
| `--project-dir` |       | string  | `(current directory)` | Project directory.                                          |
| `--saifctl-dir` |       | string  | `saifctl`             | Path to the saifctl directory relative to the project root. |

**Output:** Creates `saifctl/features/<name>/`. If `--desc` is provided (or entered interactively), writes `proposal.md` inside that directory.

---

## feat design-discovery

Gather context for a feature using MCP servers or local tool files; writes `discovery.md` into the feature directory. Optional step before `design-specs`.

```
saifctl feat design-discovery [options]
```

| Flag                      | Alias | Type   | Default               | Description                                                                                         |
| ------------------------- | ----- | ------ | --------------------- | --------------------------------------------------------------------------------------------------- |
| `--name`                  | `-n`  | string | _(prompted)_          | Feature name (kebab-case).                                                                          |
| `--discovery-mcp`         |       | string |                       | Named MCP server: `name=http(s)://url`. Comma-separated or repeated. Required format: `name=url`.   |
| `--discovery-tool`        |       | string |                       | Path to a JS/TS file exporting Mastra tools.                                                        |
| `--discovery-prompt`      |       | string |                       | Inline heuristic prompt for the discovery agent. Mutually exclusive with `--discovery-prompt-file`. |
| `--discovery-prompt-file` |       | string |                       | Path to a heuristic prompt file. Mutually exclusive with `--discovery-prompt`.                      |
| `--model`                 |       | string |                       | LLM model override. Single global or comma-separated `agent=model` pairs.                           |
| `--base-url`              |       | string |                       | LLM base URL override. Single global or comma-separated `agent=url` pairs.                          |
| `--project-dir`           |       | string | `(current directory)` | Project directory.                                                                                  |
| `--saifctl-dir`           |       | string | `saifctl`             | Path to the saifctl directory relative to the project root.                                         |

Requires at least one of `--discovery-mcp`, `--discovery-tool`, or equivalent config entries.

---

## feat design-specs

Generate specs (and a plan) from a feature's `proposal.md`. If `discovery.md` is present it is included in the designer prompt.

```
saifctl feat design-specs [options]
```

| Flag            | Alias | Type    | Default               | Description                                                                             |
| --------------- | ----- | ------- | --------------------- | --------------------------------------------------------------------------------------- |
| `--name`        | `-n`  | string  | _(prompted)_          | Feature name (kebab-case).                                                              |
| `--yes`         | `-y`  | boolean | `false`               | Non-interactive mode. Requires `--name`/`-n`. Assumes redo when designer output exists. |
| `--force`       | `-f`  | boolean | `false`               | Always re-run the designer, overwriting existing spec files without prompting.          |
| `--designer`    |       | string  | _(profile default)_   | Designer profile for spec generation.                                                   |
| `--model`       |       | string  |                       | LLM model override.                                                                     |
| `--base-url`    |       | string  |                       | LLM base URL override.                                                                  |
| `--project-dir` |       | string  | `(current directory)` | Project directory.                                                                      |
| `--saifctl-dir` |       | string  | `saifctl`             | Path to the saifctl directory relative to the project root.                             |

---

## feat design-tests

Generate test scaffold files from existing specs.

```
saifctl feat design-tests [options]
```

| Flag             | Alias | Type    | Default                 | Description                                                 |
| ---------------- | ----- | ------- | ----------------------- | ----------------------------------------------------------- |
| `--name`         | `-n`  | string  | _(prompted)_            | Feature name (kebab-case).                                  |
| `--test-profile` |       | string  | `node-vitest`           | Test profile id.                                            |
| `--indexer`      |       | string  | `none`                  | Indexer profile (`shotgun` or `none`).                      |
| `--project`      | `-p`  | string  | _(package.json `name`)_ | Project name override for the indexer.                      |
| `--skip-catalog` |       | boolean | `false`                 | Skip catalog generation; use existing `tests.json`.         |
| `--force`        | `-f`  | boolean | `false`                 | Overwrite existing test scaffold files.                     |
| `--model`        |       | string  |                         | LLM model override.                                         |
| `--base-url`     |       | string  |                         | LLM base URL override.                                      |
| `--project-dir`  |       | string  | `(current directory)`   | Project directory.                                          |
| `--saifctl-dir`  |       | string  | `saifctl`               | Path to the saifctl directory relative to the project root. |

---

## feat design-fail2pass

Verify that the generated feature tests fail against the current codebase (i.e. they test something that is not yet implemented). Exits 1 if tests pass or the verification run fails.

Automatically skipped when `feature.yml` sets `tests.mutable: true` (or the project default is `--no-strict`) without an explicit `tests.fail2pass: true` override — in that configuration the agent writes the tests, so initial-failure verification does not apply.

```
saifctl feat design-fail2pass [options]
```

| Flag                 | Alias | Type    | Default                 | Description                                                                |
| -------------------- | ----- | ------- | ----------------------- | -------------------------------------------------------------------------- |
| `--name`             | `-n`  | string  | _(prompted)_            | Feature name (kebab-case).                                                 |
| `--test-profile`     |       | string  | `node-vitest`           | Test profile id.                                                           |
| `--project`          | `-p`  | string  | _(package.json `name`)_ | Project name override.                                                     |
| `--sandbox-base-dir` |       | string  | _(profile default)_     | Sandbox base directory.                                                    |
| `--engine`           |       | string  |                         | Override infra engine: `docker`, `local`, or `coding=docker,staging=helm`. |
| `--profile`          |       | string  |                         | Sandbox profile. Sets defaults for startup/stage scripts.                  |
| `--test-script`      |       | string  |                         | Shell script overriding `test.sh` inside the test-runner container.        |
| `--test-image`       |       | string  |                         | Test runner Docker image tag.                                              |
| `--startup-script`   |       | string  |                         | Shell script run once to install workspace deps.                           |
| `--stage-script`     |       | string  |                         | Shell script mounted into the staging container.                           |
| `--include-dirty`    |       | boolean | `false`                 | Include untracked/uncommitted files in the sandbox copy.                   |
| `--project-dir`      |       | string  | `(current directory)`   | Project directory.                                                         |
| `--saifctl-dir`      |       | string  | `saifctl`               | Path to the saifctl directory relative to the project root.                |

---

## feat design

Full design workflow in one command: optional discovery → spec generation → test generation → fail2pass verification. Accepts the union of flags from all four design steps.

```
saifctl feat design [options]
```

Key flags (see individual subcommands for the full list):

| Flag               | Alias | Type    | Default               | Description                                                                       |
| ------------------ | ----- | ------- | --------------------- | --------------------------------------------------------------------------------- |
| `--name`           | `-n`  | string  | _(prompted)_          | Feature name (kebab-case).                                                        |
| `--yes`            | `-y`  | boolean | `false`               | Non-interactive mode. Requires `--name`/`-n`.                                     |
| `--force`          | `-f`  | boolean | `false`               | Overwrite existing spec and test files.                                           |
| `--designer`       |       | string  | _(profile default)_   | Designer profile for spec generation.                                             |
| `--test-profile`   |       | string  | `node-vitest`         | Test profile id.                                                                  |
| `--indexer`        |       | string  | `none`                | Indexer profile.                                                                  |
| `--discovery-mcp`  |       | string  |                       | Named MCP server (`name=url`). Only runs discovery when MCP/tools are configured. |
| `--discovery-tool` |       | string  |                       | Path to a JS/TS file exporting Mastra tools.                                      |
| `--model`          |       | string  |                       | LLM model override.                                                               |
| `--base-url`       |       | string  |                       | LLM base URL override.                                                            |
| `--project-dir`    |       | string  | `(current directory)` | Project directory.                                                                |
| `--saifctl-dir`    |       | string  | `saifctl`             | Path to the saifctl directory relative to the project root.                       |

Discovery runs only when at least one MCP server or tool is configured (via flag or config).

---

## feat run

Start an agent to implement a feature's specs. The loop runs until tests pass, up to `--max-runs` iterations.

**Phased features:** if the feature directory contains a `phases/` subdirectory, saifctl pre-flight-validates `feature.yml` and every `phase.yml`, then compiles the phase graph into per-phase implementer subtasks plus per-critic discover/fix subtask pairs. The compiled plan can be previewed without running via `feat phases compile`.

```
saifctl feat run [options]
```

### Identity and feature selection

| Flag     | Alias | Type   | Default      | Description                |
| -------- | ----- | ------ | ------------ | -------------------------- |
| `--name` | `-n`  | string | _(prompted)_ | Feature name (kebab-case). |

### Run loop control

| Flag                       | Alias | Type    | Default | Description                                                                                                                                                                                             |
| -------------------------- | ----- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--max-runs`               |       | string  | `5`     | Max full pipeline runs before giving up.                                                                                                                                                                |
| `--run-timeout`            |       | string  | `none`  | Total wall-clock budget. Accepts a duration string (`1h`, `90m`, `30s`, `1h30m`), a millisecond integer (e.g. `3600000`), or `none`. Aborts and saves on expiry; resume with `saifctl run resume <id>`. |
| `--subtask-timeout`        |       | string  | `1h`    | Per-subtask wall-clock budget. Same format as `--run-timeout`. `none` disables.                                                                                                                         |
| `--strict` / `--no-strict` |       | boolean | `true`  | Default mutability for feature/phase test dirs. `--strict` keeps tests immutable unless `tests.mutable: true`; `--no-strict` flips the default. `saifctl/tests/` stays immutable regardless.            |
| `--subtasks`               |       | string  |         | (Escape hatch) Path to a subtasks JSON file. Prefer `phases/` or `subtasks.json` in the feature dir.                                                                                                    |

### Agent

| Flag                     | Alias | Type    | Default             | Description                                                                                                      |
| ------------------------ | ----- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--agent`                |       | string  | `openhands`         | Agent profile. Used for gate script resolution.                                                                  |
| `--agent-script`         |       | string  | _(profile default)_ | Path to the coding agent script.                                                                                 |
| `--agent-install-script` |       | string  | _(profile default)_ | Path to the one-time agent install script.                                                                       |
| `--agent-env`            |       | string  |                     | Extra env vars: `KEY=VALUE` or comma-separated `KEY1=VAL1,KEY2=VAL2`.                                            |
| `--agent-env-file`       |       | string  |                     | Path(s) to `.env` file(s). Later overrides earlier for duplicate keys.                                           |
| `--agent-secret`         |       | string  |                     | Env var names to copy from host into the coder secret env (comma-separated). Values are never passed on the CLI. |
| `--agent-secret-file`    |       | string  |                     | Path(s) to `.env` files with secret key-value pairs.                                                             |
| `--gate-script`          |       | string  | _(profile default)_ | Shell script run inside the Leash container after each round.                                                    |
| `--gate-retries`         |       | string  | `10`                | Max gate retries per run.                                                                                        |
| `--coder-image`          |       | string  | _(profile default)_ | Docker image for the coder container.                                                                            |
| `--dangerous-no-leash`   |       | boolean | `false`             | Skip Leash; run the coder container with plain `docker run`. For no container, use `--engine local`.             |
| `--cedar`                |       | string  | _(built-in policy)_ | Absolute path to Cedar policy file for Leash.                                                                    |

### Test runner and sandbox

| Flag                  | Alias | Type    | Default             | Description                                                                                       |
| --------------------- | ----- | ------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `--test-profile`      |       | string  | `node-vitest`       | Test profile id.                                                                                  |
| `--test-script`       |       | string  |                     | Shell script overriding `test.sh` inside the test-runner container.                               |
| `--test-image`        |       | string  |                     | Test runner Docker image tag.                                                                     |
| `--sandbox-base-dir`  |       | string  | _(profile default)_ | Sandbox base directory.                                                                           |
| `--profile`           |       | string  |                     | Sandbox profile.                                                                                  |
| `--engine`            |       | string  |                     | Override infra engine: `docker`, `local`, or per-environment (e.g. `coding=docker,staging=helm`). |
| `--startup-script`    |       | string  |                     | Shell script run once to install workspace deps.                                                  |
| `--stage-script`      |       | string  |                     | Shell script mounted into the staging container.                                                  |
| `--include-dirty`     |       | boolean | `false`             | Include untracked/uncommitted files in the sandbox copy.                                          |
| `--no-reviewer`       |       | boolean | `false`             | Skip the semantic AI reviewer (Argus) after static checks.                                        |
| `--test-retries`      |       | string  | `1`                 | How many times to retry when tests fail.                                                          |
| `--resolve-ambiguity` |       | string  | `ai`                | Handle ambiguous spec failures: `ai`, `prompt`, or `off`.                                         |

### Storage and output

| Flag             | Alias | Type    | Default  | Description                                                                                 |
| ---------------- | ----- | ------- | -------- | ------------------------------------------------------------------------------------------- |
| `--storage`      |       | string  | `local`  | Storage backend: `local`, `s3`, `s3://bucket/prefix`, or per-DB (`runs=local,tasks=s3`).    |
| `--push`         |       | string  |          | Push feature branch after tests pass. Accepts Git URL, slug (`owner/repo`), or remote name. |
| `--pr`           |       | boolean | `false`  | Open a Pull Request after pushing. Requires `--push` and provider token env var.            |
| `--branch`       |       | string  | _(auto)_ | Override the git branch name when applying the patch.                                       |
| `--git-provider` |       | string  | `github` | Git hosting provider: `github`, `gitlab`, `bitbucket`, `azure`, or `gitea`.                 |

### LLM overrides

| Flag         | Alias | Type   | Default | Description                                                       |
| ------------ | ----- | ------ | ------- | ----------------------------------------------------------------- |
| `--model`    |       | string |         | LLM model. Single global or comma-separated `agent=model` pairs.  |
| `--base-url` |       | string |         | LLM base URL. Single global or comma-separated `agent=url` pairs. |

### Other

| Flag            | Alias | Type    | Default                 | Description                                                 |
| --------------- | ----- | ------- | ----------------------- | ----------------------------------------------------------- |
| `--project`     | `-p`  | string  | _(package.json `name`)_ | Project name override for the indexer.                      |
| `--verbose`     | `-v`  | boolean | `false`                 | Show verbose logs.                                          |
| `--project-dir` |       | string  | `(current directory)`   | Project directory.                                          |
| `--saifctl-dir` |       | string  | `saifctl`               | Path to the saifctl directory relative to the project root. |

---

## feat phases

Inspect or validate a phased feature's compiled subtask plan without running anything. See [`feat phases`](feat-phases.md) for the full reference.

```
saifctl feat phases <compile|validate> [options]
```

---

## Usage examples

**Create a new feature interactively:**

```bash
saifctl feat new
```

**Create a feature non-interactively:**

```bash
saifctl feat new --name add-greeting-cmd --yes --desc "Add a /greet command to the CLI"
```

**Run the full design workflow for a feature:**

```bash
saifctl feat design --name add-greeting-cmd
```

**Run design with an MCP server for context gathering:**

```bash
saifctl feat design --name add-greeting-cmd --discovery-mcp docs=https://docs.example.com/mcp
```

**Generate specs only (skip tests):**

```bash
saifctl feat design-specs --name add-greeting-cmd
```

**Run the agent against a feature:**

```bash
saifctl feat run --name add-greeting-cmd
```

**Run in non-interactive mode with a time budget:**

```bash
saifctl feat run --name add-greeting-cmd --run-timeout 2h --max-runs 3
```

**Run and push a branch + open a PR on success:**

```bash
saifctl feat run --name add-greeting-cmd --push origin --pr
```

**Run with the local engine (no Docker):**

```bash
saifctl feat run --name add-greeting-cmd --engine local
```

**Preview the subtask plan for a phased feature:**

```bash
saifctl feat phases compile --name my-phased-feature
```
