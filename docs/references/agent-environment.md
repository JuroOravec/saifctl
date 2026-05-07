# Agent environment reference

Environment variables saifctl passes into the agent container (or local agent process). Distinct from host environment variables, which saifctl itself reads on the host.

---

## Categories

| Category             | How to set                                   | Logged in run storage |
| -------------------- | -------------------------------------------- | --------------------- |
| **Public env**       | `--agent-env KEY=value` / `--agent-env-file` | Yes                   |
| **Secrets**          | `--agent-secret KEY` / `--agent-secret-file` | No                    |
| **Factory-injected** | Set automatically by saifctl                 | Varies                |

---

## Factory-injected variables

saifctl injects these automatically. They cannot be overridden via `--agent-env` or `--agent-secret` — any attempt is dropped with a warning.

### Run identity

| Variable                 | Value                                                     | Notes                                |
| ------------------------ | --------------------------------------------------------- | ------------------------------------ |
| `SAIFCTL_RUN_ID`         | Run UUID                                                  | Present in all modes                 |
| `SAIFCTL_WORKSPACE_BASE` | `/workspace` (container) or host code path (local engine) | Base path for in-container workspace |

### Script paths

| Variable                       | Value                                                | Notes                                                     |
| ------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| `SAIFCTL_STARTUP_SCRIPT`       | `/saifctl/startup.sh` (container) or host path       | Run once before the agent                                 |
| `SAIFCTL_AGENT_INSTALL_SCRIPT` | `/saifctl/agent-install.sh` (container) or host path | Agent install hook                                        |
| `SAIFCTL_AGENT_SCRIPT`         | `/saifctl/agent.sh` (container) or host path         | Main agent entrypoint; omitted in `sandbox --interactive` |
| `SAIFCTL_GATE_SCRIPT`          | Host gate script path                                | Local engine only; absent in container mode               |

### Task and gate loop

Omitted when running `sandbox --interactive` (no task or gate loop).

| Variable                   | Value              | Notes                                  |
| -------------------------- | ------------------ | -------------------------------------- |
| `SAIFCTL_INITIAL_TASK`     | Task prompt string | Full prompt text                       |
| `SAIFCTL_TASK_PATH`        | Task file path     | Local engine only                      |
| `SAIFCTL_GATE_RETRIES`     | Integer as string  | Maximum gate retry count               |
| `SAIFCTL_REVIEWER_ENABLED` | `1`                | Only set when a reviewer is configured |

### Subtask sequence

Omitted when running `sandbox --interactive`.

| Variable                          | Value            | Notes                                           |
| --------------------------------- | ---------------- | ----------------------------------------------- |
| `SAIFCTL_ENABLE_SUBTASK_SEQUENCE` | `1`              | Only set when the run has more than one subtask |
| `SAIFCTL_SUBTASK_DONE_PATH`       | Signal file path | Agent writes this to signal subtask completion  |
| `SAIFCTL_NEXT_SUBTASK_PATH`       | Signal file path | saifctl writes next prompt here                 |
| `SAIFCTL_SUBTASK_EXIT_PATH`       | Signal file path | saifctl writes this to request agent exit       |
| `SAIFCTL_SUBTASK_RETRIES_PATH`    | Signal file path | Retry count for current subtask                 |

---

## LLM variables

Injected from the resolved LLM configuration. Two model forms are provided so each agent script can use whichever form its CLI expects — no shell-side parsing required.

| Variable       | Example value                | Description                                                                                                                                                     |
| -------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_MODEL`    | `anthropic/claude-haiku-4-5` | Full `provider/model` string (LiteLLM-style). Used by multi-provider agents: aider, openhands, mini-swe-agent, terminus, deepagents, opencode, kilocode, forge. |
| `LLM_MODEL_ID` | `claude-haiku-4-5`           | Bare model ID, provider prefix stripped. Used by single-provider native CLIs: claude, codex, gemini, copilot, cursor, qwen.                                     |
| `LLM_PROVIDER` | `anthropic`                  | Set only when a provider is configured                                                                                                                          |
| `LLM_BASE_URL` | `https://api.anthropic.com`  | Set only when a custom base URL is configured                                                                                                                   |

### Reviewer LLM variables

Set only when a reviewer is configured (`SAIFCTL_REVIEWER_ENABLED=1`).

| Variable                | Description                                  |
| ----------------------- | -------------------------------------------- |
| `REVIEWER_LLM_MODEL`    | Reviewer model ID (bare, no provider prefix) |
| `REVIEWER_LLM_PROVIDER` | Reviewer provider                            |
| `REVIEWER_LLM_BASE_URL` | Reviewer base URL                            |

---

## Secret variables

Never written to run storage or debug logs.

| Variable               | Source                                                                       | Description                                            |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `LLM_API_KEY`          | LLM config                                                                   | Primary API key for the agent's LLM                    |
| `REVIEWER_LLM_API_KEY` | Reviewer LLM config                                                          | Reviewer API key; only set when reviewer is configured |
| Provider-specific keys | Host environment                                                             | Additional provider API keys forwarded from the host   |
| User secrets           | `--agent-secret` / `--agent-secret-file` / `config.defaults.agentSecretKeys` | Arbitrary user-defined secrets                         |

### Supplying secrets

```bash
# Forward a single key from the host environment
saifctl run --agent-secret MY_API_TOKEN

# Forward multiple keys (comma-separated or repeated flags)
saifctl run --agent-secret MY_TOKEN,OTHER_SECRET

# Load KEY=value pairs from a .env file (values are never logged)
saifctl run --agent-secret-file .env.secrets
```

---

## User-supplied public env

Set with `--agent-env` or `--agent-env-file`. Values are stored in run storage when run storage is enabled.

```bash
# Pass a single variable
saifctl run --agent-env DEBUG=true

# Load from a .env file
saifctl run --agent-env-file .env.agent
```

Reserved keys (any `SAIFCTL_*` key, plus the LLM and TLS variables in the factory set) are dropped with a warning and never forwarded.

---

## CA bundle variables

Injected to ensure all HTTP clients in the container trust proxy-injected CAs (for example, a corporate MITM proxy). Values are set to the OS CA bundle path (Debian: `/etc/ssl/certs/ca-certificates.crt`; host mode: first existing path among common locations).

| Variable              | Consumers                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `UV_NATIVE_TLS`       | uv; switches from rustls to OS TLS so injected CAs are trusted                                                          |
| `SSL_CERT_FILE`       | Python `ssl`, OpenSSL                                                                                                   |
| `REQUESTS_CA_BUNDLE`  | Python `requests`, LiteLLM/httpx                                                                                        |
| `CURL_CA_BUNDLE`      | curl                                                                                                                    |
| `NODE_EXTRA_CA_CERTS` | Node.js agents (claude, cursor, kilocode, copilot, opencode); appends OS bundle without replacing Node's built-in roots |

These variables are factory-enforced and cannot be overridden by the user.

---

## Reserved key list

The following keys are dropped with a warning if passed via `--agent-env` or `--agent-secret`:

- All keys matching the prefix `SAIFCTL_`
- `LLM_API_KEY`, `LLM_MODEL`, `LLM_MODEL_ID`, `LLM_PROVIDER`, `LLM_BASE_URL`
- `REVIEWER_LLM_PROVIDER`, `REVIEWER_LLM_MODEL`, `REVIEWER_LLM_API_KEY`, `REVIEWER_LLM_BASE_URL`
- `UV_NATIVE_TLS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`
