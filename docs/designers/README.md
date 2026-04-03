# Spec Designers

**Spec designers** turn your feature proposal into a full, production-ready spec before any agent writes a line of code. Instead of handing a vague prompt to a coding agent and hoping for the best, a designer researches your codebase, reasons about the change, and produces structured output the agents can act on reliably.

---

## Why use a designer?

Without a designer, you hand a feature prompt directly to a coding agent:

> "Add user login."

The agent guesses. It invents a database schema that doesn't match yours, imports a library you're not using, and structures the code in a way that breaks your existing conventions. You review 400 lines of drift and patch it by hand.

With a designer, a dedicated research-and-spec agent runs first.

**What files designers produce?**

Every designer writes at least:
- `specification.md` - The detailed spec of the feature.
- `plan.md` - The step-by-step plan for the agent to follow.

Any extra files depend on the profile. The full list of files is documented in the [profile pages](#choosing-a-designer).

---

## Choosing a designer

Use `--designer <id>` with `saifctl feat design`:

```bash
# default — no flag needed:
saifctl feat design

# explicit:
saifctl feat design --designer poc
saifctl feat design --designer shotgun
```

| ID                        | Name                   | When to use                                                                                           |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| [`poc`](./poc.md)         | POC Explorer _(default)_ | Runs a sandboxed coding agent to build a proof-of-concept to explore the feature before writing the spec. Grounded, discovers edge cases. |
| [`shotgun`](./shotgun.md) | Shotgun                | Static codebase research + spec writing via the Shotgun CLI. Faster; no Docker required.             |

---

## How to use it

The designer runs as part of `saifctl feat design`.

### 1. Create a proposal

```bash
saifctl feat new
```

Edit `saifctl/features/add-login/proposal.md` with what you want to build. One paragraph is enough — the designer figures out the rest.

### 2. Run spec generation — `saifctl feat design`

```bash
saifctl feat design
# or with specific designer:
saifctl feat design --designer poc
saifctl feat design --designer shotgun
```

The designer reads your `proposal.md`, researches the codebase, and writes the required spec files into `saifctl/features/add-login/`.

If the spec files already exist, the CLI asks whether to redo them — so re-running is always safe. Use `-y`/`--yes` with `--name` to skip the prompt and assume redo (non-interactive mode).

### 3. Choose a model — `--model`

Pass `--model` to override the LLM the designer uses:

```bash
saifctl feat design --model claude-opus-4-5
```

### 4. Disable the designer

Pass `--designer none` to skip spec generation entirely and jump straight to tests generation — useful when you've already written your spec files manually:

```bash
saifctl feat design --designer none
```

---

## Designer and indexer: how they work together

The designer and indexer are complementary during `saifctl feat design`, but they are **not** the same thing.

The **default POC designer** explores the repo inside a sandbox and does not use the indexer tool.

The **Shotgun designer** runs its own research pipeline (separate from `--indexer`).

The indexer is used by the test-generation step when enabled (`feat design-tests`).

| Who        | Indexer                                                                        | Designer                                                 |
| ---------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **What**   | Parses your repo into a semantic graph                                         | Turns the proposal into spec files under the feature dir |
| **When**   | Optional: `saifctl init --indexer …` (build),<br/>`feat design` with `--indexer` (query) | Runs at `saifctl feat design`                             |
| **Output** | A queryable codebase index                                                     | `plan.md` + `specification.md` + extra files |
| **Flag**   | `--indexer`                                                                    | `--designer`                                             |

---

## See Also

- [POC Explorer designer](./poc.md)
- [Shotgun designer](./shotgun.md)
- [Codebase Indexers](../indexer/README.md)
- [Commands reference](../commands/README.md)
- [Environment variables](../env-vars.md)
