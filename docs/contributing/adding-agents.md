# Agent profiles

Practical how-to for adding a new coding-agent CLI integration. For the broader profile-system context (extension points, contract rationale), see [`architecture/extension-points.md`](./architecture/extension-points.md). For the script lifecycles, see [`architecture/installation-scripts.md`](./architecture/installation-scripts.md).

## What an integration ships

Every agent profile dir at `src/agent-profiles/<id>/` contains:

| File               | Role                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| `profile.ts`       | Registers id, displayName, `stdoutStrategy`, drop-privileges classification.     |
| `agent-install.sh` | Installs the agent CLI in the coder container. Runs once at container start.     |
| `agent.sh`         | Runs the agent for one inner round. Reads `$SAIFCTL_TASK_PATH`, exits when done. |

`--agent <id>` picks a built-in profile. `--agent-script <path>` overrides just `agent.sh` for one-off runs.

## `agent.sh` contract

Every `agent.sh` must:

| Requirement                    | Detail                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Read task from file            | Task is at `$SAIFCTL_TASK_PATH` before each invocation. **Don't** read from CLI args (escaping + arg-length limits).          |
| Work in the workspace          | Leash mode: `/workspace`. `--engine local`: current directory (sandbox `code/`). Use `${SAIFCTL_WORKSPACE_BASE:-/workspace}`. |
| Exit on completion             | Any exit code. The gate is the authoritative success signal, not the agent's exit code.                                       |
| Headless / non-interactive     | Agent must run without prompts (`--yes`, `--headless`, `--always-approve`, `--yolo`, etc.).                                   |
| No auto-commits                | Most CLIs commit by default; the factory extracts diffs itself. Pass `--no-auto-commits` etc. to disable.                     |
| Source drop-privileges helpers | Run as `$SAIFCTL_UNPRIV_USER`, not root. **Mandatory** — see below.                                                           |

### Drop-privileges contract (mandatory)

Every `agent.sh` **must** source `/saifctl/saifctl-agent-helpers.sh` and call `saifctl_drop_privs_init` before invoking the agent CLI. Even with `--dangerousNoLeash`, the agent runs as a non-root user inside its container.

Enforced by [`src/agent-profiles/drop-privileges-contract.test.ts`](../../src/agent-profiles/drop-privileges-contract.test.ts) — a structural test that fails if any profile's `agent.sh` skips it. Rationale: [`architecture/security-threats.md` Drop-privileges contract](./architecture/security-threats.md#additional-hardening-mechanisms).

### Minimal `agent.sh` example (Aider)

```bash
#!/bin/bash
set -euo pipefail
source /saifctl/saifctl-agent-helpers.sh
saifctl_drop_privs_init

cd "${SAIFCTL_WORKSPACE_BASE:-/workspace}"
aider --message-file "$SAIFCTL_TASK_PATH" --yes --no-auto-commits
```

## `agent-install.sh` contract

- Runs once at container start, after `startup.sh`, before the agent loop.
- Installs the agent CLI (pipx, uv, npm, curl, etc.).
- **Idempotent** — skip if already installed (the saifctl-published image may bake the CLI in).

Examples in [`architecture/installation-scripts.md` agent-install.sh](./architecture/installation-scripts.md#agent-installsh--agent-cli-setup).

## `profile.ts`: `stdoutStrategy` field

Some agents emit structured JSON (OpenHands), others print plain lines (Aider). Profiles declare a `stdoutStrategy`:

- **Object strategy** — detect agent-specific event boundaries and reformat. OpenHands turns JSON events into `[think]`, `[agent]`, `[inspect]` segments.
- **`null`** — passthrough; line-wise output prefixed with `[agent]` inside the `[SAIFCTL:AGENT_*]` window.

Required in `profile.ts`. Not configurable via CLI or `saifctl.config`.

## Concrete examples

The 15 shipping profiles at [`src/agent-profiles/`](../../src/agent-profiles/) are the canonical examples. Notable variants:

| Profile     | Pattern                                                                        |
| ----------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `claude`    | npm-installed CLI; OAuth token-staging via `--claude-max` (per-agent option)   |
| `aider`     | pipx-installed; reads task from `--message-file`; explicit `--no-auto-commits` |
| `openhands` | Pre-installed in the published image; structured-JSON `stdoutStrategy`         |
| `cursor`    | `curl                                                                          | bash`install; OAuth via`--cursor-api-key` per-agent option |
| `debug`     | No-op; no LLM call. Used in integration tests                                  |

## Adding a new agent — workflow

### Step 1 — scaffold + integrate (Sonnet 4.6 or better)

```txt
Let's add new agent profile: mini-swe-agent - https://github.com/SWE-agent/mini-swe-agent

Do the integration in 5 steps:
1. write profile.ts, register in index.ts and types.ts (SUPPORTED_AGENT_PROFILE_IDS).
2. check upstream docs for install requirements; write agent-install.sh (idempotent).
3. check upstream docs for how to pass text to the CLI; pass $SAIFCTL_TASK_PATH content
   to it in yolo/autonomous mode in agent.sh. Source /saifctl/saifctl-agent-helpers.sh
   and call saifctl_drop_privs_init before invoking the CLI.
4. check upstream docs for all the flags/options the CLI accepts; configure them.
5. check upstream docs for API key / model / provider / base-url config; wire LLM_* env.
```

Things to verify after the model produces a draft:

- Task prompt reaches the CLI (`$SAIFCTL_TASK_PATH` content).
- `LLM_MODEL`, `LLM_PROVIDER`, `LLM_BASE_URL` forwarded if supported.
- API keys forwarded (provider-specific like `OPENAI_API_KEY` or generic `LLM_API_KEY`).
- CLI runs in yolo / autonomous / headless mode (no prompts).
- Profile registered in `src/agent-profiles/index.ts` + `SUPPORTED_AGENT_PROFILE_IDS` in `types.ts`.
- `drop-privileges-contract.test.ts` passes.

### Step 2 — author the user-facing reference

Create `docspec/references/agents/<id>.md`:

```yaml
---
source: src/agent-profiles/<id>/agent.sh
type: cli-command
---

[Brief description of the upstream tool]. Notable env vars / flags / install caveats. Saifctl invokes it as `saifctl feat run --agent <id>`.
```

### Step 3 — sweep references

Find all places mentioning agent CLIs (CLI help text, READMEs, sample configs) and add the new id. Prompt for a fast model:

```txt
Check for places where we mention all agentic CLI integrations and add our new <id> there.
```

## Agent benchmarks

- https://www.tbench.ai/leaderboard/terminal-bench/2.0

## Tools considered but not integrated

Some agentic CLIs look like a fit at first glance but turn out to overlap with what saifctl already does. Records below exist so the next person asking "should we add X?" can read the analysis instead of repeating it.

| Tool                            | Why not                                                                                                                                                                                                                                            | Decision record                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [OpenClaw](https://openclaw.ai) | Is itself an orchestrator; its coding-agent skill delegates to `claude` / `codex` / `opencode` — all already first-class saifctl profiles. Stacking another orchestrator on top adds a daemon and an indirection without unlocking new capability. | [`saifctl/features/openclaw-agent-profile/design.md`](../../saifctl/features/openclaw-agent-profile/design.md) |

## See also

- [`architecture/extension-points.md`](./architecture/extension-points.md#agent-profiles) — profile-system rationale, how `--agent <id>` resolves.
- [`architecture/installation-scripts.md`](./architecture/installation-scripts.md) — `agent-install.sh` + `agent.sh` lifecycles, env-var contract.
- [`architecture/security-threats.md` Drop-privileges contract](./architecture/security-threats.md#additional-hardening-mechanisms) — why the unprivileged-user requirement.
- [`docspec/references/agents/`](../../docspec/references/agents/) — user-facing per-agent reference pages.
