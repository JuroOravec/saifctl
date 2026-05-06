# Command: sandbox

Run an agent in a sandbox without the full feature loop — no gate, reviewer, or staging tests.

```
saifctl sandbox [options]
```

Use for isolated, one-shot agent runs. Contrast with `feat run`, which ties execution to a feature's specs, multi-run loop, and test pipeline.

Key sandbox defaults differ from `feat run`:

- Reviewer (Argus) is disabled.
- Max runs is fixed at 1.
- Modifications to `saifctl/` are allowed in the patch.
- The default gate script is a noop (`sandbox-gate.sh`).
- The default Cedar policy is `sandbox.cedar`.

---

## Task input

Exactly one of the following is required (unless `--interactive` is set):

| Flag | Alias | Type | Description |
|------|-------|------|-------------|
| `--task` | `-t` | string | Inline task prompt for the agent. |
| `--task-file` | | string | Path to a file whose contents become the task prompt. |
| `--subtasks` | | string | Path to a subtasks JSON manifest. Cannot be combined with `--task` or `--task-file`. |

---

## Flags

### Identity

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--name` | `-n` | string | `scratch-<8-hex-id>` | Sandbox label (kebab-case). Auto-generated when omitted. |
| `--project` | `-p` | string | _(package.json `name`)_ | Project name override for the indexer. |

### Mode

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--interactive` | `-i` | boolean | `false` | Start an interactive sandbox: run startup + agent-install scripts, then idle. Mutually exclusive with `--task`, `--task-file`, and `--subtasks`. |

### Extract

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--extract` | boolean | `false` | After the run, apply the agent's git changes to the host working tree (`git apply`). |
| `--extract-include` | string | | Repo-relative path prefix: only apply hunks under this path. Requires `--extract`. |
| `--extract-exclude` | string | | Repo-relative path prefix: exclude from the extracted patch. Requires `--extract-include`. |

### Agent

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--agent` | string | `openhands` | Agent profile. |
| `--agent-script` | string | _(profile default)_ | Path to the coding agent script. |
| `--agent-install-script` | string | _(profile default)_ | Path to the one-time agent install script. |
| `--agent-env` | string | | Extra env vars: `KEY=VALUE` or comma-separated `KEY1=VAL1,KEY2=VAL2`. |
| `--agent-env-file` | string | | Path(s) to `.env` file(s). Later overrides earlier for duplicate keys. |
| `--agent-secret` | string | | Env var names to copy from host into the coder secret env (comma-separated). Values are never passed on the CLI. |
| `--agent-secret-file` | string | | Path(s) to `.env` files with secret key-value pairs. Comma-separated; later overrides earlier. |
| `--coder-image` | string | _(profile default)_ | Docker image for the coder container. |
| `--dangerous-no-leash` | boolean | `false` | Skip Leash; run the coder container with plain `docker run`. For no container, use `--engine local`. |
| `--cedar` | string | _(sandbox.cedar)_ | Absolute path to Cedar policy file for Leash. |

### Sandbox and infrastructure

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--profile` | string | | Sandbox profile. Sets defaults for startup and stage scripts. |
| `--engine` | string | | Override infra engine: `docker`, `local`, or per-environment (e.g. `coding=docker,staging=helm`). |
| `--sandbox-base-dir` | string | _(profile default)_ | Sandbox base directory. |
| `--startup-script` | string | | Shell script run once to install workspace deps. |
| `--stage-script` | string | | Shell script mounted into the staging container. |
| `--include-dirty` | boolean | `false` | Include untracked/uncommitted files in the sandbox copy. |
| `--gate-script` | string | _(sandbox noop)_ | Shell script run inside the Leash container after each round. |
| `--gate-retries` | string | `10` | Max gate retries. |

### Timeouts

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--run-timeout` | string | _(none — unbounded)_ | Total wall-clock budget for the run. Accepts a duration (`1h`, `90m`, `30s`), millisecond integer, or `none`. On expiry the run is aborted and saved. |
| `--subtask-timeout` | string | `1h` | Per-subtask wall-clock budget. Resets each time a new subtask becomes active. Same grammar as `--run-timeout`. Set to `none` to disable. |

### Storage

| Flag | Type | Description |
|------|------|-------------|
| `--storage` | string | Storage backend: `local`, `s3`, or `s3://bucket/prefix` (global) or `runs=local,tasks=s3` (per-DB). Comma-separated. Controls where run artifacts are stored. |

### LLM overrides

| Flag | Type | Description |
|------|------|-------------|
| `--model` | string | LLM model. Single global or comma-separated `agent=model` pairs. |
| `--base-url` | string | LLM base URL. Single global or comma-separated `agent=url` pairs. |

### Other

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--verbose` | `-v` | boolean | `false` | Show verbose logs. |
| `--project-dir` | | string | `(current directory)` | Project directory. |
| `--saifctl-dir` | | string | `saifctl` | Path to the saifctl directory relative to the project root. |

---

## Inherited flags with no effect in sandbox

The following flags are inherited from the `feat run` argument surface but have no effect in a sandbox run. They are accepted without error; saifctl silently ignores them.

| Flag | Reason inactive |
|------|-----------------|
| `--no-reviewer` | Reviewer (Argus) is unconditionally disabled; this flag is redundant. |
| `--max-runs` | Fixed at 1 in sandbox; the flag is ignored. |
| `--test-profile` | No staging test pipeline runs in sandbox. |
| `--test-script` | No staging test pipeline runs in sandbox. |
| `--test-image` | No staging test pipeline runs in sandbox. |
| `--test-retries` | No staging test pipeline runs in sandbox. |
| `--resolve-ambiguity` | No staging test pipeline runs in sandbox. |
| `--strict` | Test-dir mutability has no staging context in sandbox. |
| `--push` | No patch promotion step in sandbox. |
| `--pr` | No patch promotion step in sandbox. |
| `--branch` | No patch promotion step in sandbox. |
| `--git-provider` | No patch promotion step in sandbox. |

---

## Usage examples

**Run a one-off task:**

```bash
saifctl sandbox --task "Add a hello-world route to the Express app"
```

**Supply the task from a file:**

```bash
saifctl sandbox --task-file tasks/my-task.md
```

**Run with a named label and apply changes back to the host:**

```bash
saifctl sandbox --name my-experiment --task "Refactor auth middleware" --extract
```

**Apply only changes under `src/auth/`:**

```bash
saifctl sandbox --task "Refactor auth middleware" --extract --extract-include src/auth
```

**Start an interactive sandbox (idle after install, no task):**

```bash
saifctl sandbox --interactive
```

**Use the local engine (no Docker):**

```bash
saifctl sandbox --task "Fix the failing unit test" --engine local
```

**Use S3 storage for run artifacts:**

```bash
saifctl sandbox --task "Refactor auth middleware" --storage s3://my-bucket/runs
```

**Inspect the run after failure:**

```bash
saifctl run info <runId>
```
