# Extension points

Six profile systems make saifctl pluggable. Each is a directory of implementations + an `index.ts` registry; new entries are dropped in.

| System            | Source                                                      | Default                | Count                                                 | Picks via             |
| ----------------- | ----------------------------------------------------------- | ---------------------- | ----------------------------------------------------- | --------------------- |
| Agent profiles    | [`src/agent-profiles/`](../../../src/agent-profiles/)       | `openhands`            | 15                                                    | `--agent <id>`        |
| Designer profiles | [`src/designer-profiles/`](../../../src/designer-profiles/) | `poc`                  | 2 (`poc`, `shotgun`)                                  | `--designer <id>`     |
| Indexer profiles  | [`src/indexer-profiles/`](../../../src/indexer-profiles/)   | `shotgun`              | 1                                                     | `--indexer <id>`      |
| Sandbox profiles  | [`src/sandbox-profiles/`](../../../src/sandbox-profiles/)   | `node-pnpm-python`     | 24                                                    | `--profile <id>`      |
| Test profiles     | [`src/test-profiles/`](../../../src/test-profiles/)         | `node-vitest`          | 8                                                     | `--test-profile <id>` |
| Git providers     | [`src/git/providers/`](../../../src/git/providers/)         | (auto from remote URL) | 5 (`github`, `gitlab`, `bitbucket`, `azure`, `gitea`) | `--git-provider <id>` |

> **Related:** [`orchestrator.md`](./orchestrator.md) · [`sandbox-isolation.md`](./sandbox-isolation.md) · [`test-runner.md`](./test-runner.md) · [`spec-pipeline.md`](./spec-pipeline.md) · [`../adding-agents.md`](../adding-agents.md) (practical how-to for the agent case).

## Why an abstraction at all

The original SWF design ([`comp-c-openhands.md` ancestor](#)) framed OpenHands as **the** execution engine. That framing didn't survive contact with reality: people wanted Aider, Claude Code, Codex, Cursor's CLI, Gemini, Qwen, etc. Building 15 first-class engine integrations was untenable; building one abstraction with 15 implementations was tractable.

Same evolution happened on the spec side: `comp-a-shotgun.md` framed Shotgun as **the** designer; OpenSpec was **the** spec lifecycle (now removed entirely). Reality: Shotgun-vs-POC-Explorer is a workflow choice; OpenSpec was a layer that didn't earn its place. Both got generalized into the profile system.

The general pattern: **anything saifctl orchestrates that varies per-project is a profile**. The orchestrator owns the contract; profiles own the integration. New entries are dropped into a directory; saifctl picks them up via an index module.

## How profile resolution works

Each profile system has a `<dir>/index.ts` that exports a registry. The runtime resolves user input (CLI flag, config field, or default) against the registry; if the entry doesn't exist, error fast at the CLI boundary. Per-system "what varies":

- **Agent profiles** — which coding-agent CLI runs in the coder container.
- **Designer profiles** — which strategy generates `specification.md` from `proposal.md`.
- **Indexer profiles** — which strategy indexes the codebase for the design agents.
- **Sandbox profiles** — which language + package-manager stack the coder/staging containers ship.
- **Test profiles** — which test framework the test-runner container runs.
- **Git providers** — which host saifctl pushes + opens PRs against.

## Agent profiles

15 supported: `aider`, `claude`, `codex`, `copilot`, `cursor`, `debug`, `deepagents`, `forge`, `gemini`, `kilocode`, `mini-swe-agent`, `opencode`, `openhands`, `qwen`, `terminus`. Per-agent user-facing pages at [`docspec/references/agents/`](../../../docspec/references/agents/).

Out of scope: orchestrator-class tools (e.g. [OpenClaw](https://openclaw.ai)) — the agent-profile contract assumes a CLI that edits files in a workspace per round, not a sub-orchestrator that delegates to other coding CLIs. See [`saifctl/features/openclaw-agent-profile/design.md`](../../../saifctl/features/openclaw-agent-profile/design.md) and the "Tools considered but not integrated" section in [`adding-agents.md`](../adding-agents.md#tools-considered-but-not-integrated).

### Profile contract

Each profile dir at `src/agent-profiles/<id>/` ships:

| File               | Role                                                                      | When it runs                                                     |
| ------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `profile.ts`       | Registers id, displayName, stdoutStrategy, drop-privileges classification | At saifctl boot                                                  |
| `agent-install.sh` | Install the agent CLI in the coder container                              | Once at container start                                          |
| `agent.sh`         | Run the agent for one inner round                                         | Per inner round; reads `$SAIFCTL_TASK_PATH`, exits on completion |

The convergence loop ([`orchestrator.md`](./orchestrator.md)) is agent-agnostic — writes the task to `$SAIFCTL_TASK_PATH`, invokes `agent.sh`, runs the gate against whatever ends up in `/workspace/`. Black box from the orchestrator's POV.

### `agent.sh` contract

1. Read task from `$SAIFCTL_TASK_PATH` (markdown file written by orchestrator before each invocation). **Not** from CLI args — escaping + arg-length limits.
2. Invoke the agent CLI.
3. Exit. Exit code is ignored; the gate is the authoritative success signal.

Minimal example (Aider):

```bash
#!/bin/bash
set -euo pipefail
source /saifctl/saifctl-agent-helpers.sh    # drop-privileges helpers
saifctl_drop_privs_init

cd "${SAIFCTL_WORKSPACE_BASE:-/workspace}"
aider --message-file "$SAIFCTL_TASK_PATH" --yes --no-auto-commits
```

### Drop-privileges contract (mandatory)

Every profile **must** declare a drop-privileges classification in `profile.ts` and source `/saifctl/saifctl-agent-helpers.sh` in `agent.sh`. The helper switches to `$SAIFCTL_UNPRIV_USER` (uid 1000) before running the CLI. Even with `--dangerousNoLeash`, the agent isn't root inside its own container.

Enforced by [`drop-privileges-contract.test.ts`](../../../src/agent-profiles/drop-privileges-contract.test.ts) — structural test that every `agent.sh` sources the helper + calls init. New profiles that skip this fail the test, not the runtime.

Rationale: [`security-threats.md` "Drop-privileges contract"](./security-threats.md#additional-hardening-mechanisms).

### Profile reuse for critics

Critic subtasks ([`spec-pipeline.md`](./spec-pipeline.md#critics--per-phase-adversarial-review)) reuse the implementer's profile + `agent.sh`. Implementer vs critic differ only in the rendered prompt template (`critics/<id>.md`). No separate "critic profile". Critics on a different model = per-subtask `LlmOverrides` on the compiled critic subtasks. Documented at [`types.ts:8-17`](../../../src/agent-profiles/types.ts#L8).

### `AgentProfileOption` — per-agent extension knobs

Profiles declare an `options: AgentProfileOption[]` array in `profile.ts` ([`types.ts:72`](../../../src/agent-profiles/types.ts#L72)) for agent-specific flags like `--claude-max` (Claude Code's OAuth token-staging mode) or `--cursor-api-key`. CLI picks them up automatically; `agent.sh` reads them from env. New profiles add agent-specific config without touching the orchestrator's flag parser.

### How to add a new agent

Full walkthrough: [`../adding-agents.md`](../adding-agents.md). Summary:

1. `mkdir src/agent-profiles/<id>/` with the three required files.
2. Register in `src/agent-profiles/index.ts`.
3. Add to `SUPPORTED_AGENT_PROFILE_IDS` ([`types.ts:195`](../../../src/agent-profiles/types.ts#L195)).
4. Author `docspec/references/agents/<id>.md` with `source: src/agent-profiles/<id>/agent.sh`.
5. Pass the drop-privileges contract test.

## Designer profiles

Run at `feat design-specs` ([`spec-pipeline.md`](./spec-pipeline.md#stage-2-design-specs-designer-profile)). Convert `proposal.md` (+ optional `discovery.md`) → `specification.md` + `plan.md`.

| Profile             | Strategy                                                                                      | Strength                                                  | Weakness                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **`poc`** (default) | Sandboxed coding agent builds a throwaway PoC first, derives the spec from what it discovered | Specs grounded in code that compiles; surfaces edge cases | Slower; ~$1/run on Sonnet-tier                                                 |
| **`shotgun`**       | Static-trace: tree-sitter index + multi-agent chain (Researcher / Architect / Spec Writer)    | Faster; no code execution; local-first                    | Specs based on what the designer _thinks_ the code does, not runtime behaviour |

POC is saifctl-internal (reuses the convergence-loop machinery). Shotgun is third-party ([github.com/shotgun-sh/shotgun](https://github.com/shotgun-sh/shotgun)); saifctl shells out to its CLI.

Profile contract: `src/designer-profiles/<id>/profile.ts` exports a `DesignerProfile`. `feat design-specs` resolves `--designer <id>` and dispatches the profile's design function. No `designer.sh`; designers run on the host (POC nests a saifctl sandbox internally).

User-facing docs: [`docspec/references/designers/`](../../../docspec/references/designers/).

## Indexer profiles

Build a queryable representation of the codebase. Design agents call it as a `queryCodebaseIndex` tool ([`spec-pipeline.md`](./spec-pipeline.md#stage-3-design-tests-tests-planner--tests-catalog)).

One profile today: **`shotgun`** ([`src/indexer-profiles/shotgun/`](../../../src/indexer-profiles/shotgun/)) — uses Shotgun's tree-sitter graph database.

Shotgun-as-designer and Shotgun-as-indexer are independent — you can `--designer poc --indexer shotgun`.

## Sandbox profiles

Language + package-manager stack for the coder + staging containers. 24 profiles, named `<lang>[-<lang2>][-<pkg-mgr>]`:

| Family | Profiles                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------ |
| Node   | `node-pnpm` (default), `node-npm`, `node-yarn`, `node-bun` (each with optional `-python` suffix) |
| Python | `python-pip`, `python-uv`, `python-poetry`, `python-conda` (each with optional `-node` suffix)   |
| Go     | `go`, `go-node`, `go-python`, `go-node-python`                                                   |
| Rust   | `rust`, `rust-node`, `rust-python`, `rust-node-python`                                           |

The `<lang>-<lang2>` forms are for mixed-language projects (Node tooling around a Rust core, Python ML utils in a Go CLI). `Dockerfile.coder` installs both runtimes.

Profile contract — each `src/sandbox-profiles/<id>/`:

| File               | Role                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `profile.ts`       | `SandboxProfile` metadata (id, displayName, image tag)                                       |
| `Dockerfile.coder` | Image for both coder + staging                                                               |
| `startup.sh`       | Workspace deps install (`pnpm install`, `cargo fetch`, …)                                    |
| `stage.sh`         | Starts the app (`pnpm run start`) or `wait`s for CLI-only projects                           |
| `gate.sh`          | Per-profile default gate ([`gate-and-reviewer.md`](./gate-and-reviewer.md#layer-1-the-gate)) |

Same `Dockerfile.coder` produces coder + staging images. Difference is what runs inside (agent vs app), not the image — see [`sandbox-isolation.md`](./sandbox-isolation.md#the-three-containers).

User-facing docs: [`docspec/references/sandbox-profiles.md`](../../../docspec/references/sandbox-profiles.md).

## Test profiles

Test-runner container per language + framework ([`test-runner.md`](./test-runner.md#test-profiles)). 8 profiles: per-language test-tool pairs (`node-vitest`, `python-pytest`, `go-gotest`, `rust-rusttest`) + per-language Playwright variants for browser tests.

Addition contract:

1. `mkdir src/test-profiles/<id>/` with `Dockerfile`, `profile.ts`, `test.sh`, `templates/`.
2. Register in `src/test-profiles/index.ts`.
3. `test.sh` must read `SAIFCTL_TARGET_URL`, `SAIFCTL_SIDECAR_URL`, etc. and write JUnit XML to `$SAIFCTL_OUTPUT_FILE`.

User-facing docs: [`docspec/references/test-profiles.md`](../../../docspec/references/test-profiles.md).

## Git providers

`src/git/providers/` ships per-provider implementations of the git-hosting abstraction ([`git-and-patches.md`](./git-and-patches.md)). 5 providers:

- `github` (default detection from `github.com` remote URLs)
- `gitlab`
- `bitbucket`
- `azure` (Azure Repos)
- `gitea`

### Provider contract

[`src/git/types.ts`](../../../src/git/types.ts) defines the `GitProvider` interface. Each provider implements three operations:

- `resolvePushUrl(remote)` — construct the URL `git push` should target. Auth-token-in-URL handling per provider.
- `extractRepoSlug(url)` — derive the provider-specific repo identifier (e.g. `owner/repo` for GitHub/Bitbucket; full path for GitLab; `org/project/_git/repo` for Azure).
- `createPullRequest(opts)` — call the provider's REST API to open the PR/MR.

Auth tokens are always read from environment variables inside each provider implementation — they are **never passed as function arguments** so they don't leak into logs or stack traces.

### Adding a new provider

1. `mkdir src/git/providers/<host>/` with a `<host>.ts` implementing `GitProvider`.
2. Add a unit test that covers URL parsing, slug extraction, and PR creation (mocked HTTP).
3. Register in `src/git/providers/index.ts` so the auto-detection logic can match remote URLs to the new provider.

See [`git-and-patches.md`](./git-and-patches.md) for the host-side git workflow these providers plug into.

## Why this design

Three properties fall out:

- **Drop-in extensibility** — new agent / designer / indexer / sandbox / test framework = directory-level op. No orchestrator changes, no flag-parser surgery.
- **Independent vendoring** — each profile dir bundles its Dockerfiles, install scripts, runtime scripts, types. Profiles can ship frozen while upstream tools churn.
- **No first-class status** — every entry is one of N. Defaults (`openhands`, `poc`, `node-pnpm-python`, `node-vitest`) are config, not architecture. No codepath bakes in "OpenHands the engine".

Historical: saifctl v0 had OpenHands hard-coded in the orchestrator. Migration to profiles happened when Aider became the third agent — "one more if-statement in modes.ts" cost exceeded the abstraction cost.

## See also

- [`../adding-agents.md`](../adding-agents.md) — concrete how-to for the agent-profile case (the most common extension request).
- [`orchestrator.md`](./orchestrator.md) — where the convergence loop dispatches to whichever profile is selected.
- [`spec-pipeline.md`](./spec-pipeline.md) — where designer + indexer profiles slot into `feat design`.
- [`sandbox-isolation.md`](./sandbox-isolation.md) — where coder/staging images come from sandbox profiles.
- [`test-runner.md`](./test-runner.md) — where the test-runner image comes from a test profile.
- [`git-and-patches.md`](./git-and-patches.md) — where git providers plug into the host-side push + PR workflow.
- [`security-threats.md`](./security-threats.md#additional-hardening-mechanisms) — drop-privileges contract reasoning.
- [`docspec/references/agents/`](../../../docspec/references/agents/), [`docspec/references/designers/`](../../../docspec/references/designers/), [`docspec/references/indexers/`](../../../docspec/references/indexers/) — user-facing per-profile reference pages.
