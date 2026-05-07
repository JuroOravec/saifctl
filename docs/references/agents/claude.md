# Agent: claude

Run AI-assisted coding tasks headlessly using [Claude Code](https://code.claude.com), Anthropic's CLI. Invoke with `saifctl feat run --agent claude`.

## Installation

Claude Code is installed automatically at runtime when missing:

```bash
npm install -g @anthropic-ai/claude-code
```

Requires `npm` in the coder image.

## Authentication

Two mutually exclusive auth paths:

| Mode                  | How to activate                                      | Notes                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API key** (default) | Set `ANTHROPIC_API_KEY` (fallback: `LLM_API_KEY`)    | Pay-per-token, billed against the workspace key                                                                                                                               |
| **Claude Max OAuth**  | Pass `--claude-max` or `--claude-credentials <path>` | Reads `~/.claude/.credentials.json` from the host; stages it into the container at mode 600, owned by the unprivileged user. Usage counts against the Max plan's rate limits. |

In OAuth mode the agent script explicitly unsets all `*_API_KEY` env vars and base-URL overrides (`ANTHROPIC_BASE_URL`, `OPENAI_API_BASE`, `OPENAI_BASE_URL`) before invoking `claude`, so a stale key cannot silently override the OAuth tokens and an alternative-endpoint override cannot route the run away from the Max plan.

No generic base-URL override is supported — Claude Code has no `--base-url` flag. Custom endpoints (Azure Foundry, AWS Bedrock) require their own env vars and are not wired by saifctl.

## CLI flags used by the agent

These flags are passed unconditionally on every invocation:

| Flag                             | Description                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p` / `--print`                 | Non-interactive (headless) mode — process the prompt and exit.                                                                                                                     |
| `--model <id>`                   | Model override, sourced from `LLM_MODEL_ID` (bare ID, e.g. `claude-sonnet-4-6`). Do **not** use `LLM_MODEL`; the prefixed form (`anthropic/…`) is rejected by the Claude Code CLI. |
| `--dangerously-skip-permissions` | Skip all permission prompts. Required for headless use. Claude Code refuses this flag when running as root; the agent drops to an unprivileged user before invoking `claude`.      |
| `--output-format stream-json`    | Emit newline-delimited JSON events. Compatible with the factory's log parser and enables streaming progress.                                                                       |
| `--verbose`                      | Show full turn-by-turn output in the run log.                                                                                                                                      |
| `--no-session-persistence`       | Do not save the session to disk. Each factory round is independent.                                                                                                                |
| `--disable-slash-commands`       | Prevent task text from being interpreted as Claude Code slash commands.                                                                                                            |

`--max-turns` is **not** set; Claude runs until it naturally finishes the task.

## Privilege drop

Claude Code 2.x refuses `--dangerously-skip-permissions` when the process runs as root. The agent runs `claude` as `$SAIFCTL_UNPRIV_USER` via `runuser`, which also resets `HOME`/`PATH` to the unprivileged user's login environment. The CLI binary is installed into `$SAIFCTL_UNPRIV_NPM_PREFIX/bin`.

## Environment variables

| Variable                    | Required           | Description                                                                        |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`         | Yes (API key mode) | Anthropic API key. Falls back to `LLM_API_KEY`.                                    |
| `LLM_API_KEY`               | Fallback           | Used when `ANTHROPIC_API_KEY` is unset.                                            |
| `LLM_MODEL_ID`              | Yes                | Bare model ID passed to `--model`.                                                 |
| `SAIFCTL_TASK_PATH`         | Yes                | Path to the file containing the task prompt.                                       |
| `SAIFCTL_CLAUDE_AUTH_MODE`  | No                 | Set to `oauth` by saifctl when `--claude-max` or `--claude-credentials` is used.   |
| `SAIFCTL_UNPRIV_USER`       | Yes                | Unprivileged user to run `claude` as. Baked into each coder Dockerfile.            |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes                | npm prefix where the `claude` binary is installed.                                 |
| `SAIFCTL_WORKSPACE_BASE`    | No                 | Workspace directory (default: `/workspace`). `claude` is invoked with this as cwd. |

## Usage examples

**Run a feature using the claude agent with an API key:**

```bash
export ANTHROPIC_API_KEY=sk-ant-…
saifctl feat run --agent claude --feature my-feature-id
```

**Run using a Claude Max subscription (OAuth):**

```bash
saifctl feat run --agent claude --claude-max --feature my-feature-id
```

**Run with a credentials file at a custom path:**

```bash
saifctl feat run --agent claude --claude-credentials /path/to/credentials.json --feature my-feature-id
```

## See also

- [contributing/agent-profile-options.md](../../contributing/agent-profile-options.md) — profile-options mechanism underlying `--claude-max` / `--claude-credentials`
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
