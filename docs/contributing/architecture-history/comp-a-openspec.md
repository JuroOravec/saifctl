# Software Factory Component A: OpenSpec

## What is OpenSpec?

A standard for writing and managing features as spec documents. Prescribes _where_
the documents should be written. Keep track of what was implemented and what's in development.

**[OpenSpec](https://github.com/Fission-AI/OpenSpec)** is an open-source, lightweight spec-driven development (SDD) framework designed specifically for AI coding assistants. Maintained by Fission-AI, it replaces unstructured "vibe coding" with a rigorous, standard process that aligns human intent with AI execution. It forces teams to establish a "source of truth" using Markdown files stored directly alongside the codebase.

## How it Works

OpenSpec works by fundamentally separating the **current state of the system** from **proposed changes**:

1. **The `specs/` directory:** This is the authoritative source of truth detailing how the software currently behaves.
2. **The `changes/` directory:** This is where new features or fixes are planned and developed in isolation before being merged into the codebase (and subsequently updating the `specs/`).

Instead of asking an AI to just "build a feature," you interact with OpenSpec via standardized slash commands that guide the AI through a structured lifecycle: Proposal $\rightarrow$ Spec $\rightarrow$ Design $\rightarrow$ Implementation $\rightarrow$ Archive.

## WHY We Are Using It

In our AI-Driven Software Factory, unstructured conversational prompts inevitably lead to "hallucination cascades." If an AI Agent misinterprets a plain PRD and starts writing code, the error compounds.

We use OpenSpec to achieve **Deterministic Intent**.

- **Boundaries:** By explicitly telling our Architect Agent to only read the `specs/` folder, we prevent it from hallucinating features that don't exist.
- **Auditability:** Because OpenSpec keeps human-readable planning docs in version control, we have a complete audit trail of _why_ an AI wrote specific code.
- **Agent Handoff:** OpenSpec's structured artifacts provide the exact inputs needed for the next step in our factory (e.g., feeding the proposal into the `Shotgun` CLI to generate codebase-aware constraints).
- **Vendor Agnostic:** It works with any underlying LLM or Agent (Cursor, Claude Code, our custom Mastra workers).

---

## Step-by-Step Setup

Installing OpenSpec into our monorepo is straightforward, as it runs via Node.js.

### 1. Global Installation

First, install the CLI globally on your machine (requires Node.js 20.19.0+):

```bash
npm install -g @fission-ai/openspec@latest
```

### 2. Project Initialization

Navigate to the root of the repository and initialize the framework:

```bash
openspec init
```

_This command will create the required directory structure (`/specs/` and `/changes/`) and generate the necessary configuration files._

### 3. Baseline Specification (Optional but Recommended)

If you have an existing codebase, you should write a baseline spec for your core modules so the AI has context:

- Create `/specs/architecture.md`
- Create `/specs/database.md`
- Keep these files updated to reflect the absolute current truth of the main branch.

---

## Commands & Workflows

Once installed, OpenSpec defines a strict workflow for creating new features. When a human Product Manager wants to request a new feature from the Software Factory, they initiate the following flow:

### 1. Create a New Change

To start a new feature or bug fix, run:

```bash
/opsx:propose "Add Redis Caching"
```

- **What it does:** Creates a new folder under `/changes/add-redis-caching/` and scaffolds a `proposal.md` file.
- **Human Action:** The Product Manager writes the raw requirements into `proposal.md`.

### 2. Archive and Update Truth

After the code is written, tests have passed (via our Convergence Loop), and the PR is merged:

```bash
/opsx:archive
```

- **What it does:** The AI updates the master `/specs/` directory to reflect the newly added Redis caching behavior, and moves the `/changes/add-redis-caching/` folder to an archive state. The system's source of truth is now up to date for the next iteration.

### 3. Fast-Forward Planning (`/opsx:ff`) — We Do Not Use

OpenSpec provides `/opsx:ff` to generate technical specs in one shot:

```bash
/opsx:ff
```

- **What it does (if used):** The AI reads the `proposal.md` and the existing `/specs/`, then generates `spec.md`, `design.md`, and `tasks.md`.
- **In our Factory:** We **do not** call `/opsx:ff`. Instead, we use **Shotgun** (`shotgun specify --input changes/add-redis/proposal.md`), which indexes the codebase and produces codebase-aware `spec.md` and `plan.md`.

### 4. Apply the Changes (`/opsx:apply`) — We Do Not Use

OpenSpec provides `/opsx:apply` to hand off implementation to an AI:

```bash
/opsx:apply
```

- **What it does (if used):** Instructs the AI Coder Agent to implement the code defined in `tasks.md` and `design.md`.
- **In our Factory:** We **do not** call `/opsx:apply`. Instead, we use our **Convergence Loop** (TDFlow / Ralph Wiggum): the Coder Agent runs autonomously against the Black Box Testing Agent's failing tests until they pass, without interactive OpenSpec prompts.

---

## FAQ

### Are the `/opsx:` commands callable via CLI?

**No.** The `/opsx:propose`, `/opsx:ff`, `/opsx:apply`, and `/opsx:archive` commands are **strictly agent tools**—prompt instructions, not terminal executables.

- **Slash commands** are pre-packaged instructions that OpenSpec injects into your AI tool’s context (e.g., `.cursor/commands/` for Cursor, `.claude/commands/` for Claude Code, `.windsurf/workflows/` for Windsurf).
- When you type `/opsx:ff` into Cursor’s chat, Cursor looks up the corresponding prompt template, runs the LLM, and uses the model’s output to generate the planning artifacts.
- You **cannot** run `/opsx:ff` in a normal Bash or Zsh terminal; there is no `openspec ff` CLI command.

### OpenSpec CLI

The `openspec` CLI you install via npm is for **repository management and validation**, not for invoking LLMs. It does not generate specs or run models.

| CLI Command         | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `openspec init`     | Scaffolds `/specs/`, `/changes/`, and agent-specific rules |
| `openspec validate` | Checks if Markdown specs conform to the schema             |
| `openspec status`   | Shows progress of current change artifacts                 |
| `openspec archive`  | Programmatically finalizes completed changes               |
| `openspec list`     | Lists changes and specs                                    |
| `openspec view`     | Opens an interactive terminal dashboard                    |
| `openspec show`     | Outputs artifact content                                   |

Many CLI commands support `--json` for programmatic use by scripts and autonomous agents (e.g., our Mastra Architect can run `openspec status --json` in a sandboxed shell to check the project state without relying on LLM calls).

### Which AI Agent Generates the Technical Specs? (Fast-Forward Planning)

OpenSpec is **bring-your-own-agent**. It does not call any model APIs itself; it only configures the tools you already use.

#### In interactive mode

**The agent that generates the specs is whichever tool you type the slash command into.**

- If you type `/opsx:ff` in **Cursor Composer** (e.g., with `claude-3-7-sonnet`), Cursor’s Claude will read the proposal and generate `spec.md`, `design.md`, and `tasks.md`.
- If you type `/opsx:ff` in **Claude Code** in your terminal, Anthropic’s CLI agent does it.
- The same applies to Windsurf, Cline, or any supported AI coding assistant.

During `openspec init`, OpenSpec writes rules into that tool’s native config so it understands what each slash command means. The model is whatever your IDE or CLI agent is configured to use.

#### In our automated Software Factory

For a fully automated, non-interactive pipeline (e.g., Mastra Architect Worker), we do not type commands into a chat window.

Instead, we **programmatically** pass OpenSpec’s instructions into our chosen LLM:

1. Read the rule files OpenSpec generated (e.g., `AGENTS.md` or the contents of `.cursor/commands/`).
2. Use them as `systemInstruction` (or equivalent) for the Mastra Architect agent.
3. Send a user prompt such as: _“Execute the opsx:ff workflow for `changes/add-redis/proposal.md`. Attach the proposal content.”_

The Architect agent’s configured model (e.g., `claude-3-7-sonnet`, `o3-mini`) performs the fast-forward planning. **We choose the agent by choosing which Mastra worker and model we call.**
