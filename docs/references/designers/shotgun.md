# Shotgun designer

Statically searches and traces the codebase to produce a full feature specification — no agent run, no LLM-driven exploration.

## Overview

The Shotgun designer delegates to the [`shotgun-sh`](https://github.com/shotgun-sh/shotgun) CLI to generate four spec files inside the feature directory:

| File | Purpose |
|---|---|
| `plan.md` | High-level feature plan |
| `specification.md` | Detailed specification |
| `research.md` | Codebase research notes |
| `tasks.md` | Breakdown of implementation tasks |

The designer is considered complete once all four spec files exist in the feature directory.

## Usage

```bash
saifctl feat design --designer shotgun
```

The designer reads an optional `proposal.md` from the feature directory. If found, it passes the proposal text as the prompt to `shotgun-sh`. If not found, it runs the full `research → specify → plan → tasks` flow with a default prompt.

## Prerequisites

- **Context7 integration** must be configured before first use. Run `saifctl init` once to set this up; Shotgun relies on it for internal codebase querying.
- Python 3.11+
- `shotgun-sh` installed in the target Python environment:
  ```bash
  pip install shotgun-sh
  # or
  uv add shotgun-sh
  ```
- One-time LLM provider / API key setup:
  ```bash
  shotgun-sh config init
  ```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SHOTGUN_PYTHON` | `python` | Path to the Python binary that has `shotgun-sh` installed. Use `SHOTGUN_PYTHON=$(uv run which python)` when working inside a `uv` virtual environment. |

## Behaviour notes

- **Static only.** Shotgun traces the codebase without running an agent loop, making it faster than the default `poc` designer but without the grounding that comes from executing code.
- **Model override.** Pass `--model <id>` to `saifctl feat design` to forward a model identifier to Shotgun.
- **Indexer vs. designer.** Shotgun also functions as a codebase indexer (`--indexer shotgun`). These are two separate roles. See the Shotgun indexer reference for details.

## Contrast with `poc`

| | `shotgun` | `poc` (default) |
|---|---|---|
| Exploration style | Static analysis | Agent-driven |
| LLM calls | Managed by `shotgun-sh` | Managed by saifctl |
| Speed | Faster | Slower |
| Grounding | Code structure | Running code |
