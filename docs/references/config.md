# Config file reference

`saifctl/config.{json,yaml,yml,ts}` sets project-wide defaults so you don't have to repeat options on every CLI invocation.

**Precedence:** CLI flag > config file > profile default.

## Top-level structure

```yaml
defaults: # CLI-flag defaults, profiles, model/storage overrides
  ...
environments: # Docker / Helm / local engine topology
  coding: ...
  staging: ...
```

---

## `defaults`

All fields are optional.

### Run parameters

| Field              | Type                                     | CLI flag                   | Default   | Description                                                                                                                                          |
| ------------------ | ---------------------------------------- | -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxRuns`          | positive integer (≥ 1)                   | `--max-runs`               | —         | Maximum number of run attempts.                                                                                                                      |
| `testRetries`      | positive integer (≥ 1)                   | `--test-retries`           | —         | Number of times to retry a failing test phase.                                                                                                       |
| `resolveAmbiguity` | `off` \| `prompt` \| `ai`                | `--resolve-ambiguity`      | —         | How to handle ambiguous feature specs.                                                                                                               |
| `timeouts.run`     | integer (ms), duration string, or `null` | `--run-timeout`            | unbounded | Wall-clock budget for the entire run. `null` or `'none'` disables it.                                                                                |
| `timeouts.subtask` | integer (ms), duration string, or `null` | `--subtask-timeout`        | `'1h'`    | Per-subtask wall-clock budget; resets when each subtask becomes active.                                                                              |
| `dangerousNoLeash` | boolean                                  | `--dangerous-no-leash`     | —         | Skip Leash; run the coder image with `docker run` (same mounts/env as Leash, no Cedar/eBPF).                                                         |
| `cedarPolicyPath`  | string                                   | `--cedar-policy-path`      | —         | Path to a Cedar policy file.                                                                                                                         |
| `coderImage`       | string                                   | `--coder-image`            | —         | Docker image for the coder container.                                                                                                                |
| `gateRetries`      | positive integer (≥ 1)                   | `--gate-retries`           | —         | Number of times to retry a failing gate.                                                                                                             |
| `agent.reviewer`   | boolean                                  | `--no-reviewer` (off only) | `true`    | Run-level baseline for the post-gate semantic reviewer (Argus). Mirrors the per-phase `agent.reviewer` field; per-phase overrides layer on top.      |
| `includeDirty`     | boolean                                  | `--include-dirty`          | `false`   | Copy untracked/uncommitted files into the sandbox (`rsync`); default uses `git archive` (HEAD only).                                                 |
| `strict`           | boolean                                  | `--strict` / `--no-strict` | `true`    | When `true`, feature- and phase-level test directories are immutable unless `tests.mutable: true` is declared. `saifctl/tests/` is always immutable. |

Duration strings accept: `'1h'`, `'90m'`, `'30s'`, `'1h30m'`, or a numeric millisecond string like `'3600000'`.

### Git / push

| Field         | Type                                                      | CLI flag         | Default | Description                                 |
| ------------- | --------------------------------------------------------- | ---------------- | ------- | ------------------------------------------- |
| `push`        | string                                                    | `--push`         | —       | Remote ref to push results to.              |
| `pr`          | boolean                                                   | `--pr`           | —       | Open a pull request after a successful run. |
| `gitProvider` | `github` \| `gitlab` \| `bitbucket` \| `azure` \| `gitea` | `--git-provider` | —       | Git hosting provider for PR creation.       |

### Agent environment

| Field             | Type                     | CLI flag              | Description                                                                                          |
| ----------------- | ------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------- |
| `agentEnv`        | `Record<string, string>` | `--agent-env`         | Environment variables injected into the coder container (non-secret).                                |
| `agentSecretKeys` | `string[]`               | `--agent-secret-keys` | Env var names whose values are read from the host at run start and kept out of logs and run storage. |

### Agent / designer / indexer profile options

These mirror the `--<id>-<name>` CLI flags declared by each profile. Keys are the agent/designer/indexer id; values are maps of option name to scalar value.

```yaml
defaults:
  agentOptions:
    claude:
      max: true
      credentials: ~/work/team-claude-creds.json
  designerOptions:
    shotgun:
      someOption: value
  indexerOptions:
    myIndexer:
      someOption: 42
```

String-typed options from this map are **not** automatically redacted — add the key to `agentSecretKeys` if you want the value hidden in logs.

See `docs/contributing/agent-profile-options.md` for how to declare new profile options.

| Field             | Type                                                            | CLI equivalent           |
| ----------------- | --------------------------------------------------------------- | ------------------------ |
| `agentOptions`    | `Record<agentId, Record<name, string \| number \| boolean>>`    | `--<agent-id>-<name>`    |
| `designerOptions` | `Record<designerId, Record<name, string \| number \| boolean>>` | `--<designer-id>-<name>` |
| `indexerOptions`  | `Record<indexerId, Record<name, string \| number \| boolean>>`  | `--<indexer-id>-<name>`  |

### Model overrides

| Field           | Type                        | CLI flag            | Description                                                       |
| --------------- | --------------------------- | ------------------- | ----------------------------------------------------------------- |
| `globalModel`   | string                      | `--global-model`    | Model used by all agents unless overridden.                       |
| `globalBaseUrl` | string                      | `--global-base-url` | Base URL for all model API calls unless overridden.               |
| `agentModels`   | `Record<agentName, string>` | `--agent-models`    | Per-agent model overrides. Keys must be supported agent names.    |
| `agentBaseUrls` | `Record<agentName, string>` | `--agent-base-urls` | Per-agent base URL overrides. Keys must be supported agent names. |

### Storage

| Field           | Type                         | CLI flag           | Description                                                         |
| --------------- | ---------------------------- | ------------------ | ------------------------------------------------------------------- |
| `globalStorage` | string                       | `--global-storage` | Default storage backend.                                            |
| `storages`      | `Record<storageKey, string>` | `--storages`       | Per-purpose storage overrides. Keys must be supported storage keys. |

### Profile IDs

| Field             | Type   | CLI flag             | Description               |
| ----------------- | ------ | -------------------- | ------------------------- |
| `testProfile`     | string | `--test-profile`     | Test profile id.          |
| `agentProfile`    | string | `--agent-profile`    | Agent (coder) profile id. |
| `designerProfile` | string | `--designer-profile` | Designer profile id.      |
| `indexerProfile`  | string | `--indexer-profile`  | Indexer profile id.       |
| `sandboxProfile`  | string | `--sandbox-profile`  | Sandbox profile id.       |

### Paths and project

| Field            | Type   | CLI flag             | Description                            |
| ---------------- | ------ | -------------------- | -------------------------------------- |
| `project`        | string | `--project`          | Project name or identifier.            |
| `sandboxBaseDir` | string | `--sandbox-base-dir` | Base directory for sandbox workspaces. |

Note: `projectDir` and `saifctlDir` are **not** configurable here — they are required to locate the config file.

### Discovery

| Field                 | Type                     | CLI flag                  | Description                                     |
| --------------------- | ------------------------ | ------------------------- | ----------------------------------------------- |
| `discoveryMcps`       | `Record<string, string>` | `--discovery-mcps`        | MCP endpoints used during the discovery phase.  |
| `discoveryTools`      | string                   | `--discovery-tools`       | Tool set available to the discovery agent.      |
| `discoveryPrompt`     | string                   | `--discovery-prompt`      | Inline prompt for the discovery agent.          |
| `discoveryPromptFile` | string                   | `--discovery-prompt-file` | Path to a file containing the discovery prompt. |

### Script overrides

Override profile-default scripts with project-specific paths.

| Field                | Type   | CLI flag                 | Description                               |
| -------------------- | ------ | ------------------------ | ----------------------------------------- |
| `testScript`         | string | `--test-script`          | Script that runs the test suite.          |
| `testImage`          | string | `--test-image`           | Docker image for the test runner.         |
| `startupScript`      | string | `--startup-script`       | Script executed at environment startup.   |
| `stageScript`        | string | `--stage-script`         | Script that stages the application.       |
| `gateScript`         | string | `--gate-script`          | Script that evaluates the gate condition. |
| `agentScript`        | string | `--agent-script`         | Script that launches the agent.           |
| `agentInstallScript` | string | `--agent-install-script` | Script that installs agent dependencies.  |

---

## `environments`

Defines the Docker/Helm/local topology for the coding and staging phases. Both `coding` and `staging` are optional; omitting either defaults to `{ engine: 'docker' }`.

### `environments.coding`

Discriminated by `engine`.

#### `engine: 'docker'` (default)

```yaml
environments:
  coding:
    engine: docker
    file: docker-compose.yml # optional — Compose file for ephemeral services
    agentEnvironment: # optional — env vars for the agent container
      MY_VAR: value
```

| Field              | Type                     | Required | Description                                                                          |
| ------------------ | ------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `engine`           | `'docker'`               | yes      | Selects the Docker runtime.                                                          |
| `file`             | string                   | no       | Path to a Docker Compose file (relative to project root). Omit for no Compose stack. |
| `agentEnvironment` | `Record<string, string>` | no       | Env vars injected into the coder container.                                          |

#### `engine: 'helm'`

```yaml
environments:
  coding:
    engine: helm
    chart: ./charts/my-app
    namespacePrefix: saifctl-
    agentEnvironment:
      MY_VAR: value
```

| Field              | Type                     | Required | Description                                 |
| ------------------ | ------------------------ | -------- | ------------------------------------------- |
| `engine`           | `'helm'`                 | yes      | Selects the Helm runtime.                   |
| `chart`            | string                   | no       | Helm chart path or reference.               |
| `namespacePrefix`  | string                   | no       | Prefix applied to Kubernetes namespaces.    |
| `agentEnvironment` | `Record<string, string>` | no       | Env vars injected into the coder container. |

#### `engine: 'local'`

```yaml
environments:
  coding:
    engine: local
    agentEnvironment:
      MY_VAR: value
```

| Field              | Type                     | Required | Description                                               |
| ------------------ | ------------------------ | -------- | --------------------------------------------------------- |
| `engine`           | `'local'`                | yes      | Agent runs directly on the host. Not valid for `staging`. |
| `agentEnvironment` | `Record<string, string>` | no       | Env vars set in the host environment.                     |

### `environments.staging`

Same as `coding` but supports `engine: 'docker'` or `engine: 'helm'` only (no `local`). Adds the following extra fields:

| Field                  | Type                     | Required | Description                                                                         |
| ---------------------- | ------------------------ | -------- | ----------------------------------------------------------------------------------- |
| `app.sidecarPort`      | integer                  | no       | Port the staging sidecar listens on. Default: `8080`.                               |
| `app.sidecarPath`      | string                   | no       | HTTP path the sidecar serves. Default: `'/exec'`.                                   |
| `app.baseUrl`          | string                   | no       | Base URL of the web app. Omit for pure CLI projects. Use `staging` as the hostname. |
| `app.build.dockerfile` | string                   | no       | Custom Dockerfile for the staging app image.                                        |
| `appEnvironment`       | `Record<string, string>` | no       | Env vars injected into the staging app container (not the agent).                   |

---

## Example

```yaml
# saifctl/config.yaml
defaults:
  maxRuns: 3
  testRetries: 2
  resolveAmbiguity: ai
  timeouts:
    run: '2h'
    subtask: '30m'
  strict: true
  includeDirty: false
  agentProfile: claude
  agentOptions:
    claude:
      max: true
  agentEnv:
    LOG_LEVEL: debug
  agentSecretKeys:
    - OPENAI_API_KEY
  globalModel: claude-opus-4-6
  gitProvider: github
  pr: true

environments:
  coding:
    engine: docker
    file: docker-compose.dev.yml
    agentEnvironment:
      DATABASE_URL: postgresql://localhost/dev
  staging:
    engine: docker
    agentEnvironment:
      DATABASE_URL: postgresql://staging/app
    appEnvironment:
      NODE_ENV: staging
    app:
      sidecarPort: 8080
      baseUrl: http://staging:3000
```
