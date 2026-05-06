# `run`

Manage persisted **Runs** — saved executions of `feat run` or `sandbox`. Run state is written to storage (local `.saifctl/runs/` by default) so you can resume, fork, inspect, or apply changes after the fact.

## Synopsis

```
saifctl run <subcommand> [flags]
```

## Subcommands

| Subcommand | Alias | Description |
|---|---|---|
| `ls` | `list` | List runs with optional filters |
| `rm` | `remove` | Delete a saved run |
| `info` | — | Print run metadata as JSON (omits diffs) |
| `get` | — | Print full run artifact as JSON |
| `clear` | — | Bulk-remove runs by filter |
| `fork` | — | Branch off a saved run as a starting point for a new run |
| `pause` | — | Pause a running run; preserves sandbox and Docker network |
| `stop` | — | Stop a running or paused run with full teardown |
| `resume` | — | Continue a paused run from where it stopped |
| `start` | — | Start fresh from a failed or interrupted run |
| `inspect` | — | Open an idle container reproducing the run's workspace state |
| `test` | — | Re-run a saved run's holdout tests against its final state |
| `apply` | — | Apply a run's git changes to the host working tree |
| `export` | — | Export run artifacts as a diff/patch file |
| `rules` | — | Manage user-feedback rules on a live run (see [`run rules`](run-rules.md)) |

---

## Common flags

Most subcommands accept these flags:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--project-dir` | string | current directory | Project directory |
| `--saifctl-dir` | string | `saifctl` | Path to the saifctl directory |
| `--storage` | string | — | Storage backend: `local` \| `s3` \| `s3://bucket/prefix` (global), or per-DB `runs=local,tasks=s3` style. Comma-separated; duplicate keys and combining a global value with per-DB keys are invalid. |

---

## `ls` / `list`

List stored runs, sorted by last update time (newest first).

```
saifctl run ls [--status <status>] [--format table|json] [--no-pretty]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--status` | string | — | Filter by run status (e.g. `failed`, `completed`, `running`, `paused`) |
| `--format` | string | `table` | Output format: `table` or `json` |
| `--pretty` | boolean | `true` | When `--format json`: pretty-print. Use `--no-pretty` for one line. |

### Example

```sh
saifctl run ls
saifctl run ls --status failed
saifctl run ls --format json --no-pretty
```

---

## `rm` / `remove`

Delete a saved run. Only runs with status `failed` or `completed` can be deleted; stop or wait for other states first.

```
saifctl run rm <runId>
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to delete |

### Example

```sh
saifctl run rm run_abc123
```

---

## `info`

Print a run's metadata as JSON, omitting large fields like diffs (script paths only).

```
saifctl run info <runId> [--no-pretty]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to show |

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--pretty` | boolean | `true` | Pretty-print the JSON output. Use `--no-pretty` for one line. |

### Example

```sh
saifctl run info run_abc123
```

---

## `get`

Print the full run artifact as JSON, including all stored fields.

```
saifctl run get <runId> [--no-pretty]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to fetch |

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--pretty` | boolean | `true` | Pretty-print the JSON output. Use `--no-pretty` for one line. |

### Example

```sh
saifctl run get run_abc123 --no-pretty | jq '.status'
```

---

## `clear`

Bulk-remove runs. Without flags, removes all runs regardless of status.

```
saifctl run clear [--failed]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--failed` | boolean | — | Remove only failed runs |

### Example

```sh
saifctl run clear --failed
```

---

## `fork`

Clone a saved run to a new run ID, preserving the source run unchanged. Use `run start` on the forked ID to re-run the agent from that state.

```
saifctl run fork <runId> [flags]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Source run ID to fork |

Accepts the same flags as [`start`](#start) (agent, model, sandbox, and run-control flags), plus the following additional flag:

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--name` | `-n` | string | — | Feature name; must match the source run's feature name (the command exits with an error if it does not) |

### Example

```sh
saifctl run fork run_abc123
# Outputs: Forked run run_abc123 → run_def456
saifctl run start run_def456
```

---

## `pause`

Pause a running run. The sandbox containers are stopped but not deleted, so the run can be resumed with `run resume`. Waits up to `--timeout` seconds for the run to finish pausing.

```
saifctl run pause <runId> [--timeout <sec>]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to pause |

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--timeout` | string (sec) | `60` | Max seconds to wait for the run to finish pausing |

### Example

```sh
saifctl run pause run_abc123
saifctl run pause run_abc123 --timeout 120
```

---

## `stop`

Stop a running or paused run with full teardown. The run's final status becomes `failed`. Unlike `pause`, this tears the sandbox down completely. Waits up to `--timeout` seconds.

```
saifctl run stop <runId> [--timeout <sec>] [--force]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to stop |

### Flags

| Flag | Alias | Type | Default | Description |
|---|---|---|---|---|
| `--timeout` | — | string (sec) | `60` | Max seconds to wait for the run to finish stopping |
| `--force` | `-f` | boolean | `false` | Stop without waiting: shut down Docker and remove saved workspace when possible |

### Example

```sh
saifctl run stop run_abc123
saifctl run stop run_abc123 --force
```

---

## `resume`

Continue a paused run from where it stopped. Reuses cached container state if still present; otherwise restarts like `run start`.

```
saifctl run resume <runId> [flags]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to resume |

Accepts the same flags as [`start`](#start) (agent, model, sandbox, and run-control flags).

### Example

```sh
saifctl run resume run_abc123
```

---

## `start`

Start the agent fresh from a saved run (failed or interrupted). Creates a new run branched from the artifact; the source run is preserved.

```
saifctl run start <runId> [flags]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to start from |

### Agent and run-control flags

| Flag | Alias | Type | Default | Description |
|---|---|---|---|---|
| `--max-runs` | — | string | `5` | Max full pipeline runs before giving up |
| `--gate-retries` | — | string | `10` | Max gate retries per run |
| `--run-timeout` | — | string | none | Total wall-clock budget for the entire run (e.g. `1h`, `90m`, `none`). On expiry, run is saved; resume with `run start`. |
| `--subtask-timeout` | — | string | `1h` | Per-subtask budget; resets each time a subtask becomes active. Same format as `--run-timeout`. |
| `--test-retries` | — | string | `1` | How many times to retry when tests fail |
| `--resolve-ambiguity` | — | string | `ai` | How to handle ambiguous test failures: `ai` \| `prompt` \| `off` |
| `--strict` / `--no-strict` | — | boolean | `true` | Default mutability for test dirs. `--strict` keeps tests immutable unless `tests.mutable: true`; `--no-strict` flips the default. |
| `--no-reviewer` | — | boolean | — | Skip the AI semantic reviewer (Argus) after static checks |

### Sandbox flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--profile` | string | — | Sandbox profile (sets defaults for startup/stage scripts) |
| `--engine` | string | — | Override infra engine: `docker`, `local`, or `coding=docker,staging=helm` |
| `--sandbox-base-dir` | string | — | Sandbox base directory |
| `--startup-script` | string | — | Shell script run once to install workspace deps |
| `--stage-script` | string | — | Shell script mounted into the staging container for app startup |
| `--test-script` | string | — | Shell script that overrides `test.sh` inside the test runner container |
| `--test-image` | string | — | Test runner Docker image tag |
| `--test-profile` | string | `node-vitest` | Test profile ID |
| `--include-dirty` | boolean | — | Include untracked/uncommitted files in the sandbox copy |
| `--dangerous-no-leash` | boolean | — | Skip Leash; run the coder container with plain `docker run` |
| `--cedar` | string | — | Absolute path to Cedar policy file for Leash |
| `--coder-image` | string | — | Docker image for the coder container |

### Agent flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--agent` | string | `openhands` | Agent profile |
| `--agent-script` | string | — | Path to the coding agent script |
| `--agent-install-script` | string | — | Path to the one-time agent install script |
| `--gate-script` | string | — | Shell script run inside the Leash container after each round |
| `--agent-env` | string | — | Extra env vars: `KEY=VALUE` or comma-separated `KEY1=VAL1,KEY2=VAL2` |
| `--agent-env-file` | string | — | Path(s) to `.env` file(s); comma-separated, later overrides earlier |
| `--agent-secret` | string | — | Env var names to copy from host into coder secret env (comma-separated names only) |
| `--agent-secret-file` | string | — | Path(s) to `.env` file(s) with secret key/value pairs |

### Model flags

| Flag | Type | Description |
|---|---|---|
| `--model` | string | LLM model. Single global (`anthropic/claude-opus-4-5`) or comma-separated `agent=model` pairs |
| `--base-url` | string | LLM base URL. Single global or comma-separated `agent=url` pairs |

### Push/PR flags

| Flag | Alias | Type | Description |
|---|---|---|---|
| `--push` | — | string | Push feature branch after tests pass. Accepts Git URL, slug (`owner/repo`), or remote name. |
| `--pr` | — | boolean | Open a Pull Request after pushing. Requires `--push` and provider token env var. |
| `--branch` | — | string | Override the git branch name (default: `saifctl/<feature>-<runId>-<diffHash>`) |
| `--git-provider` | — | string | Git hosting provider: `github` \| `gitlab` \| `bitbucket` \| `azure` \| `gitea` (default: `github`) |

### Other flags

| Flag | Alias | Type | Default | Description |
|---|---|---|---|---|
| `--project` | `-p` | string | — | Project name override for the indexer (default: `package.json` `name`) |
| `--verbose` | `-v` | boolean | — | Show verbose logs |

### Example

```sh
saifctl run start run_abc123
saifctl run start run_abc123 --max-runs 3 --model anthropic/claude-opus-4-5
```

---

## `inspect`

Open an idle coding container that reproduces the run's workspace state. Changes made inside the container are saved.

```
saifctl run inspect <runId> [--leash] [flags]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to inspect |

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--leash` | boolean | — | Use Leash/Cedar constraints in the inspect session. Default is plain Docker (allows `git commit` inside the container). |

Accepts the same sandbox and agent flags as [`start`](#start), except `--dangerous-no-leash`.

### Example

```sh
saifctl run inspect run_abc123
saifctl run inspect run_abc123 --leash
```

---

## `test`

Re-run a saved run's holdout tests against its final patch state — no coding agent is invoked. Useful for verifying that a patch still passes after environment changes.

```
saifctl run test <runId> [flags]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to test |

Accepts the same flags as [`start`](#start) except agent/coder-only flags (`--max-runs`, `--agent`, `--agent-script`, `--agent-install-script`, `--gate-script`, `--gate-retries`, `--dangerous-no-leash`, `--cedar`, `--coder-image`, `--agent-env`, `--agent-env-file`, `--agent-secret`, `--agent-secret-file`, `--strict`).

### Example

```sh
saifctl run test run_abc123
saifctl run test run_abc123 --push origin --pr
```

---

## `apply`

Apply a run's git changes to the host working tree by creating a local git branch, with optional push and PR creation.

```
saifctl run apply <runId> [flags]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to apply |

Accepts the same flags as [`test`](#test) (sandbox, model, push/PR, and run-control flags).

### Example

```sh
saifctl run apply run_abc123
saifctl run apply run_abc123 --push origin --pr --branch my-feature-branch
```

---

## `export`

Export a run's workspace changes as a single unified diff/patch file.

```
saifctl run export <runId> [--output <path>]
```

### Arguments

| Name | Type | Required | Description |
|---|---|---|---|
| `runId` | positional | yes | Run ID to export |

### Flags

| Flag | Alias | Type | Default | Description |
|---|---|---|---|---|
| `--output` | `-o` | string | `./saifctl-<feature>-<runId>-<diffHash>.patch` | Output file path |

### Example

```sh
saifctl run export run_abc123
saifctl run export run_abc123 --output ./my-changes.patch
```

---

## `rules`

Manage user-feedback rules attached to a live (executing) run. Documented separately: [`run rules`](run-rules.md).

```
saifctl run rules <subcommand> …
```
