# Product shape — four interaction modes, end-to-end

> Companion to [`vision.md`](./vision.md),
> [`competitive-landscape.md`](./competitive-landscape.md),
> [`exploration-plan.md`](./exploration-plan.md). Those three set
> direction and validation. This doc explores **what the product
> actually looks like to each user type** and how the modes
> interlock under the hood. Last updated 2026-05-07.
>
> Forked from a parent thread on per-phase config. Phase 1 (per-phase
> config, currently in [`per-phase-config/design.md`](../per-phase-config/design.md))
> is the primitive everything below builds on; treat it as a given
> here.

---

## Three product stories — sandbox, features, workflows

> Three distinct product surfaces saifctl exposes. They share
> infrastructure (sandboxing, agent CLI runner, cedar policy,
> container model) but target different use cases and offer
> different guarantees. The four-modes table below describes
> **how** the user authors; this section describes **what**
> they're doing and which guarantees apply.

| Story | What it is | Tests' role | "Agent can't cheat" guarantee? |
|---|---|---|---|
| **Sandbox** | Run an agent CLI in a sandboxed container against an arbitrary workspace. Ad-hoc, exploratory; user drives directly. | Minor / optional — tests aren't the primary concern. | No (rarely tested) |
| **Spec-driven features** | Author a `feature.yml` + specification + committed tests; saifctl iterates the convergence loop until the tests pass. The OG saifctl positioning. | Central — committed tests are the authoritative gate. Mutability rules + holdout pattern apply. | **Yes** — tests protected from agent modification; holdout tests physically stripped from the agent's sandbox copy. |
| **Workflows** (v1) | Compose multiple steps in a DAG; sources, sinks, branching, subworkflows. Per-step tests gate each step; cumulative-scope regression protection across the DAG. | Tests gate each step; `files:` retains feature-mode guarantees; `assert:`-generated tests are regenerated each run (regeneration is the contract). | **Partial.** `files:`-listed tests get the spec-feature guarantees. `assert:`-generated tests are regenerable from the assertion text; modifications by the agent are overwritten on the next run, so "uncheatable per-run" doesn't apply — but the assertion text IS uncheatable as the canonical contract. |

What these splits imply for design choices and user expectations:

- **Sandboxing, cedar policies, container isolation, network
  egress controls** — apply to ALL THREE stories. Story-agnostic
  hardening.
- **Guaranteed execution** (saifctl drives the loop to
  completion; agent can't bail mid-way) — applies to features
  and workflows. Sandbox is fire-and-forget.
- **"Agent can't cheat"** — applies fully to features, partially
  to workflows (depends on `files:` vs `assert:` choice within
  the workflow).
- **Test runner architecture** (separate container, JUnit XML,
  cumulative scope) — applies to features and workflows. Same
  mechanism; workflows-mode extends it to a multi-step DAG.

The three stories are **orthogonal to the four authoring modes**
(§1 below). Every story can be authored via filesystem CLI
(Mode 1), code SDK (Mode 2), web app (Mode 3), or cloud-managed
(Mode 4) — though some pairings are more natural than others:

| Story × Mode | Mode 1 (CLI) | Mode 2 (SDK) | Mode 3 (web) | Mode 4 (cloud) |
|---|---|---|---|---|
| Sandbox | **Primary** | Possible | Future | Future |
| Features | **Primary (today)** | Future | Limited | Future |
| Workflows | Phase 2 | Phase 2.5 | **Phase 3 target** | Phase 3 |

Documentation responsibility: the three-stories framing surfaces
on the saifctl website + README. Tracked in
[`release-readiness/specification.md`](../release-readiness/specification.md)
— when the workflow API launch lands, the marketing surfaces
need to reflect the story split prominently so users pick the
right tool for their use case, and so the
"agent-can't-cheat" claim is scoped accurately per story.

---

## 1. The four modes at a glance

| Mode | User | Authoring artefact | Where it runs | Stage |
|---|---|---|---|---|
| **1. Filesystem CLI** | Developer | `feature.yml` + `phases/<id>/` tree on disk | Local CLI; can target remote | **Today** |
| **2. Code/DSL CLI** | Developer (TS-first) | TypeScript / JSON / YAML programmatic build of the same shape | Local CLI; can target remote | **Phase 2** |
| **3. End-user web app** | Non-engineer / data scientist / domain expert | Visual node graph with text-described steps | Cloud only | **Phase 3** |
| **4. Control plane / server** | Platform operator (us, or enterprise admin) | (no authoring — receives jobs) | Cloud (managed) or on-prem | **Phase 3** |

Modes 1 and 2 author *workflows* directly. Mode 3 authors a higher-
level visual graph that **compiles** down to a Mode-1 workflow under
the hood. Mode 4 is the runtime layer that actually executes
workflows submitted from any of 1, 2, or 3.

The unifying primitive across all four: **the workflow is a DAG of
phases, each phase is a sandboxed agent-CLI run, the artefact between
phases is a workspace.** Modes 1, 2, 3 differ in *how* the DAG is
authored; mode 4 differs in *where* it runs.

---

## 2. Mode 1 — Filesystem CLI (today, with workflow extension)

### What it looks like

```
my-feature/
├── feature.yml          # workflow-level config (run-defaults)
├── workflow.yml         # NEW — DAG composing the phases
├── plan.md
├── critics/
│   ├── strict.md
│   └── audit.md
└── phases/
    ├── 01-extract/
    │   ├── spec.md
    │   ├── phase.yml    # (per-phase config from Phase 1)
    │   └── tests/
    ├── 02-analyze/
    │   ├── spec.md
    │   └── tests/
    └── 03-report/
        ├── spec.md
        └── tests/
```

`workflow.yml` is the new artefact; everything else exists today.
Shape (sketch):

```yaml
# workflow.yml — RFC #74 Part 2 territory
sources:
  repo:
    type: github
    url: https://github.com/foo/bar
    branch: main
  data:
    type: s3
    uri: s3://my-bucket/2026.xlsx

steps:
  - phase: 01-extract
    inputs: { workspace: sources.repo, dataset: sources.data }
  - phase: 02-analyze
    inputs: { workspace: outputs.01-extract }
    when: outputs.01-extract.exitCode == 0
  - phase: 03-report
    inputs: { workspace: outputs.02-analyze }

sinks:
  pdf:
    type: s3
    uri: s3://my-bucket/reports/${run.id}/revenue_report.pdf
    from: outputs.03-report.files['revenue_report.pdf']
  notify:
    type: email
    to: data-team@example.com
    on: success
```

### Mental model

- **Sources** = ingress (GitHub clone / S3 fetch / direct upload /
  webhook trigger). Run once, outside the sandbox, before phases.
- **Steps** = phases (the existing saifctl primitive). Each is one
  sandboxed agent-CLI run; workspace flows in, mutated workspace
  flows out. The DAG can branch / loop / fan out.
- **Sinks** = egress (S3 write / email / GitHub PR / Slack / webhook
  out / download link). Run after their upstream phase completes.

### Who it's for

The same audience saifctl serves today, with the workflow layer
unlocking branching / parallel / loops. The CLI invocation grows:

```bash
# Today
saifctl feat run --feature my-feature

# Tomorrow
saifctl workflow run --feature my-feature
saifctl workflow run --feature my-feature --remote saifctl.cloud  # mode 1 → mode 4
```

### What's new vs Phase 1

- `workflow.yml` schema + parser
- Source/sink integrations (init layer)
- DAG executor (probably built on Hatchet, which we already use
  internally for run orchestration)
- `--remote` flag that submits the whole workflow bundle to a control
  plane instead of running locally

---

## 3. Mode 2 — Code / DSL CLI (TypeScript-first)

### What it looks like

```typescript
import { workflow, step, source, sink } from '@safe-ai-factory/saifctl-workflow-sdk';

const repo = source.github({ url: 'https://github.com/foo/bar', branch: 'main' });
const data = source.s3({ uri: 's3://my-bucket/2026.xlsx' });

const extract = step({
  id: '01-extract',
  spec: './phases/01-extract/spec.md',  // or inline string
  inputs: { workspace: repo, dataset: data },
  agent: { profile: 'claude', model: 'anthropic/claude-opus-4-5' },
});

const analyze = step({
  id: '02-analyze',
  spec: './phases/02-analyze/spec.md',
  inputs: { workspace: extract },
  when: ({ outputs }) => outputs['01-extract'].exitCode === 0,
});

const report = step({
  id: '03-report',
  spec: './phases/03-report/spec.md',
  inputs: { workspace: analyze },
});

export default workflow({
  sources: { repo, data },
  steps: [extract, analyze, report],
  sinks: {
    pdf: sink.s3({
      uri: 's3://my-bucket/reports/${run.id}/revenue_report.pdf',
      from: report.files['revenue_report.pdf'],
    }),
    notify: sink.email({ to: 'data-team@example.com', on: 'success' }),
  },
});
```

### Mental model

Same nodes (source / step / sink), different surface. Returns the
same intermediate representation (IR) as Mode 1's `workflow.yml` —
they're isomorphic. Mode 2 wins on:

- Type-checked references (`outputs['01-extract']` is a typed
  object).
- Programmatic generation (loops over a config, conditional steps
  built from runtime data).
- IDE affordances (autocomplete, go-to-definition for sources).
- Composition (`import { sharedFlow } from './shared'` — sub-flows).

Mode 1 wins on:

- Reviewability (the file *is* the spec; no compilation step in your
  head).
- No build step; works in any language project.
- Lint-friendly (`feat phases validate` already exists; extends to
  workflow.yml).

### Who it's for

Mastra / LangGraph / Inngest / Trigger.dev users — engineers who
prefer code. Same mental model as those tools but with workspace-
shaped step I/O instead of JSON-state.

### What's new

- `@safe-ai-factory/saifctl-workflow-sdk` npm package — wraps the same compiler that
  consumes `workflow.yml`. Both modes emit the same IR.
- Build step: `saifctl workflow build my-flow.ts` produces a
  serialised workflow bundle. The CLI runs the bundle the same way
  it runs a `workflow.yml` directory.

### Decision deferred

Whether the SDK ships in v0 (alongside `workflow.yml`) or follows
later. Lean: YAML-first per [exploration-plan H9](./exploration-plan.md#h9--yaml-first-dsl-preference);
SDK as Phase 2.5. Validates the H9 hypothesis along the way.

---

## 4. Mode 3 — End-user web app

The most novel mode. The user-facing surface is dramatically
simpler than Mode 1 / 2; the heavy lifting moves to a code-
generation step that compiles the visual graph to a Mode-1
workflow.

### 4.1 The user-facing surface

#### Canvas with three node types

```
┌───────────────────┐      ┌────────────────────────┐      ┌────────────────────┐
│   GitHub source   │ ───▶ │       Step node        │ ───▶ │   S3 / Email sink  │
│                   │      │                        │      │                    │
│   foo/bar @ main  │      │   action: …            │      │   send PDF to      │
│                   │      │   result: revenue_…    │      │   data-team@…      │
│                   │      │   how: …               │      │                    │
└───────────────────┘      └────────────────────────┘      └────────────────────┘
```

#### Step node fields (from the user's description)

- **Action** — *what* the agent should do, in plain language. The
  more detailed the better. e.g. "open `2026.xlsx`, find the
  `revenue` table, compute year-over-year growth per category."
- **Result** — *what end state* the workspace should be in.
  e.g. "`revenue_report.pdf` exists at the workspace root with
  three sections: summary, per-category breakdown, anomalies."
- **How** — *steering details*. e.g. "use `pandas` for the
  analysis, `weasyprint` for PDF rendering. Don't include
  rows where `revenue == 0`."

These three fields are deliberately under-determined. The user
doesn't write code; they describe intent. The product fills the
rest.

#### Other node types (control flow)

- **Branch** — split based on a condition the previous step
  produced. (UI: "if file X exists" / "if test Y passes" / "if
  agent reports Z".)
- **Parallel fan-out** — run two or more next-steps from the same
  upstream.
- **Loop** — repeat a step until a condition.
- **Sub-flow** — drop in a saved workflow as a single node (the
  composition story from RFC #74 Part 2).

These match the DAG primitives from RFC #74 Part 2 1:1.

#### Source / sink palette (integrations)

Sources:
- GitHub (OAuth) — pick repo + branch + optional subpath
- GitLab / Bitbucket — same
- S3 / GCS / R2 — bucket + prefix + credentials
- Direct upload — drag-drop a folder / zip
- Webhook trigger — endpoint URL we generate
- Schedule trigger — cron-like

Sinks:
- S3 / GCS — bucket + prefix
- GitHub PR — opens PR against the source branch (only if source
  was GitHub)
- Email — to address(es), subject, on:success/failure/always
- Slack — channel + on:condition
- Webhook out — URL + payload shape
- Download link — generates a signed URL surfaced in the UI
- Custom HTTP — user-defined endpoint

### 4.2 Behind the scenes — compilation

When the user hits "save," the visual graph compiles to a Mode-1
workflow:

```
visual graph (nodes + edges + step text fields)
     │
     │  (1) graph topology  ──────────────►  workflow.yml
     │       sources, steps, sinks, edges
     │       branching/loop/parallel structure
     │
     │  (2) per-step text fields  ─────────►  phases/<id>/spec.md
     │       (Claude Sonnet rewrites the
     │       action/result/how fields into
     │       a saifctl-shaped spec.md)
     │
     │  (3) per-step result field   ────────►  phases/<id>/tests/
     │       (Claude Sonnet generates a
     │       test file that asserts the
     │       described end state)
     │
     ▼
   workflow bundle  ────────────────────────►  control plane (mode 4)
```

**Three LLM calls per save** (cacheable):

1. Topology → `workflow.yml`. Deterministic (no LLM needed) given
   the visual graph.
2. Step's `action`/`how` → `spec.md`. The LLM rewrites the user's
   plain-language fields into a saifctl-shaped spec. Reuses the
   `proposal.md` → `specification.md` pipeline saifctl already has.
3. Step's `result` → `tests/`. The LLM generates a test file that
   asserts the described end state ("`revenue_report.pdf` exists,
   non-empty, contains the three sections"). Reuses the existing
   `design-tests` flow.

Steps 2 and 3 are saifctl features today: `feat design-discovery`
+ `feat design-specs` + `feat design-tests`. We're not inventing new
LLM pipelines; we're wiring the existing ones to the web UI.

### 4.3 Editability (the escape hatch)

Power users get a "view generated config" button on every step
that exposes the underlying `spec.md` / `phase.yml` / `tests/`.
They can edit by hand; subsequent saves don't re-overwrite their
edits unless they explicitly regenerate.

This matters because:
- The LLM will sometimes generate a spec that's *almost* right; a
  manual tweak is faster than re-prompting.
- It's the bridge from Mode 3 → Mode 1: a user who outgrows the
  web app exports the workflow bundle and runs it via the CLI.
- It builds trust by showing what's behind the magic.

### 4.4 The execution flow (after "Run" is clicked)

The user's described flow, formalised:

```
1. Web UI sends workflow bundle + run inputs to control plane.
2. Control plane authenticates the user, validates the bundle,
   schedules a worker.
3. Worker VM picks up the job:
   a. Resolves sources (git clone / s3 fetch / extract upload).
      Bundles them into a workspace dir.
   b. Sets up a saifctl sandbox dir using that workspace.
   c. Runs `saifctl workflow run` locally inside the worker against
      the generated workflow bundle.
   d. saifctl spins up Docker container per phase (per the
      per-phase-config work; phase boundaries may restart the
      coder container if Level-2/3 settings differ).
   e. Container runs the agent CLI (Claude / Aider / OpenHands /
      whichever the workflow specified). Tests gate each phase.
      Reviewers run after gates.
   f. saifctl emits the final workspace state.
4. Worker resolves sinks: pulls files from the workspace, ships
   them to S3 / email / GitHub PR / etc per the sink config.
5. Worker reports completion / status / logs back to the control
   plane. UI updates.
```

Per the user's note: when there are multiple workflows (or steps
within one) that should share state, they reuse the same coder
container as saifctl subtasks — the same mechanism phase 1 already
uses. So "step in workflow" maps to "subtask in saifctl run." The
container restart cost from per-phase-config §7.5 only fires at
boundaries where Level-2/3 config differs; otherwise, free.

### 4.5 The end-user authoring loop (debugging)

Critical to nail this; non-engineers won't stay if iteration is
opaque.

What goes wrong, in order of likelihood:

1. **The agent did *almost* what the user asked.** Workspace ends
   in slightly the wrong state. Solution: the user edits the
   `action`/`result`/`how` fields (specifically the *result* field
   — that's the test contract); regenerates; re-runs.
2. **The test was too strict.** The agent did the right thing but
   the LLM-generated test rejected it. Solution: a "relax test"
   button regenerates the test with looser assertions, or the user
   edits the test directly.
3. **The setup is wrong.** GitHub OAuth expired, S3 credentials
   wrong. Surface clearly at the source node, not in a phase log.
4. **The agent burned through budget without converging.**
   Per-phase `limits.max-attempts` (already in v1 of per-phase
   config) caps this. Need the UI to show "phase exhausted N/N
   attempts; here's what it tried each time."

The web UI shows, for each step:
- The generated `spec.md` and `tests/` (collapsible).
- The agent's reasoning trace per attempt.
- The diff applied to the workspace each round.
- The gate / test output per round.
- Cost so far + projected.

This is roughly what `saifctl run inspect` already exposes; the web
UI just renders it for non-CLI users.

### 4.6 The crux — does the LLM-generated spec actually work?

The whole Mode-3 thesis depends on the
`action`/`result`/`how` → `spec.md` + `tests/` translation being
reliable enough that non-engineers can drive it. Risk:

- **Specs that are too vague** → agent does the wrong thing → user
  blames the tool not their description. Mitigation: the
  generation step prompts the LLM to *interview the user* if the
  fields are under-specified, surfaced as inline clarifying
  questions before the workflow runs.
- **Tests that are too strict / lenient** → either always-fail or
  always-pass. Mitigation: show the generated test to the user
  before the first run; offer a "dry-run" that just emits the
  test verdict on a synthetic workspace.
- **The `how` field is brittle** — users will write conflicting
  hints. Mitigation: limit `how` to short bullet-style hints; the
  LLM merges them into the spec.md preamble, doesn't try to make
  them load-bearing.

This is the highest-risk part of Mode 3. See
[exploration-plan H3](./exploration-plan.md#h3--flattening-pain)
adjacent — actually a separate hypothesis worth testing
explicitly before building Mode 3:

> **H16 (NEW)** — non-engineers can describe an agent step well
> enough in `action`/`result`/`how` for the LLM to produce a
> working spec, with <2 iterations average.

To validate cheaply: take 5 saifdocs-style or DS-style real tasks,
write them in the 3-field format with 5 different non-engineers,
manually compile to spec.md (we play the LLM), run on saifctl,
measure first-run-success rate. If it's <50%, the auto-compile
needs to do interview-style clarification before "save."

---

## 5. Mode 4 — Control plane / execution server

### 5.1 Responsibilities

| Surface | What it owns |
|---|---|
| Identity | Users, orgs, API keys, OAuth tokens for sources/sinks |
| Workflows | Stored bundles (mode 1, 2, or 3 emit the same shape) |
| Sources / sinks | Integration registry, credential vault |
| Worker pool | Provisioning, lifecycle, health, autoscaling |
| Scheduling | Cron-like triggers, webhook triggers, manual triggers |
| Run state | Per-run lifecycle (queued / running / paused / failed / complete), durable replay |
| Streaming | Logs, status events, intermediate workspace previews |
| Storage | Source uploads, intermediate workspace snapshots, final outputs |
| Billing | Usage tracking, plan limits, cost surfaces in the UI |
| Audit | Who ran what, when, against which sources, with which agent |
| Webhooks | Inbound (triggers) + outbound (sink callbacks) |

### 5.2 Architecture sketch

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Web UI (mode 3)                             │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │  (HTTPS / WebSocket)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Control plane API                              │
│                                                                      │
│   auth ── workflows ── runs ── sources ── sinks ── billing ── audit  │
│                                                                      │
│   Postgres (durable state)         S3 (workspace snapshots,          │
│                                       outputs, large artefacts)     │
│                                                                      │
│              ▼                                                       │
│   ┌──────────────────────┐                                           │
│   │   Hatchet (queue)    │   ◀── (we already use it for run orch)   │
│   └──────────┬───────────┘                                           │
└──────────────┼──────────────────────────────────────────────────────┘
               │
               ▼
       ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
       │   Worker VM   │  │   Worker VM   │  │   Worker VM   │
       │               │  │               │  │               │
       │   saifctl +   │  │   saifctl +   │  │   saifctl +   │
       │   Docker +    │  │   Docker +    │  │   Docker +    │
       │   Leash       │  │   Leash       │  │   Leash       │
       └───────────────┘  └───────────────┘  └───────────────┘
              │                  │                  │
              └──── coder containers + Cedar ────────┘
                  (saifctl's existing runtime)
```

Worker VM = "saifctl as a daemon." Each worker is a Linux VM with
saifctl installed, Docker available, and a long-running daemon that
polls for jobs from the control plane. When a job arrives:

1. Daemon receives workflow bundle.
2. Daemon resolves sources into a workspace dir.
3. Daemon invokes `saifctl workflow run` against that workspace +
   bundle. (Nothing changes about saifctl's internals; it runs
   locally on the worker exactly as it would on a developer's
   laptop.)
4. Daemon resolves sinks against the resulting workspace.
5. Daemon streams events (round summaries, gate results, costs)
   back to the control plane.

This is the **key architectural decision**: the control plane
doesn't replace saifctl's orchestration; it just ferries workflow
bundles to workers and aggregates results. saifctl keeps doing
what it does today, just on a remote VM instead of the user's
laptop.

### 5.3 BYO-runner / on-prem (enterprise)

Same architecture, deployed inside the customer's VPC. Workers
run in their cloud; control plane runs either in our cloud (with
the workers calling out via HTTPS) or fully self-hosted.

The on-prem story matches Ona / Coder.com's model. From
[exploration-plan H12](./exploration-plan.md#h12--byo-runner-is-enterprise-unlock):
worth validating before investing, but the architecture supports
it cleanly because saifctl-on-a-VM is the unit of compute.

### 5.4 Multi-tenancy

Every run executes in an isolated Docker container on a VM, with
Leash + Cedar enforcing network policy. The hard isolation is
already there; we add tenant-aware resource quotas (CPU/memory/
runtime caps) and per-tenant credential vaults. The substrate
(Hatchet, Postgres, S3) is shared per-region; per-customer
sharding only kicks in for very large enterprise tenants.

### 5.5 What's *not* in Mode 4

- The agent itself — that's saifctl's existing primitive, running
  on the worker.
- The DAG executor — that's saifctl's workflow.yml runner, also
  on the worker. Hatchet at the control plane level just queues
  *whole runs*, not steps within a run. (We could split it later;
  not for v0.)
- Real-time multi-user collaboration on a single workflow. Out of
  scope for v0.

This narrows the control plane substantially. Most of what looks
like "orchestration" is actually saifctl-on-a-worker, which we
already have.

---

## 6. The data science vertical

User's stated interest. Worth thinking through specifically because
DS workflow shape differs from SWE.

### 6.1 Why DS specifically

- **Lots of "transform a workspace" jobs.** ETL, EDA, modeling,
  reporting, ad-hoc analyses. The unit of work is a directory
  (notebook + data + outputs), not a code change.
- **Less critical-path than SWE.** Easier to land a ~95%-correct
  output; doesn't need to ship to production.
- **Existing tooling is heavyweight.** Dagster / Airflow / Prefect
  are for *production pipelines*; ad-hoc analyses live in
  notebooks-on-a-laptop. The middle ground — "production-grade
  reproducibility for ad-hoc work" — is underserved.
- **DS users are more likely to be the Mode-3 audience** than
  software engineers. Less attached to CLI-first; happier with a
  visual canvas.
- **Data-science notebooks already feel "workspace-shaped."** The
  notebook + its outputs + intermediate datasets are a natural
  workspace. No translation gap.

### 6.2 Distinguishing properties

What's different from SWE workflows:

- **Notebooks (.ipynb) as first-class artefacts.** Workspace
  diff-rendering needs to handle them — show cell-level changes,
  rendered outputs.
- **Datasets are big.** A SWE workspace is ~tens of MB; a DS
  workspace might be ~GB+. Workspace transfer between phases
  (per [exploration-plan §2.2 artefact-rep spike](./exploration-plan.md#22-technical--product-discovery))
  has to handle this. Pure tarball-in-S3 may struggle; durable
  volume mounts or content-addressed dataset stores
  (Hugging Face Datasets, DVC, lakeFS) become more interesting.
- **"Tests" are weaker.** What does "test passes" mean for an
  EDA? Possible answers: "report file exists and has N
  sections," "the analysis matches a held-out validation
  dataset," "the trained model's accuracy ≥ X." The
  `result` field in Mode 3 carries most of this; the LLM-
  generated test is less rigorous than for SWE.
- **Reproducibility is the value prop.** "Same dataset version +
  same workflow + same params → same output" is what DS users
  pay for. Saifctl's existing artifact + run-storage primitives
  give us this for free; we lean into it.
- **Interactive exploration, then pinned runs.** A DS user iterates
  on the workflow until happy, then schedules it monthly. The
  iteration loop matters more than for SWE.

### 6.3 DS-specific node types

Sources:
- Dataset (S3 / GCS / Hugging Face / lakeFS / direct upload of a
  parquet / CSV / Excel)
- Notebook template (existing .ipynb to start from)
- Database (read-only connection: snowflake, bigquery, postgres)

Steps:
- Analysis (action: "find anomalies"; result: "report with N
  flagged rows"; how: "use isolation forest")
- Cleaning (action: "handle nulls, dedupe"; result: "clean
  parquet with X rows")
- Modelling (action: "train regressor"; result: "model artifact +
  metrics report"; how: "xgboost; 5-fold CV")
- Reporting (action: "summarize findings"; result: "PDF /
  dashboard / slides")

Sinks:
- Report (PDF, HTML, Notion page)
- Dashboard (write to BI tool: Metabase, Hex, Mode)
- Dataset write-back (to lakeFS, DVC, S3 with versioning)
- Notebook artifact (the executed .ipynb itself, with outputs)
- Model artifact (model card + binary, push to registry)

### 6.4 Concrete DS workflows that motivate the product

The kind of workflow a DS user could build in Mode 3 in <10
minutes:

1. **Excel → PDF report** (the user's example).
   - Source: direct upload `2026.xlsx`.
   - Step: action=analyse `revenue` table; result=`revenue_report.pdf`
     with summary + per-category breakdown + anomalies; how=use
     pandas + weasyprint.
   - Sink: email to data-team@.

2. **Monthly anomaly scan.**
   - Source: schedule trigger (1st of month) → S3 fetch last
     month's data.
   - Step: action=run anomaly detection; result=`anomalies.json`
     with flagged rows; how=isolation forest, threshold 0.95.
   - Branch: if `anomalies.json` non-empty.
   - Sink (if anomalies): Slack to #data-alerts with summary +
     CSV link.

3. **Notebook reproducibility runner.**
   - Source: GitHub repo with a `.ipynb`.
   - Step: action=execute the notebook end-to-end; result=executed
     notebook with all outputs cached; how=fail if any cell errors.
   - Sink: GitHub PR with the executed notebook.

4. **Hyperparameter sweep.**
   - Source: GitHub repo with a model training script.
   - Parallel fan-out: 10 step nodes, each with different
     hyperparams.
   - Sink: collected metrics CSV → S3.

5. **CSV → cleaned parquet**.
   - Source: direct upload.
   - Step: action=clean (drop nulls, dedupe, type-cast); result=
     parquet with X rows; how=pandas, then pyarrow write.
   - Sink: S3 + a download link.

These look familiar to DS users. They look unfamiliar in any of
the existing tools (Dagster's too heavy; Prefect's too code-first;
Airflow's not for ad-hoc; Mastra/LangGraph don't speak files).

### 6.5 The DS positioning hook

If we lead with DS instead of SWE, the framing changes:

- "GitHub Actions for AI agents" doesn't resonate (DS users don't
  live on GitHub Actions).
- "OS for code agents" doesn't resonate (DS users don't think of
  themselves as code-agent operators).
- "**Reproducible, AI-augmented data workflows**" might. Lean
  into reproducibility as the moat (saifctl's run-storage +
  Cedar-policy gives us audit trails for free), and AI as the
  authoring shortcut (LLM compiles the visual graph to the spec).

This is a sharply different GTM than the SWE-led framing in the
landscape doc. **The two GTMs don't conflict** — saifctl's substrate
serves both — but the marketing top-of-funnel and the launch
content focus differ. Worth deciding which to lead with based on
exploration-plan §2.1 user research.

---

## 7. Cross-cutting concerns

### 7.1 Auth + identity

- **Mode 1 / 2 (CLI)** — API key (saifctl already supports a
  config file with secrets).
- **Mode 3 (web)** — OAuth (GitHub, Google) + email/password.
  Per-org permissions for shared workflows.
- **Mode 4 (server)** — manages the above.

Source/sink credential vault: per-user (or per-org) stored
encrypted; injected into the worker at run time, not into the
workflow bundle. Avoids leaking creds in workflow files
committed to GitHub.

### 7.2 Billing transparency (avoid the Replit Agent 3 backlash)

Two pricing primitives, only one user-facing:

- **Internal:** worker-VM seconds, LLM tokens.
- **User-facing:** "phase-runs" (one phase = one unit) plus
  flat-rate compute for long-running phases.

Show projected cost before "Run." Cap maximum spend per
workflow / per month. Per-phase cap (already a v1 feature via
`limits.max-attempts`).

### 7.3 Observability + debugging

Every run produces:
- A timeline view (which phase, when, how long, what cost).
- A per-phase audit trail (agent rounds, gate outputs, files
  changed).
- A diff view between phase entry and exit workspaces.
- A reasoning-trace export for the LLM.

Tied to saifctl's existing `runs/storage` + `inspector` mode;
the web UI just renders it.

### 7.4 Versioning + reproducibility

- Workflow bundles are content-addressed (hash of the YAML +
  spec.md + tests).
- Run records pin: workflow hash, source hashes (GitHub commit
  SHA, S3 ETag, etc), agent version, model version.
- "Re-run" with identical pins reproduces. (Can't guarantee
  bit-identical LLM output, but everything else.)

### 7.5 Multi-tenancy (security)

- Each run = isolated Docker container (saifctl's existing
  posture).
- Leash + Cedar enforce per-run network policy (per-phase, per
  the per-phase-config v1).
- Per-tenant resource quotas at the worker daemon.
- Per-tenant credential isolation in the vault.

### 7.6 Open-source posture

Hatchet / Mastra / Inngest / Trigger.dev / OpenHands all use
**open-core + cloud**. Lean toward matching:

- saifctl CLI = OSS (already is).
- Workflow.yml schema + executor = OSS (Phase 2).
- SDK = OSS (Phase 2.5).
- Web UI = source-available or closed; cloud only.
- Control plane = closed cloud; on-prem licensed for enterprise.

This means power users can run the entire saifctl + workflow
stack locally without us — and pay us when they want managed
execution, the visual UI, or enterprise features. The Hatchet
playbook.

---

## 8. Iteration loops by user type

How each user type debugs / iterates the workflow they authored.

| User | Authoring artefact | Iterates by | Sees feedback in |
|---|---|---|---|
| **Mode 1 dev** | `workflow.yml` + `phases/` | Editing files, `git commit`, `saifctl workflow run` | CLI logs, `feat phases compile` preview, runs ledger in `.saifctl/runs/` |
| **Mode 2 dev** | TS file | Editing, `saifctl workflow build`, run | Same as Mode 1 + TS type errors at build |
| **Mode 3 end-user** | Visual graph | Editing step text fields, "Run" button | Web UI: live status, diff view, agent reasoning, cost so far |
| **Mode 4 operator** | (n/a — receives jobs) | Operating ops dashboard | Hatchet UI for queues; control-plane admin views |

### Key for Mode 3 (the new one)

"Iterate fast" means:
1. Change one field on one step.
2. See *immediately* (without re-running) what the regenerated
   spec.md / tests look like.
3. Re-run only the affected step + downstream.

That last bullet is non-trivial — it requires:
- Workspace snapshots between phases (already implied by the DAG
  layer).
- A "resume from here" execution mode (`run resume` already
  exists at the saifctl level — extends to step-level resume).
- The web UI letting the user pin a step as "the new starting
  point."

This makes the difference between "the web app is a toy" and
"the web app is a real authoring environment." Worth investing
in early.

---

## 9. Decisions to make (parking lot)

Open questions surfaced by writing this down. Each is its own
follow-up.

### Product

- **Mode 3's degree of automation.** Does the LLM-spec generation
  ask clarifying questions before saving (interview mode), or
  generate first then refine on failure? Lean: interview, because
  fast-fail is cheaper than failed-runs.
- **What do source/sink "node configs" look like to non-engineers?**
  GitHub OAuth is fine; S3 credentials are scary. Need a credential-
  manager experience that doesn't ask users to paste IAM keys
  inline.
- **Web app collaboration.** Can two people edit the same workflow
  at once? Lean: no for v0; lock + last-edited timestamp.
- **Workflow templates / marketplace.** Pre-built workflows for
  common DS tasks ("CSV → cleaned parquet," "monthly anomaly
  scan"). Big GTM lever for Mode 3; what's the curation process?
- **Manual-edit conflict resolution.** When a user manually
  edits a generated `spec.md`, then re-prompts the step text,
  what wins? Lean: warn-and-confirm before overwriting.

### Architecture

- **Workspace artefact storage.** S3 for finals, but inter-phase
  storage on a worker VM is local disk (cheap, fast). What about
  inter-phase storage *across* worker restarts (e.g. when a phase
  needs an image swap)? Probably a content-addressed S3 store
  that the worker can re-fetch.
- **Worker autoscaling.** Cold starts matter for non-engineers
  who'll click "Run" and expect <30s pickup. Pre-warmed worker
  pools; per-customer dedicated workers for enterprise.
- **Hatchet's role.** Internal queue today. As control-plane
  workhorse, sufficient? Or does the workflow-DAG layer above
  saifctl runs need a different durable executor (Restate?
  Temporal?). [exploration-plan H11](./exploration-plan.md#h11--hatchet-extends-naturally)
  decides this.
- **Step-level vs run-level Hatchet.** Each saifctl run already
  runs as one Hatchet workflow internally. The control plane
  could either treat each saifctl run as one Hatchet job (simple)
  or hoist the step-level DAG into Hatchet (richer cross-step
  retries, but more coupling).

### GTM

- **DS-led vs SWE-led launch.** Both viable; can't do both at once.
  Pick one for the first 6 months.
- **Free tier.** Necessary for adoption; bounds the cost. Define
  the free tier shape in tandem with pricing.
- **Open-source flagships.** Beyond saifdocs, what 2–3 OSS
  workflows do we ship as proof points? (Picked up from
  exploration-plan §2.3.)

---

## 10. What this implies for the build sequence

Refines the high-level Phase 1 / 2 / 3 split from
[`vision.md`](./vision.md):

### Phase 1 — per-phase config (in flight)

In [`per-phase-config/design.md`](../per-phase-config/design.md).
Atomic-unit-ifies the phase. **Pre-req for everything below.**

### Phase 2 — workflow layer (CLI-first)

After Phase 1 ships:
- `workflow.yml` schema (filesystem-driven, mode 1).
- DAG executor (probably built on Hatchet).
- Source / sink registry — **just** GitHub + S3 + direct upload +
  email + Slack for v0. The integration list grows over time.
- Workspace artefact representation chosen per
  [exploration-plan H10](./exploration-plan.md#h10--tarball-in-s3).
- `saifctl workflow run` CLI command.
- (Stretch) `@safe-ai-factory/saifctl-workflow-sdk` for mode 2 — defer if H9 says YAML-
  first dominates.

This is enough to ship "saifctl + workflows" as a CLI-only
product. Validates the workflow primitive before the cloud
investment.

### Phase 3a — control plane MVP (mode 4)

After Phase 2 ships:
- Worker VM image (saifctl + Docker + daemon).
- Control plane API (auth, workflows, runs, queues).
- `--remote` flag on the CLI submits to the control plane.
- Run status + log streaming back to the CLI.

CLI users get cloud execution. No web UI yet; this is "you wrote
a workflow.yml; we'll run it on our VMs."

### Phase 3b — web app (mode 3)

After Phase 3a ships:
- Visual canvas for nodes + edges.
- LLM compilation pipeline (action/result/how → spec.md / tests).
- Source / sink configurators in the UI.
- Run dashboard, audit, billing.
- Interview-mode clarification before saving a step.
- **Step-level resume** — see §10.1 below; load-bearing for Mode 3
  authoring iteration.

**Parallel sub-sequence:** the data-science vertical features
(notebook handling, dataset versioning) ship as part of 3b *if*
DS-led GTM is chosen; otherwise defer to 3c.

### Phase 3c — enterprise (BYO-runner, on-prem)

After 3b is stable:
- Self-hosted control plane image.
- BYO worker pool (workers in customer's VPC, control plane in
  ours, or fully self-hosted).
- SSO, audit-export, advanced policy controls.

This is the slow burn for enterprise revenue once the SMB / pro-
sumer adoption exists.

### Sequencing rationale

- **Don't build the cloud before the workflow.** Phase 2 (CLI-only
  workflow) validates the primitive before we invest in the
  control plane.
- **Don't build the web before the cloud.** Phase 3a (control
  plane) is the substrate the web app depends on.
- **Don't build the web for everyone before validating Mode 3.**
  Phase 3b should ship a narrow vertical (DS) first, broaden once
  the LLM-spec compilation is proven.
- **BYO-runner (3c) is the slow burn.** Don't gate earlier
  releases on it.

The total scope is large. But each phase is independently shippable
and revenue-generating: Phase 2 alone is "saifctl with workflows" =
a Mastra-LangGraph competitor with workspace I/O. Phase 3a alone is
"cloud execution for those workflows." Phase 3b adds the web UI on
top. Each step opens a market without burning the runway on the
next.

### 10.1 Step-level resume — load-bearing for Mode 3

A specific capability that's mentioned in §8 (iteration loops) but
deserves its own callout here so it isn't lost in Phase 3b's bullet
list. **The Mode-3 authoring iteration loop ("change one field on
one step, re-run only that step + downstream") is unworkable
without it.**

What we have today vs what's needed:

- **Today:** `saifctl run resume` resumes a paused / failed run from
  the last completed *subtask*. That's per-subtask resume — phase-
  internal granularity. Good for orchestrator crashes and
  pause/stop, not designed for "the user changed step 3's spec
  after step 2 succeeded."
- **What Mode 3 needs:** **step-level resume** — given an existing
  run record and a workflow edit (one step's spec / tests / config
  changed), resume by:
  1. Identifying which step changed (content-hash diff).
  2. Reusing the previous run's outputs for upstream steps that
     haven't changed (workspace snapshot at that boundary).
  3. Replaying only the changed step + any downstream steps whose
     transitive inputs are dirty.
  4. Pinning a fresh `runId` but linking back to the parent run for
     audit / cost attribution.

Why this is non-trivial:
- Workspace snapshots between every step boundary need to persist
  across runs, not just within a run. (§5.2 of [vision.md](./vision.md)
  mentions content-addressed S3 storage — this is when it matters.)
- Determinism boundary: which fields, when changed, invalidate
  downstream? `spec.md` content yes; `tests/` yes; `agent.model`
  yes (different LLM, different output); `metadata.labels` no.
- Cost expectations: users will assume "I changed one field, only
  pay for one step's re-run." Get this wrong and the bill surprise
  is the same shape as Replit's backlash.

When it ships:
- **Phase 3b** at the latest. It's part of what makes the web app
  feel real instead of toy. Earlier is better.
- **Could ship in Phase 2** as a CLI feature (`saifctl workflow
  resume <runId> --from-step <stepId>`) once the per-step workspace
  snapshot infrastructure is in place. Lean: defer to 3b unless a
  CLI user asks for it; the architecture is the same either way.

Implementation hooks:
- The DAG executor (Phase 2) already has to track per-step
  workspace artefacts to ferry them between phases. Persist them
  beyond the run boundary instead of cleaning up at run-end. Cost:
  storage growth + a TTL policy.
- Run records get a `parentRunId?` field for resume lineage.
- CLI / web both expose a "re-run from here" action that picks the
  earliest dirty step and inherits the rest.
- Resume validity gets a content-hash comparison: each step's
  resolved config hashes; the cache hits when hashes match.

Open question parked here for the build phase: what *exactly* gets
cached — workspace tarball at the step boundary, or the workspace
plus the agent's reasoning trace, or also the gate / test outputs?
Lean: workspace + structured run-record metadata; not the raw
reasoning trace (too big, low reuse). Decided when Phase 3b
designs its storage layer.

---

## 11. Cross-references

- [Vision](./vision.md) — the north star this product realises.
- [Competitive landscape](./competitive-landscape.md) — who else is
  in this space; gap analysis.
- [Exploration plan](./exploration-plan.md) — hypotheses and tests;
  this doc adds **H16** (non-engineer description quality) implicitly,
  to be added there next.
- [Per-phase config design](../per-phase-config/design.md) — the
  Phase 1 work that everything here builds on.
- [RFC #74](https://github.com/safe-ai-factory/saifctl/issues/74) —
  the original issue framing Parts 1 (per-phase config), 2
  (workflow layer), 3 (SaaS productisation). This doc maps Parts
  2 + 3 in detail.
