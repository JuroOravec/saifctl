# Environment variables

## LLM API keys

Set the API key for the provider you want to use. At least one must be present.
When no `--model` flag is given, the factory auto-detects which key is available
and picks a sensible default model for that provider.

| Variable                | Provider       |
| ----------------------- | -------------- |
| `ANTHROPIC_API_KEY`     | Anthropic      |
| `OPENAI_API_KEY`        | OpenAI         |
| `OPENROUTER_API_KEY`    | OpenRouter     |
| `GEMINI_API_KEY`        | Google Gemini  |
| `XAI_API_KEY`           | xAI Grok       |
| `MISTRAL_API_KEY`       | Mistral AI     |
| `DEEPSEEK_API_KEY`      | DeepSeek       |
| `GROQ_API_KEY`          | Groq           |
| `COHERE_API_KEY`        | Cohere         |
| `TOGETHER_API_KEY`      | Together AI    |
| `FIREWORKS_API_KEY`     | Fireworks AI   |
| `DEEPINFRA_API_KEY`     | DeepInfra      |
| `CEREBRAS_API_KEY`      | Cerebras       |
| `HF_TOKEN`              | Hugging Face   |
| `MOONSHOT_API_KEY`      | Moonshot AI    |
| `DASHSCOPE_API_KEY`     | Alibaba (Qwen) |
| `GOOGLE_VERTEX_API_KEY` | Google Vertex  |
| `BASETEN_API_KEY`       | Baseten        |
| `PERPLEXITY_API_KEY`    | Perplexity     |
| `VERCEL_API_KEY`        | Vercel AI      |

**Quick start:** set `ANTHROPIC_API_KEY` in your `.env` file — the factory
will default to `claude-sonnet-4-6` automatically. For the full provider
table and auto-discovery defaults, see [Models](models.md).

## Git provider env vars

[Git providers](./source-control.md) allow your AI agent to create a PR when it is done.

Each provider reads its token from env vars:

| Provider    | Env vars                                                 |
| ----------- | -------------------------------------------------------- |
| `github`    | `GITHUB_TOKEN`                                           |
| `gitlab`    | `GITLAB_TOKEN` (+ optional `GITLAB_URL`)                 |
| `gitea`     | `GITEA_TOKEN`, `GITEA_USERNAME` (+ optional `GITEA_URL`) |
| `bitbucket` | `BITBUCKET_TOKEN`, `BITBUCKET_USERNAME`                  |
| `azure`     | `AZURE_DEVOPS_TOKEN`                                     |

## Container variables

The following variables are **generated at runtime by the orchestrator** and
injected into the Leash coder container. Do not set them in your `.env` — they
will be overwritten.

| Variable                | Set from                                                               |
| ----------------------- | ---------------------------------------------------------------------- |
| `LLM_MODEL`             | Resolved from `--model` (global or agent=model parts) / auto-discovery |
| `LLM_PROVIDER`          | Derived from the `provider/model` prefix                               |
| `LLM_API_KEY`           | Resolved from the provider's standard key env var                      |
| `LLM_BASE_URL`          | Resolved from `--base-url` (global or agent=url parts)                 |
| `REVIEWER_LLM_PROVIDER` | Reviewer model provider                                                |
| `REVIEWER_LLM_MODEL`    | Reviewer model string                                                  |
| `REVIEWER_LLM_API_KEY`  | API key for the reviewer provider                                      |
| `REVIEWER_LLM_BASE_URL` | Optional custom base URL for reviewer                                  |

The `REVIEWER_LLM_*` vars are injected when the semantic AI reviewer (argus-ai) is enabled. See [Semantic reviewer](./reviewer.md).

Agent shell scripts (`agent.sh`, `agent-start.sh`) read the `LLM_*` variables to
configure the coding agent (e.g. `OPENAI_API_KEY` for Codex, `ANTHROPIC_API_KEY`
for Claude Code).

These are the **private** contract between the orchestrator and the
container — you should never need to set them directly.

## Logging

These variables tune what saifac prints to the terminal. They are read by the
[consola](https://github.com/unjs/consola) logger on startup and require no
code changes to take effect.

| Variable        | Description                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONSOLA_LEVEL` | Numeric minimum log level. Lower = quieter. Common values: `0` (fatal only), `3` (info, the default), `4` (verbose), `5` (debug), `999` (trace — everything).                  |
| `DEBUG`         | When set to any non-empty value and `CONSOLA_LEVEL` is **not** set, consola raises its level to `4` (verbose) automatically. Mirrors the Node.js ecosystem `DEBUG` convention. |

Both variables are overridden at runtime by the `--verbose` CLI flag
(`saifac feat run --verbose`), which sets the level to `debug` (5) for that
invocation. Prefer the flag for one-off debugging; prefer the env vars for
persistent configuration or CI.

For full logging architecture details see
[docs/development/logging.md](development/logging.md).

## Docker & Leash (host)

| Variable           | Description                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DOCKER_HOST`      | Docker API endpoint (e.g. `unix:///path/to/docker.sock`). See [Troubleshooting](troubleshooting.md). |
| `SAIFAC_LEASH_BIN` | Optional absolute path to Leash’s `bin/leash.js`. If unset, SAIFAC resolves `@strongdm/leash` from where it is installed.   |

## Hatchet (optional)

Setting these options enables the Hatchet-backed orchestrator, which adds
durability and a local dashboard. When absent, saifac runs in the default
in-process mode. See [Hatchet integration](hatchet.md) for setup instructions.

| Variable               | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `HATCHET_CLIENT_TOKEN` | API token from the Hatchet dashboard. Enables Hatchet.            |
| `HATCHET_SERVER_URL`   | gRPC address of the Hatchet server. Defaults to `localhost:7077`. |

## Reviewer binary cache (host)

The semantic reviewer is a Rust binary that's injected into the container.

SAIFAC downloads the Argus binary on the **host** before mounting it into the container.

The binary is cached under `/tmp/saifac/bin/` as versioned files, e.g. `argus-linux-arm64-v0.5.5`.

| Variable                  | Description                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `SAIF_REVIEWER_BIN_DIR`   | Directory for cached Argus binaries, named `argus-linux-amd64-v<semver>` / `argus-linux-arm64-v<semver>`. Default: `/tmp/saifac/bin`. |

See [Semantic reviewer](./reviewer.md).
