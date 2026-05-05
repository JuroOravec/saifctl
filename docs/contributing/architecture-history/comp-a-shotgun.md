# Software Factory Component A2: Shotgun CLI

## What is Shotgun?

Use LLMs to expand a simple feature spec into fully fleshed out technical doc,
by grounding what's in the initial spec against what's actually in the codebase.

Basically, Shotgun allows us to be "lazy" with the prompts feature specs we write.

**[Shotgun](https://github.com/shotgun-sh/shotgun)** is an open-source, local-first CLI tool designed to act as a "codebase-aware spec engine." While tools like OpenSpec provide the _framework and file structure_ for spec-driven development, Shotgun provides the _intelligence_ to write those specs accurately. It indexes your codebase and uses a multi-agent architecture (Researcher, Architect, Product Strategist, Spec Writer) to transform vague feature ideas into rigorous, technically grounded specifications.

## How it Works

Shotgun prevents "vibe coding" (when an AI generates code that looks syntactically correct but fundamentally ignores your existing project architecture).

1. **Indexing:** It uses tools like `tree-sitter` to index your local repository, understanding your existing patterns, ORMs, folder structures, and tech stack.
2. **Multi-Agent Research:** When given a proposal, its internal "Researcher Agent" explores your codebase to find out how you currently handle similar problems (e.g., "How do they currently do database queries? Oh, they use Prisma in `/src/db/`").
3. **Specification Generation:** Its "Architect Agent" then writes a highly detailed `spec.md` and `plan.md` that explicitly constrains the downstream Coder Agent to use those existing patterns.

## WHY We Are Using It

In our AI-Driven Software Factory, the **Architect Agent** is the bottleneck for quality. If the Architect writes a generic design doc ("Use a database to store users"), the Coder Agent will hallucinate an implementation ("I will install Mongoose and create a connection").

We use Shotgun to achieve **Contextual Grounding**:

- **Zero Hallucination Architecture:** By forcing the Architect to use Shotgun, the output plan is hyper-specific: ("Update the existing `User` model in `src/db/schema.prisma` and use the existing `prismaClient` exported from `src/db/index.ts`").
- **Privacy:** It is local-first. It runs on our machine/CI and uses our own API keys, meaning we don't have to upload our entire proprietary codebase to a third-party SaaS just to get a good spec.
- **Perfect Black Box Testing Handoff:** Because the output is so technically specific, the downstream Black Box Testing Agent can write deterministic tests without guessing file paths.

---

## Codebase Indexing: How It Works

When you start a Shotgun session or run a spec workflow, Shotgun performs **semantic codebase indexing** on your local repository. This is similar in spirit to how Cursor indexes your code so its AI can retrieve relevant files—but Shotgun does it so its internal agents can write accurate specifications.

**Do indexing at the beginning** — before drafting features or proposals. Re-index when the codebase changes significantly.

### CLI Workflow (run first)

1. **Index the codebase** (~5 min):

   ```bash
   python -m shotgun.main codebase index . --name <projName>
   ```

   Returns a graph ID (e.g. `52fd6ef2b3f6`).

2. **Confirm index**:

   ```bash
   python -m shotgun.main codebase list
   ```

   Shows ID, name, status, file count, path.

3. **Query the index** (natural language → Cypher):
   ```bash
   python -m shotgun.main codebase query <graphId> "where are skills defined?"
   ```
   Returns AST-aware results (modules, classes, files, folders). The Black Box Testing Agent can use the same index via `codebase query`.

### Building the Index

Shotgun uses **tree-sitter** (a parser generator) to build Abstract Syntax Trees (ASTs) of your source code. Instead of treating files as raw text, it understands structure: classes, interfaces, function exports, imports, and dependency relationships. From these ASTs, Shotgun constructs a searchable **Codebase Graph**—a semantic memory of your repository mapping relationships like "Component A imports Helper B which relies on Database C."

### How Agents Query the Index

The internal agents (Researcher, Architect, Spec Writer) do _not_ get the entire codebase dumped into their context window. They use **tool calling** to query the indexed graph on demand.

When you run `shotgun specify --input proposal.md`:

1. **Researcher Agent** reads the proposal (e.g., "Add user authentication").
2. **Researcher queries the index** via internal tools such as `find_implementations(type: "authentication")` or semantic search.
3. **Index returns context:** The graph returns specific code chunks or file paths (e.g., "Found `User` model in `src/db/schema.prisma` and auth middleware in `src/middleware/auth.ts`").
4. **Researcher explores further** by following AST imports and reading relevant file contents (e.g., "What encryption library does `auth.ts` use?").
5. **Architect Agent** receives the summarized, relevant context and writes `spec.md` constrained strictly to those existing patterns.

This mirrors Cursor's approach: Cursor indexes for _code writing_; Shotgun indexes for _spec writing_.

---

## Agent Configuration & Customization

### Are the agents and steps hardcoded?

**Yes.** Shotgun uses a fixed workflow: **Research → Specify → Plan → Tasks → Export**. The agent roles (Researcher, Architect, Product Strategist, Spec Writer) are predefined—you cannot rewrite their internal prompts or reorder steps. The tool prioritizes consistency over open-ended customization.

### Can I use different models for different agents?

**Yes.** Shotgun is built with **multi-agent, multi-model** support. You can assign different models to different roles:

- **Architect:** Use a smart, high-reasoning model (e.g., `claude-3-7-sonnet`, `o3-mini`) for system design and trade-offs.
- **Researcher:** Use a model with a large context window (e.g., `gemini-1.5-pro`, `claude-3-haiku`) for scanning lots of code.
- **Spec Writer:** Use a faster, cheaper model (e.g., `gpt-4o-mini`, `claude-3-5-haiku`) since it mainly formats Architect output into Markdown.

### `--model` vs `--sub-agent-model`

The CLI exposes two model knobs: `--model` (Router/orchestrator) and `--sub-agent-model` (the Research, Specify, Plan, Tasks, Export sub-agents). `--sub-agent-model` requires `--model` to be set.

**Shotgun's default rationale:** The Router maintains global state, interprets user feedback, evaluates sub-agent output, and decides when to pivot. If it misreads context, the whole pipeline derails—so a capable model helps. Sub-agents get tightly scoped prompts (e.g. "Extract all database schemas from this file"), so a cheaper model can often suffice. Use: `--model gpt-4o --sub-agent-model gpt-4o-mini`.

**Alternative: strong sub-agents, cheap Router.** If the sub-agents are underperforming (generic specs, missed context) or the Router is effectively just a dispatcher, flip it: `--model gpt-4o-mini --sub-agent-model gpt-4o`. The sub-agents do the heavy synthesis; the Router only routes.

### How are agents set? Provider + model strings?

Agents are configured via standard **provider + model strings** (e.g., `claude-3-7-sonnet`, `gpt-4o`) and environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). Shotgun does not natively support custom execution paths like our `cursor-provider` (which invokes Cursor's CLI for model calls with built-in codebase search).

### Can I use our cursor-provider with Shotgun?

**Not directly.** Shotgun calls standard LLM APIs; it does not accept custom TypeScript classes or CLI-based providers. To use `cursor-provider` with Shotgun, you would need a **proxy**:

1. Run a local proxy (e.g., LiteLLM or a custom Express server) exposing an OpenAI-compatible endpoint (`http://localhost:4000/v1`).
2. The proxy intercepts Shotgun's requests and routes them through `cursor-provider` (e.g., spawning the Cursor CLI).
3. Configure Shotgun to point its `BASE_URL` at your proxy instead of official OpenAI/Anthropic endpoints.

---

## Step-by-Step Setup

Shotgun requires Python 3.11+ and Node.js 18+.

### 1. Installation

Install Shotgun via Python:

```bash
pip install shotgun-sh
# or with poetry:
poetry add shotgun-sh
# or with uv:
uv add shotgun-sh
```

### 2. Configuration

Since Shotgun is local-first, it requires your own API keys to power its internal multi-agent team.

**Option A:** Run the interactive config wizard once:

```bash
python -m shotgun.main config init
```

We used [OpenRouter](https://openrouter.ai) when running Shotgun the first time — config init lets you select the provider and enter the API key.

**Option B:** Export your preferred provider's keys in your terminal or `.env`:

```bash
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Context7 (optional):** For documentation lookup during research, we use a free Context7 account. Set the API key via `python -m shotgun.main config set-context7 --api-key` or store it in your Shotgun config.

**Invoking via package.json:** We use `--model openai/gpt-5.2` (via OpenRouter). When passing options like `--spec-dir`, use **pnpm** without `--`: `pnpm shotgun --spec-dir openspec/features/<name>`. With **npm**, use `--` to forward args: `npm run shotgun -- --spec-dir openspec/features/<name>`.

**Required for `--model` (OpenRouter):** `--model` requires `SHOTGUN_OPENAI_COMPAT_BASE_URL` to be set (e.g. `https://openrouter.ai/api/v1`). Config init typically sets this when you choose OpenRouter; otherwise add to `.env`: `SHOTGUN_OPENAI_COMPAT_BASE_URL=https://openrouter.ai/api/v1` and use your OpenRouter key as `OPENAI_API_KEY`.

---

## Commands & Workflows

In our Software Factory pipeline, Shotgun is typically executed programmatically by our Mastra Architect Worker, but it can also be run manually by humans.

### 1. Generating a Spec from a Proposal

Once a human PM has written a raw proposal (e.g., in `features/add-redis/proposal.md` using OpenSpec), we run Shotgun against it:

```bash
shotgun specify --input features/add-redis/proposal.md --output features/add-redis/
```

- **What it does:**
  - Shotgun reads the proposal.
  - It scans the local repository.
  - It generates a codebase-aware `spec.md` and `plan.md` in the output directory.

### 2. The Spec-to-Code Export

Shotgun doesn't just write Markdown; it can format the output explicitly for AI coding assistants.

```bash
shotgun export --format cursor
```

- **What it does:** Packages the generated spec and the specific codebase context it found into a highly optimized prompt file (e.g., `.cursorrules` or a `.md` payload) that can be fed directly to the Coder Agent.

### How it fits into our loop

1. **PM writes:** `proposal.md`
2. **Mastra Architect executes:** `shotgun specify --input proposal.md`
3. **Shotgun outputs:** Codebase-aware `plan.md`
4. **Mastra Black Box Testing Agent executes:** Reads `plan.md` -> writes Black-Box tests (Playwright, Newman, or HTTP Sidecar).
5. **Mastra Coder executes:** Reads `plan.md` + failing tests -> enters convergence loop.
