# POC Explorer

POC Explorer is the default spec designer. It runs a sandboxed coding agent to build a proof-of-concept to explore the feature before writing the spec. The spec is grounded in what actually works in your codebase, not just static analysis.

**Usage:** `saifctl feat design` (default) or `saifctl feat design --designer poc`

---

## Why POC Explorer?

Traditional spec designers read your code and reason about a feature. POC Explorer takes a different approach: it lets an agent *attempt* a rough implementation first, then derives the spec from what it discovered.

The agent explores edge cases, finds tricky interactions with your existing patterns, and surfaces design decisions you didn't know you needed to make — before the real implementation run begins.

---

## What it produces

All output files land in `saifctl/features/<feature>/`:

| File | Required | Purpose |
| --- | --- | --- |
| `specification.md` | Yes | Precise behavior contract for the feature, grounded in what the agent discovered |
| `plan.md` | Yes | Step-by-step implementation roadmap based on the exploration |
| `poc-findings.md` | No | Freeform notes — edge cases, open questions, design decisions hit during exploration |
| other files | No | Diagrams, scratch notes, etc |

---

## Usage

```bash
# Default — POC Explorer runs automatically:
saifctl feat design

# Explicit:
saifctl feat design --designer poc

# With a specific model for the coding agent:
saifctl feat design --designer poc --model anthropic/claude-opus-4-5
```

---

## How it works

1. **Reads the proposal** `proposal.md` to understand the feature goal.

2. **Starts an agent Run** — The agent runs inside a Docker container with access to a **copy** of your codebase. It attempts a quick implementation to probe constraints.

3. **Writes the spec** — Once the agent has enough understanding, it writes `specification.md` and `plan.md` and exits.

---

## Environment variables

The LLM API key for the agent must be available in the environment. See [Models](../models.md) for how to set a specific provider or model.

---

## Notes

- **No indexer tool is passed to the agent.** The factory's `--indexer` flag does not apply to the POC run.
- **Docker required.** POC Explorer runs a sandboxed coding agent inside a Docker container.

---

## See Also

- [Spec designers](./README.md)
- [Commands reference](../commands/README.md)
- [feat design](../commands/feat-design.md)
- [Models](../models.md)
- [Environment variables](../env-vars.md)
