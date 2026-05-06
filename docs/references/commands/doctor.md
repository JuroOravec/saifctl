# Command: doctor

Run environment and configuration health checks before using `feat run` or `sandbox`. Use this command when install or credentials are misconfigured.

```
saifctl doctor
```

No flags or subcommands. All checks run in sequence automatically.

## Checks

Checks run in the following order:

| # | Check | Failure mode |
|---|-------|-------------|
| 1 | **Docker daemon** — runs `docker info` | Hard fail if Docker is not running or not reachable |
| 2 | **Leash CLI** — verifies `@strongdm/leash` binary is present at the resolved path | Hard fail if the path cannot be resolved or does not exist |
| 3 | **Leash daemon image** — checks whether the default Leash daemon Docker image is present locally or reachable on the registry | Soft warning if neither |
| 4 | **Default sandbox images** — checks the default coder image and default test runner image, each locally then on the registry | Soft warning if either is absent and unreachable |
| 5 | **Cedar policy** — structural lint of the default Cedar policy file: exists, non-empty, contains at least one `permit`/`forbid` rule | Hard fail if missing, unreadable, or empty; soft warning if no rules found |
| 6 | **LLM provider API key** — checks whether any supported provider key env var is set | Soft warning if none are set |
| 7 | **Hatchet** — three-state check (see below) | See below |
| 8 | **Argus reviewer endpoint** — network probe of the GitHub Releases download URL for the Argus reviewer binary | Soft warning if unreachable |

### Hatchet check states

| `HATCHET_CLIENT_TOKEN` | `SAIFCTL_EXPERIMENTAL_HATCHET` | Result |
|------------------------|-------------------------------|--------|
| Not set | — | Soft warning: local (in-process) mode |
| Set | Not `1` | Soft warning: Hatchet integration gated for v0.1.0 |
| Set | `1` | Attempts gRPC connection to `HATCHET_SERVER_URL`; hard fail if SDK error or local mode initializes |

### Soft warnings vs. hard failures

A **hard failure** causes `doctor` to exit with code `1`. A **soft warning** is advisory — doctor prints the warning and continues; the final summary still shows "All checks passed."

Hard failures:
- Docker not running
- Leash CLI path missing
- Cedar policy file not found, unreadable, or empty
- Hatchet server mode: gRPC SDK error or unexpected local-mode initialization (when `HATCHET_CLIENT_TOKEN` is set and `SAIFCTL_EXPERIMENTAL_HATCHET=1`)

Everything else is a soft warning.

## Environment variables

| Variable | Used by check | Description |
|----------|--------------|-------------|
| `HATCHET_CLIENT_TOKEN` | Hatchet | Enables Hatchet server mode |
| `SAIFCTL_EXPERIMENTAL_HATCHET` | Hatchet | Set to `1` to opt in to the experimental Hatchet path |
| `HATCHET_SERVER_URL` | Hatchet | gRPC server address (default: `localhost:7077`) |
| `ANTHROPIC_API_KEY` | LLM keys | Anthropic provider key |
| `OPENAI_API_KEY` | LLM keys | OpenAI provider key |
| `GEMINI_API_KEY` | LLM keys | Gemini provider key |
| `OPENROUTER_API_KEY` | LLM keys | OpenRouter provider key |

Any other provider key from `src/llm-config.ts` is also accepted for the LLM check.

## Usage examples

**Run all checks:**

```bash
saifctl doctor
```

**Run in server mode with Hatchet experimental flag:**

```bash
HATCHET_CLIENT_TOKEN=<token> SAIFCTL_EXPERIMENTAL_HATCHET=1 saifctl doctor
```

**Run with an Anthropic key to satisfy the LLM check:**

```bash
ANTHROPIC_API_KEY=<key> saifctl doctor
```
