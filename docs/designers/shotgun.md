# Shotgun (designer)

[Shotgun](https://github.com/shotgun-sh/shotgun) is an **optional** spec designer. It produces specs by statically searching and tracing the codebase.

**Usage:** `saifctl feat design --designer shotgun`

> **Note:** Shotgun also serves as a codebase indexer (`--indexer shotgun`). These are two separate roles. See [Shotgun as indexer](../indexer/shotgun.md) for the indexing role.

---

## Requirements

Using Shotgun **as the designer** requires:

- **Python 3.11+**
- **`shotgun-sh`** installed (`pip install shotgun-sh`)
- One-time Shotgun config wizard run (`config init`) for LLM provider / API keys

---

## Setup

Shotgun requires Python 3.11+.

### Install

```bash
pip install shotgun-sh
# or with uv:
uv add shotgun-sh
```

### Configure

Run the interactive config wizard once to set your LLM provider and API key:

```bash
python -m shotgun.main config init
```

This stores the configuration so you don't need to set environment variables on every run.

---

## Usage

```bash
# Select Shotgun as the designer:
saifctl feat design --designer shotgun

# With a specific model:
saifctl feat design --designer shotgun --model claude-opus-4-5
```

If the spec files already exist in the feature directory, the CLI asks whether to redo them — safe to re-run at any time.

---

## Environment variables

| Variable                         | Purpose                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                 | API key for OpenAI, OpenRouter, or any OpenAI-compatible provider                                                                            |
| `ANTHROPIC_API_KEY`              | API key for Anthropic (Claude)                                                                                                               |
| `SHOTGUN_OPENAI_COMPAT_BASE_URL` | Base URL for OpenAI-compatible providers (e.g. `https://openrouter.ai/api/v1`). Required when using OpenRouter or other proxies              |
| `CONTEXT7_API_KEY`               | (Optional) Enables documentation lookup during Shotgun's research phase. Free account at [context7.com](https://context7.com)                |
| `SHOTGUN_PYTHON`                 | Path to the Python binary with `shotgun-sh` installed (default: `python`). Set when using uv: `export SHOTGUN_PYTHON=$(uv run which python)` |

Shotgun supports OpenAI, Anthropic, and any OpenAI-compatible provider. [OpenRouter](https://openrouter.ai) is the recommended choice — one API key for virtually any model:

```bash
export SHOTGUN_OPENAI_COMPAT_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_API_KEY=sk-or-...   # your OpenRouter key
```

---

## What it produces

Running `saifctl feat design --designer shotgun` writes four files into `saifctl/features/<feature>/`:

| File               | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `plan.md`          | Step-by-step implementation roadmap, grounded in your existing codebase patterns |
| `specification.md` | Precise behavior contract the coding agent must satisfy                          |
| `research.md`      | Codebase findings Shotgun used to inform the spec                                |
| `tasks.md`         | Discrete work items broken out from the plan                                     |

These files are consumed downstream by the when planning and writing tests.

---

## How it works

1. **Read the proposal** — Shotgun reads your `proposal.md` to understand the feature goal.

2. **Research the codebase** — Shotgun queries your codebase using [tree-sitter](https://tree-sitter.github.io) (and optionally Context7), finding existing patterns relevant to your feature.

3. **Write the spec** — Based on the research, Shotgun produces `plan.md`, `specification.md`, `research.md`, and `tasks.md` — all grounded in your actual code structure.

## Notes

- Shotgun manages its own codebase querying internally. When used as a designer, it does not delegate to the factory's `--indexer` tool. Thus, `saifctl init` is not required before using Shotgun as a designer.

---

## See Also

- [Spec designers](./README.md)
- [Shotgun as indexer](../indexer/shotgun.md)
- [Commands reference](../commands/README.md)
- [Environment variables](../env-vars.md)
