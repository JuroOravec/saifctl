# Spec Designers

**Spec designers** turn your feature proposal into a full, production-ready spec before any agent writes a line of code. Instead of handing a vague prompt to a coding agent and hoping for the best, a designer researches your codebase, reasons about the change, and produces structured output the agents can act on reliably.

---

## Why use a designer?

Without a designer, you hand a feature prompt directly to a coding agent:

> "Add user login."

The agent guesses. It invents a database schema that doesn't match yours, imports a library you're not using, and structures the code in a way that breaks your existing conventions. You review 400 lines of drift and patch it by hand.

With a designer, a dedicated research-and-spec agent runs first:

> `feat:design add-login` →
>
> `plan.md` — Implementation steps grounded in your existing patterns  
> `specification.md` — Precise behavior contract the agent must satisfy  
> `research.md` — Codebase findings that informed the spec  
> `tasks.md` — Broken-down work items, ready to hand to the coding agent

The coding agent sees a grounded spec, not a one-liner. It ships closer code on the first attempt.

---

## Choosing a designer

Use `--designer <id>` with `feat:design`:

```bash
pnpm agents feat:design add-login --designer shotgun
```

| ID | Name | Project URL |
| --- | --- | --- |
| [`shotgun`](./shotgun.md) | Shotgun _(default)_ | [Link](https://github.com/shotgun-sh/shotgun) |

---

## How to use it

The designer runs as part of `feat:design`.

### 1. Create a proposal

```bash
saif feat new add-login
```

Edit `openspec/changes/add-login/proposal.md` with what you want to build. One paragraph is enough — the designer figures out the rest.

### 2. Run spec generation — `feat:design`

```bash
pnpm agents feat:design add-login
# or explicitly:
pnpm agents feat:design add-login --designer shotgun
```

The designer reads your `proposal.md`, researches the codebase (via the active indexer), and writes the 4 spec files into `openspec/changes/add-login/`.

If the spec files already exist, the CLI asks whether to redo them — so re-running is always safe.

### 3. Choose a model — `--model`

Pass `--model` to override the LLM the designer uses:

```bash
pnpm agents feat:design add-login --model claude-opus-4-5
```

### 4. Disable the designer

Pass `--designer none` to skip spec generation entirely and jump straight to black-box test design — useful when you've already written your spec files manually:

```bash
pnpm agents feat:design add-login --designer none
```

---

## Designer and indexer: how they work together

The designer and indexer are complementary — they both run during `feat:design`, but they do different things:

| | Indexer | Designer |
|---|---|---|
| **What** | Parses your repo into a semantic graph | Researches your codebase and writes the spec |
| **When** | Runs at `saif init` (build) and `feat:design` (query) | Runs at `feat:design` |
| **Output** | A queryable codebase index | `plan.md`, `specification.md`, `research.md`, `tasks.md` |
| **Flag** | `--indexer` | `--designer` |

The designer uses the indexer to ground its spec in real code. Some designers (like Shotgun) manage their own codebase querying internally — they use the index but don't delegate to the factory's indexer tool.

---

## See Also

- [Shotgun designer](./shotgun.md)
- [Codebase Indexers](../indexer/README.md)
- [Commands reference](../commands/README.md)
- [Environment variables](../env-vars.md)
