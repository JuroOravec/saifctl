# saif init

Initialize OpenSpec + Shotgun.

One-time setup: creates the `openspec/` directory, configures Shotgun (optionally with Context7 for documentation lookup), and indexes the codebase for spec-driven workflows.

## Requirements

- **LLM API key** — One of: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`
- **CONTEXT7_API_KEY** — (optional) Set to enable Context7 documentation lookup in Shotgun.

## Usage

```bash
saif init [options]
```

## Arguments

| Argument         | Alias | Type    | Description                                            |
| ---------------- | ----- | ------- | ------------------------------------------------------ |
| `--force`        | `-f`  | boolean | Run `openspec init` even if `openspec/` exists         |
| `--project`      | `-p`  | string  | Project name override (default: `package.json` "name") |
| `--openspec-dir` | —     | string  | Path to openspec directory (default: `openspec`)       |

## Examples

Basic init (uses `package.json` name as project):

```bash
saif init
```

Force re-initialize OpenSpec even if `openspec/` already exists:

```bash
saif init -f
```

Override project name:

```bash
saif init -p my-project
```

Use a custom openspec directory:

```bash
saif init --openspec-dir ./my-openspec
```

## What it does

1. Runs `pnpm openspec init` (skipped if `openspec/` exists, unless `-f`)
2. Runs `python -m shotgun.main config init`
3. Optionally configures Context7 via `python -m shotgun.main config set-context7 --api-key <key>` (if CONTEXT7_API_KEY is set)
4. Indexes the codebase with `python -m shotgun.main codebase index . --name <project>`

## Notes

- **Custom Python path** - Use `SHOTGUN_PYTHON=$(uv run which python) saif init ...` if Python needs uv.
