# Shotgun indexer

[Shotgun](https://github.com/shotgun-sh/shotgun) is an optional codebase indexer that parses your repository into an AST-aware semantic graph. Agents can then answer questions like "where is auth handled?" or "what ORM does this project use?" with real file paths and code references instead of guesses.

> Shotgun also serves as a spec designer. See [`references/designers/shotgun.md`](../designers/shotgun.md) for that role.

## Requirements

- Python 3.11+
- `shotgun-sh` package: `pip install shotgun-sh` or `uv sync`

## Usage

Pass `--indexer shotgun` to `saifctl init` or `saifctl feat design`:

```bash
saifctl init --indexer shotgun
```

This runs the following commands internally:

```bash
$SHOTGUN_PYTHON -m shotgun.main config init
$SHOTGUN_PYTHON -m shotgun.main config set-context7 --api-key <key>   # only if CONTEXT7_API_KEY is set
$SHOTGUN_PYTHON -m shotgun.main codebase index . --name <projectName>
```

where `$SHOTGUN_PYTHON` is the value of the `SHOTGUN_PYTHON` environment variable (default: `python`).

## Environment variables

| Variable           | Required | Default  | Description                                                                                                                  |
| ------------------ | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `SHOTGUN_PYTHON`   | No       | `python` | Path to the Python binary with `shotgun-sh` installed. Example: `SHOTGUN_PYTHON=$(uv run which python)`                      |
| `CONTEXT7_API_KEY` | No       | —        | API key for Context7 documentation lookup inside Shotgun. When set, configures the `set-context7` integration during `init`. |

## Agent tool: `queryCodebaseIndex`

Once indexed, agents can query the graph via the `queryCodebaseIndex` tool.

**Input**

| Field      | Type     | Description                                                                                                 |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `question` | `string` | Natural language question about the codebase, e.g. `"where are skills defined?"` or `"how does auth work?"` |

**Behaviour**

- Resolves the graph ID by calling `codebase list --format json` and matching the project name to a `READY` graph entry. Falls back to the first `READY` entry if no exact name match is found.
- Returns AST-aware results covering modules, classes, functions, files, and folders.
- Throws if no `READY` index exists for the project — run `saifctl init --indexer shotgun` first.

**Example agent query**

```
question: "where is the authentication middleware defined?"
```

## Example: full setup with uv

```bash
# Point saifctl at the correct Python
export SHOTGUN_PYTHON=$(uv run which python)

# Optional: enable Context7 docs lookup
export CONTEXT7_API_KEY=ctx7_...

# Index the codebase
saifctl init --indexer shotgun
```
