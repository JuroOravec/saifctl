# Installation scripts — `startup.sh`, `agent-install.sh`, `gate.sh`, `stage.sh`

Four bash scripts run during a saifctl run:

- **`startup.sh`** — install workspace deps (`pnpm install`, `pip install -r requirements.txt`, …). Runs once per container start, in both coder and staging containers.
- **`agent-install.sh`** — install the agent CLI inside the coder container (e.g. `npm i -g @anthropic-ai/claude-code`). Runs once.
- **`gate.sh`** — lint/typecheck/static check after each agent round in the coder container. Loops with the agent until it passes or `SAIFCTL_GATE_RETRIES` is hit.
- **`stage.sh`** — start the app inside the staging container (web server or `wait` for CLI-only).

They run at runtime — not at image build time — because `/workspace/` is bind-mounted from a per-run copy of the user's repo. `package.json` etc. don't exist in the image.

> **Related:** [`sandbox-isolation.md`](./sandbox-isolation.md) (the three containers these scripts run in) · [`extension-points.md`](./extension-points.md) (sandbox profiles ship the default scripts; agent profiles ship `agent-install.sh`) · [`gate-and-reviewer.md`](./gate-and-reviewer.md) (the gate's role in the convergence loop) · [`../docker.md`](../docker.md) (image inventory and build commands).

## The lifecycle

A saifctl run executes scripts in this order, with the orchestrator setting up env vars between each:

```
container starts (saifctl-coder-<profile>:latest)
        │
        ▼
   /saifctl/coder-start.sh   ← saifctl entrypoint; orchestrates the rest
        │
        ├─► startup.sh                  ← runs ONCE; install workspace deps
        │     (e.g. pnpm install, pip install, cargo fetch)
        │
        ├─► agent-install.sh            ← runs ONCE; install the agent CLI
        │     (e.g. npm install -g @anthropic-ai/claude-code)
        │
        └─► loop (per inner round, up to SAIFCTL_GATE_RETRIES):
              ├── agent.sh              ← agent makes code changes
              ├── gate.sh               ← lint/typecheck/static check
              └── (optional) reviewer.sh
```

The staging container has its own short lifecycle, also driven by `staging-start.sh`:

```
staging container starts
        │
        ├─► startup.sh                  ← same script as coder; install deps
        │
        ├─► sidecar (Go binary)         ← started in background; HTTP /exec server
        │
        └─► stage.sh                    ← starts the app (or `wait`s for CLI-only)
```

Provenance:

- `startup.sh`, `gate.sh`, `stage.sh` — sandbox profile ([`extension-points.md`](./extension-points.md#sandbox-profiles)).
- `agent-install.sh` — agent profile.
- `agent.sh` — agent profile (not an install script; see [`gate-and-reviewer.md`](./gate-and-reviewer.md)).

## Why install at runtime instead of image build

`pnpm install` at image build time would run against an empty `/workspace/` because the workspace is bind-mounted per-run. `package.json` only exists after the mount. Same for `requirements.txt`, `Cargo.toml`, `go.mod`.

## `startup.sh` — workspace setup

**Runs**: once, before the inner agent loop begins. Both in the coder container (before agent rounds) and in the staging container (before `stage.sh` starts the app).

**Purpose**: install language-specific dependencies that depend on `package.json` / `requirements.txt` / `Cargo.toml` etc.

**Default per profile** ([`src/sandbox-profiles/<profile>/startup.sh`](../../../src/sandbox-profiles/)):

| Profile | Default startup |
|---|---|
| `node-pnpm` / `node-pnpm-python` | `cd /workspace && pnpm install --frozen-lockfile \|\| pnpm install` |
| `node-npm` / `node-npm-python` | `cd /workspace && npm ci \|\| npm install` |
| `node-yarn` / `node-yarn-python` | `cd /workspace && yarn install --frozen-lockfile` |
| `node-bun` / `node-bun-python` | `cd /workspace && bun install` |
| `python-pip` / `python-pip-node` | `cd /workspace && pip install -r requirements.txt` (if exists) |
| `python-uv` / `python-uv-node` | `cd /workspace && uv sync` |
| `python-poetry` / `python-poetry-node` | `cd /workspace && poetry install` |
| `python-conda` / `python-conda-node` | `cd /workspace && conda env update -f environment.yml` |
| `go` / `go-node` / `go-python` / `go-node-python` | `cd /workspace && go mod download` |
| `rust` / `rust-node` / `rust-python` / `rust-node-python` | `cd /workspace && cargo fetch` |

The default scripts try the lockfile-locked install first then fall back to "regenerate the lockfile" mode for the case where the lockfile is missing or corrupted.

**Override**: `--startup-script <path>`. The supplied script is bind-mounted at `/saifctl/startup.sh` in the coder/staging container instead of the profile default. Use when:

- The default doesn't fit (multi-package monorepo with custom build steps).
- The repo uses a tool the profile doesn't know about.
- You need to install OS-level deps (`apt install`) before the language tooling runs.

**Failure mode**: exit non-zero → container exits immediately. No agent rounds run. The orchestrator surfaces the startup failure clearly so the user knows it's not an agent problem.

**Contract**:

- Read `/workspace/` (writable per Cedar default; see [`cedar-and-leash.md`](./cedar-and-leash.md)).
- Write to `/workspace/` (e.g. `node_modules/`, `.venv/`, `target/`) and `/tmp/`.
- Network access (for the package manager) is permitted by default per [`security-threats.md` "Why network is unrestricted by default"](./security-threats.md).
- Exit `0` for success.

## `agent-install.sh` — agent CLI setup

**Runs**: once at container start, after `startup.sh`, before the inner loop. Lives in the **agent profile** ([`src/agent-profiles/<id>/agent-install.sh`](../../../src/agent-profiles/)).

**Purpose**: install the agent's CLI binary (Claude Code, Aider, OpenHands, etc.) inside the container if it's not already present in the image.

Examples:

| Agent | Install command |
|---|---|
| Claude Code | `npm install -g @anthropic-ai/claude-code` (idempotent — skips if already installed) |
| Aider | `pipx install aider-chat` |
| OpenHands | (default — pre-installed in the published image) `: # no-op` |
| Gemini CLI | `npm install -g @google/gemini-cli` |
| Codex | `npm install -g @openai/codex` |
| Cursor | `curl https://cursor.com/install -fsS \| bash` |

Some agents (OpenHands, OpenCode) are pre-installed in the saifctl-published `saifctl-coder-<profile>:latest` images, so `agent-install.sh` is essentially a no-op — guards against the user supplying a `--coder-image` that doesn't have the agent.

**Override**: `--agent-install-script <path>` to replace it.

**Contract**: same as `startup.sh` (writable workspace + tmp; exit 0 for success).

## `gate.sh` — per-round validation

Full detail at [`gate-and-reviewer.md`](./gate-and-reviewer.md#layer-1-the-gate). Brief: runs after every agent round, exit 0 = pass, non-zero = inner-loop retry with last 2-4 KB of stderr/stdout appended to next round's task prompt.

Per-profile defaults at [`src/sandbox-profiles/<profile>/gate.sh`](../../../src/sandbox-profiles/):

| Profile | Default gate |
|---|---|
| `node-*` | No-op + warning. Node tests too project-specific to default. |
| `go` / `go-*` | `go vet` + `go test` |
| `rust` / `rust-*` | `cargo check` + `cargo clippy` + `cargo test` |
| `python` / `python-*` | `python -m pytest` + `ruff check` |

Override: `--gate-script <path>`, bind-mounted at `/saifctl/gate.sh:ro`.

## `stage.sh` — staging-container startup

**Runs**: staging container, after `startup.sh` + sidecar. Lives in sandbox profile at [`src/sandbox-profiles/<profile>/stage.sh`](../../../src/sandbox-profiles/).

**Purpose**: start the app the agent built so the test runner can hit it.

| App type | Pattern |
|---|---|
| Web app | `pnpm run start` (or equivalent) → app binds to a port; test runner makes HTTP requests. |
| CLI-only | `wait` → container stays alive; sidecar handles all CLI invocations from the test runner. |

**Override**: `--stage-script <path>`.

**Failure mode**: exit non-zero → staging unreachable → iteration fails with infra-error signal. `hasFeatureSuccessfullyFailed` ([`spec-pipeline.md`](./spec-pipeline.md#stage-4-design-fail2pass)) distinguishes this from "feature tests legitimately fail".

## Sandbox layout

After [`createSandbox`](../../../src/orchestrator/sandbox.ts#L446) ([`git-and-patches.md`](./git-and-patches.md#sandbox-creation)) runs:

```
/tmp/saifctl/sandboxes/<proj>-<feat>-<runId>/
├── policy.cedar          ← Cedar policy
├── gate.sh               ← profile default OR --gate-script content
├── startup.sh            ← profile default OR --startup-script content
├── stage.sh              ← profile default OR --stage-script content (staging-only)
├── agent-install.sh      ← agent profile's install script
├── agent.sh              ← agent profile's runner script
├── reviewer.sh           ← if --reviewer is enabled
├── coder-start.sh        ← saifctl entrypoint
├── saifctl-agent-helpers.sh  ← drop-privileges helpers
├── tests.full.json       ← test catalog (public + hidden)
└── code/                 ← workspace
    ├── .git/
    └── (project tree)
```

The orchestrator bind-mounts the entire saifctl-prefixed dir at `/saifctl/:ro` in the coder container; the agent CLI sees `/saifctl/<script>` paths.

The sandbox dir is **always under `/tmp/saifctl/sandboxes/`** (configurable via `--sandbox-base-dir`, but `/tmp/saifctl/sandboxes/` is the default); see [`docspec/references/commands/cache.md`](../../../docspec/references/commands/cache.md) for the cache-management commands.

## Docker image layering

The coder + staging containers share the same per-profile `Dockerfile.coder`:

- Each profile dir at [`src/sandbox-profiles/<profile>/Dockerfile.coder`](../../../src/sandbox-profiles/) chooses its upstream base (`node:*-bookworm-slim`, `python:*-slim-bookworm`, `golang:*-bookworm`, `rust:*-slim-bookworm`, `continuumio/miniconda3`, etc.) and adds the language runtime + package manager.
- Pre-built images on GHCR (`ghcr.io/safe-ai-factory/saifctl/saifctl-coder-<profile>:latest`); Docker pulls automatically when not present locally.
- **Orchestration scripts (`/saifctl/*`) are NOT baked into the image.** Copied into `<sandbox>/saifctl/` per run, bind-mounted read-only. Two consequences:
  - **No image rebuild for saifctl-developer iterations** — change `coder-start.sh`, re-run, done.
  - **Cedar can `forbid` writes to `/saifctl/`** (it does). The agent can't tamper with orchestration scripts even with full `/workspace/` write privileges. See [`security-threats.md` Reward-hacking](./security-threats.md#additional-hardening-mechanisms).

## Customization patterns

### Different agent CLI

Two paths, ordered by complexity:

1. `--agent <id>` — pick a different built-in profile (15 supported, see [`extension-points.md`](./extension-points.md#agent-profiles)). Orchestrator uses that profile's `agent.sh` + `agent-install.sh`.
2. Custom profile — `mkdir src/agent-profiles/<id>/`, write `profile.ts` + `agent-install.sh` + `agent.sh`, register in `index.ts`. See [`../adding-agents.md`](../adding-agents.md).

### Custom workspace setup, gate, stage, reviewer

Per-run flags: `--startup-script`, `--gate-script`, `--stage-script`. Or set `defaults.startupScript` (etc.) in `saifctl/config.ts` so the team doesn't pass flags every time.

### When to extend the image instead

Three cases warrant Dockerfile extension over scripting:

| Case | Why image, not script |
|---|---|
| Heavy project-agnostic system deps | Compiler toolchains, ImageMagick, Playwright browsers. Don't change between runs; bake them in. |
| Expensive-to-install tooling | C compilation, GPU drivers, etc. Doesn't need the workspace to install. |
| Network-restricted environments | Agent can't reach external registries at runtime. |

Pattern:

```dockerfile
FROM ghcr.io/safe-ai-factory/saifctl/saifctl-coder-node-pnpm-python:latest
RUN apt-get update && apt-get install -y my-system-dep
```

Then `--coder-image <your-image>`. Startup/gate/stage scripts still apply as bind-mounted overrides on top.

## Environment variables the scripts see

`coder-start.sh` ([`src/orchestrator/scripts/coder-start.sh`](../../../src/orchestrator/scripts/coder-start.sh)) sets a contract of env vars the lifecycle scripts can rely on:

| Variable | Set by | Contract |
|---|---|---|
| `SAIFCTL_TASK_PATH` | Orchestrator | Path to the per-round task markdown file |
| `SAIFCTL_GATE_RETRIES` | Orchestrator | Max inner-loop rounds (default 5) |
| `SAIFCTL_GATE_SCRIPT` | Orchestrator | `/saifctl/gate.sh` |
| `SAIFCTL_STARTUP_SCRIPT` | Orchestrator | `/saifctl/startup.sh` (always set; coder-start fails if missing) |
| `SAIFCTL_AGENT_INSTALL_SCRIPT` | Orchestrator | Path to agent install script (or empty to skip) |
| `SAIFCTL_AGENT_SCRIPT` | Orchestrator | `/saifctl/agent.sh` |
| `SAIFCTL_REVIEWER_ENABLED` | Orchestrator | Non-empty → run `/saifctl/reviewer.sh` after gate passes |
| `SAIFCTL_WORKSPACE_BASE` | Orchestrator | `/workspace` (the sandboxed project tree) |
| `SAIFCTL_RUN_ID` | Orchestrator | Run ID for log correlation |
| `SAIFCTL_UNPRIV_USER` | Orchestrator | The unprivileged user the agent CLI should run as (drop-privileges contract) |
| `SAIFCTL_PENDING_RULES_PATH` | Orchestrator | Run-rules feedback channel ([`docspec/references/commands/run-rules.md`](../../../docspec/references/commands/run-rules.md)) |
| `SAIFCTL_ROUNDS_STATS_PATH` | Orchestrator | Where coder-start writes per-round JSONL stats ([`../inner-round-stats.md`](../inner-round-stats.md)) |
| Agent-specific env (e.g. `LLM_API_KEY`) | Orchestrator | Forwarded after stripping reserved `SAIFCTL_*` / `LLM_*` / `REVIEWER_LLM_*` vars to prevent leak — see [`security-threats.md`](./security-threats.md#additional-hardening-mechanisms) |

The full list is documented inline at the head of `coder-start.sh` (lines 21+).

## See also

- [`gate-and-reviewer.md`](./gate-and-reviewer.md) — gate.sh in the inner loop; reviewer.sh integration.
- [`extension-points.md`](./extension-points.md) — sandbox profiles ship startup/stage/gate; agent profiles ship agent-install/agent.
- [`sandbox-isolation.md`](./sandbox-isolation.md) — the three-container architecture these scripts run in.
- [`security-threats.md`](./security-threats.md) — Cedar's `/saifctl/` write-deny; env-var stripping; drop-privileges contract.
- [`../adding-agents.md`](../adding-agents.md) — practical how-to for the agent-install + agent.sh pair.
- [`../docker.md`](../docker.md) — image inventory and build commands.
