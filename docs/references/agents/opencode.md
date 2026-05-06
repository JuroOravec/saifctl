# Agent: opencode

Run AI-assisted coding tasks headlessly using [OpenCode](https://github.com/opencode-ai/opencode), an open-source coding agent with a TUI. Invoke with `saifctl feat run --agent opencode`.

## Installation

OpenCode is pre-installed in the Leash image. When missing, it is installed automatically at runtime:

```bash
npm install -g opencode-ai
```

## Authentication

OpenCode reads provider API keys from the environment automatically. saifctl maps the generic `LLM_API_KEY` as a fallback for the most common provider keys:

| Variable | Fallback source | Provider |
|----------|----------------|---------|
| `ANTHROPIC_API_KEY` | `LLM_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | `LLM_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | `LLM_API_KEY` | Google Gemini |
| `OPENROUTER_API_KEY` | `LLM_API_KEY` | OpenRouter |

If a native provider key is already set in the environment, it takes precedence over `LLM_API_KEY`.

## Base URL override

OpenCode has no global base-URL environment variable. When `LLM_BASE_URL` is set, saifctl constructs a provider-scoped JSON config and injects it via `OPENCODE_CONFIG_CONTENT`:

```json
{"provider":{"<provider>":{"options":{"baseURL":"<LLM_BASE_URL>"}}}}
```

The provider id is resolved in order:

1. `LLM_PROVIDER` (explicit override)
2. Prefix of `LLM_MODEL` — e.g. `anthropic/claude-sonnet-4-6` → `anthropic`. **`LLM_MODEL` must contain a `/` for this inference to work.** A bare model name such as `claude-sonnet-4-6` has no provider prefix and inference is skipped silently.

If `LLM_BASE_URL` is set but no provider can be determined, base URL forwarding is skipped and a warning is printed. Pass `--provider <id>` to resolve ambiguity, or use a model identifier that includes a provider prefix.

## Tool permissions

OpenCode has no `--yolo` CLI flag. For headless use the agent sets:

```
OPENCODE_PERMISSION='{"*":"allow"}'
```

This auto-approves all tool calls, equivalent to `--dangerously-skip-permissions` in the claude agent.

## CLI flags used by the agent

| Flag | Value | Description |
|------|-------|-------------|
| `--model` | `$LLM_MODEL` | Model to use, including provider prefix (e.g. `anthropic/claude-sonnet-4-6`). |
| `--format` | `json` | Emit JSON-formatted output for log parsing. |

The task prompt is passed as a positional argument, read from `$SAIFCTL_TASK_PATH`.

## Privilege drop

The agent runs `opencode` as `$SAIFCTL_UNPRIV_USER` via `runuser`, which resets `HOME`/`PATH` to the unprivileged user's login environment. The CLI binary is installed into `$SAIFCTL_UNPRIV_NPM_PREFIX/bin`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_MODEL` | Yes | Model identifier with provider prefix (e.g. `anthropic/claude-sonnet-4-6`). Passed directly to `--model`. |
| `LLM_API_KEY` | Fallback | Generic API key used when no provider-specific key is set. |
| `ANTHROPIC_API_KEY` | No | Anthropic key. If unset, falls back to `LLM_API_KEY`. |
| `OPENAI_API_KEY` | No | OpenAI key. If unset, falls back to `LLM_API_KEY`. |
| `GEMINI_API_KEY` | No | Gemini key. If unset, falls back to `LLM_API_KEY`. |
| `OPENROUTER_API_KEY` | No | OpenRouter key. If unset, falls back to `LLM_API_KEY`. |
| `LLM_BASE_URL` | No | Custom provider base URL. Injected via `OPENCODE_CONFIG_CONTENT` when set. |
| `LLM_PROVIDER` | No | Explicit provider id for base URL scoping (e.g. `anthropic`). Required when `LLM_BASE_URL` is set and the provider cannot be inferred from `LLM_MODEL`. |
| `OPENCODE_CONFIG_CONTENT` | No | JSON config injected by saifctl when `LLM_BASE_URL` is set and a provider can be resolved. **Warning:** saifctl unconditionally overwrites any user-supplied value in that case — do not set this manually when also setting `LLM_BASE_URL` with a resolvable provider. |
| `OPENCODE_PERMISSION` | Set by agent | Set to `{"*":"allow"}` unconditionally to auto-approve all tools. |
| `SAIFCTL_TASK_PATH` | Yes | Path to the file containing the task prompt. |
| `SAIFCTL_UNPRIV_USER` | Yes | Unprivileged user to run `opencode` as. Baked into each coder Dockerfile. |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes | npm prefix where the `opencode` binary is installed. |
| `SAIFCTL_WORKSPACE_BASE` | No | Workspace directory (default: `/workspace`). `opencode` is invoked with this as cwd. |

## Usage examples

**Run a feature using the opencode agent:**

```bash
export ANTHROPIC_API_KEY=sk-ant-…
saifctl feat run --agent opencode --feature my-feature-id
```

**Run with an OpenRouter key and explicit model:**

```bash
export OPENROUTER_API_KEY=sk-or-…
saifctl feat run --agent opencode --model openrouter/anthropic/claude-sonnet-4-6 --feature my-feature-id
```

**Run against a custom base URL with an explicit provider:**

```bash
export LLM_BASE_URL=https://my-proxy.example.com
saifctl feat run --agent opencode --provider anthropic --model anthropic/claude-sonnet-4-6 --feature my-feature-id
```

## See also

- [OpenCode CLI reference](https://opencode.ai/docs/cli/)
- [OpenCode config reference](https://opencode.ai/docs/config/)
- [OpenCode providers reference](https://opencode.ai/docs/providers/)
