# Agent: kilocode

Run AI-assisted coding tasks headlessly using [Kilo Code](https://github.com/Kilo-Org/kilocode), an OpenCode fork. Invoke with `saifctl feat run --agent kilocode`.

## Installation

Kilo Code is installed automatically at runtime:

```bash
npm install -g @kilocode/cli
```

Requires Node.js 20.18.1 or later.

**Older CPUs:** The standard npm package may crash with `Illegal instruction` on CPUs without AVX support. Use the `-baseline` release instead.

## Configuration

Provider config (`apiKey`, `baseURL`) and permissions are injected via the `OPENCODE_CONFIG_CONTENT` environment variable as inline JSON — no config file needs to exist in the project.

### Model format

Models are specified in `provider/model` format, e.g. `anthropic/claude-sonnet-4-5`. When `LLM_PROVIDER` is unset, the provider is inferred from the prefix of `LLM_MODEL`.

### Permissions

Kilo uses a JSON `"permission"` config key rather than a CLI flag. The agent injects `{"permission":"allow"}`, which auto-approves all tool use. This is equivalent to `--yolo` mode and is required for headless factory runs.

## CLI flags used by the agent

| Flag | Description |
|------|-------------|
| `run` | Non-interactive mode — run with a message and exit. |
| `--auto` | Autonomous mode: disables all permission prompts. Required for headless factory use. |

The task prompt is read from `$SAIFCTL_TASK_PATH` and passed as the message argument to `kilo run`.

## Privilege drop

The agent drops privileges before invoking `kilo`. `kilo` runs as `$SAIFCTL_UNPRIV_USER` via `runuser`, which resets `HOME`/`PATH` to the unprivileged user's login environment. The CLI binary is resolved from `$SAIFCTL_UNPRIV_NPM_PREFIX/bin`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_MODEL` | No | Model in `provider/model` format (e.g. `anthropic/claude-sonnet-4-5`). When unset, kilo uses its globally configured default model. |
| `LLM_PROVIDER` | No | Explicit provider ID. When set, takes precedence over the prefix in `LLM_MODEL`. |
| `LLM_API_KEY` | Conditional | API key forwarded to the provider's `apiKey` config field. Required when a provider is configured; unused (and warned against) when no provider can be determined. |
| `LLM_BASE_URL` | No | Custom base URL forwarded to the provider's `baseURL` config field. |
| `SAIFCTL_TASK_PATH` | Yes | Path to the file containing the task prompt. |
| `SAIFCTL_UNPRIV_USER` | Yes | Unprivileged user to run `kilo` as. Baked into each coder Dockerfile. |
| `SAIFCTL_UNPRIV_NPM_PREFIX` | Yes | npm prefix where the `kilo` binary is installed. |
| `SAIFCTL_WORKSPACE_BASE` | No | Workspace directory (default: `/workspace`). `kilo` is invoked with this as cwd. |

## Assembled config

The agent builds `OPENCODE_CONFIG_CONTENT` from the environment variables above. A representative assembled value (with secrets redacted):

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "permission": "allow",
  "autoupdate": false,
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "****",
        "baseURL": "****"
      }
    }
  }
}
```

`autoupdate: false` suppresses self-update attempts during factory runs.

If no provider can be determined and `LLM_API_KEY` is set, the agent logs a warning and skips provider config injection. `kilo` will then use whatever credentials exist in the user's global config.

## Usage examples

**Run a feature with an Anthropic model:**

```bash
export LLM_API_KEY=sk-ant-…
export LLM_MODEL=anthropic/claude-sonnet-4-5
saifctl feat run --agent kilocode --feature my-feature-id
```

**Run with an explicit provider and custom base URL:**

```bash
export LLM_PROVIDER=openai
export LLM_MODEL=openai/gpt-4o
export LLM_API_KEY=sk-…
export LLM_BASE_URL=https://my-proxy.example.com/v1
saifctl feat run --agent kilocode --feature my-feature-id
```

## See also

- [Kilo Code CLI reference](https://kilocode.ai/docs/cli)
- [OpenCode config reference](https://opencode.ai/docs/config) — shared config schema used by Kilo Code
