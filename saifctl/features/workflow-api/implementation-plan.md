# Workflow API — implementation plan (v1)

> Sister doc to [`workflow-api.md`](./workflow-api.md). Captures the
> **build sequence** to ship v1 of the workflow API as documented
> in the spec. Last updated 2026-05-13.
>
> Source-of-truth for the *what* is `workflow-api.md`. This doc
> answers *how* / *when* / *in what order*. When the spec evolves
> (open items still being resolved in §15), this doc gets updated
> in step.
>
> Scope unit: **one week of focused single-developer work** per
> chunk. Blocks that exceed a week are subdivided. Parallelism
> opportunities are called out explicitly so a multi-person team
> can compress the timeline.

---

## 1. High-level picture

### 1.1 Block list

| # | Block | Weeks | Parallelisable with |
|---|---|---|---|
| 0 | Pre-implementation: build-vs-reuse audit + dev setup | 1 | — |
| 1 | Foundations: Workflow Zod schema, CEL, interpolation, predicate eval | 4 | — |
| 2 | Authoring surfaces: YAML loader + TS SDK + Python SDK | 3 | 3 / 4 / 7 |
| 3 | Run model + step lifecycle | 2 | 4 / 7 |
| 4 | Downloader infrastructure: image + binary + source types | 4 | 2 / 3 / 7 |
| 5 | Host-side downloader orchestration | 2 | 7 |
| 6 | Workflow inputs | 2 | 7 |
| 7 | Sinks | 2 | 2 / 3 / 4 / 5 |
| 8 | Step-level sources | 1 | — |
| 9 | Subworkflows + workflow outputs | 2 | — |
| 10 | Spec-text mitigations + secret-ref validator | 1 | 4 / 7 |
| 11 | CLI commands + `feat run` refactor | 2 | — |
| 12 | Migration + saifdocs update | 2 | — |
| 13 | Test coverage + bug-bash + polish | 2 | — |
| **Total** | | **30** (serial) / **~18** (with parallelism) | |

### 1.2 Critical path (serial only)

```
0 → 1 → 4 → 5 → 11 → 12 → 13
```

Block 1 (foundations) gates everything because schema + CEL +
interpolation are foundational. Block 4 (downloader) + Block 5
(host-side orchestration) form the next bottleneck — they're the
substantial new infrastructure. Block 11 (CLI) is the user-facing
capstone — has to land after the substrate is solid.

### 1.3 What can run in parallel

After Block 1 lands:
- Block 2 (SDKs) → independent of runtime work; can ship before
  the engine is wired.
- Block 3 (run model) → depends on schema only; parallel with
  Block 4 if Block 1 is done.
- Block 4 (downloader image + binary) → can start once schema is
  stable (mid-Block-1); image build is mostly Dockerfile work.
- Block 7 (sinks) → independent of source resolution; can run in
  parallel with Block 4/5/6.

A 2-person team running Block 4/5/7 in parallel after Block 1 +
Block 2 in parallel with Block 4 cuts the critical path roughly
in half.

### 1.4 Dependency graph

```
                    [0] Pre-impl
                         │
                         ▼
                    [1] Foundations
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
    [2] SDKs       [3] Run model    [4] Downloader image + binary
        │                │                │
        │                │                ▼
        │                │           [5] Host-side orchestration
        │                │                │
        │                │                ├──► [6] Inputs
        │                │                │       │
        │                │                │       ▼
        │                │                │   [8] Step-level sources
        │                │                │       │
        │                │                │       ▼
        │                │                │   [9] Subworkflows + outputs
        │                │                │       │
        │                ▼                ▼       ▼
        │           [7] Sinks ────────────────────┤
        │                │                        │
        │                ▼                        ▼
        │           [10] Spec mitigations + validator
        │                │
        └────────────────┴────► [11] CLI ────► [12] Migration ────► [13] Test pass
```

### 1.5 Out of scope for this plan

Items the spec defers explicitly:

- **`for:` loops** (§13.2; spike §15.17 of v1.x).
- **Inline named `group:`** (§13.2).
- **Parallelism / multi-step concurrency** (§13.2; spike §14.1).
- **Triggers (cron / webhook)** (§13.2; design questions in §14.7).
- **Resource budgets** (§13.2; §14.8).
- **Observability primitives** (§13.2; §14.10).
- **HITL approval steps** (§13.2; §14.11).
- **Resume-from-specific-step CLI** (§13.2; §15.20 — design
  resolved). The eight `RunArtifact` schema additions
  enumerated in §15.20 of workflow-api.md
  (`RunArtifact.workflow`, `RunCommit.originatingSubtaskId`,
  `RunArtifact.inputs?`, `RunArtifact.workflowOutputs?`,
  `RunSubtask.exportsCapture?`, `RunArtifact.sourceState[]`,
  `RunArtifact.sinkState[]`, `RunSubtask.contentHash`) DO ship
  in v1 as forward-compatible groundwork — spread across Block
  3.2 (six fields), Block 6 (`RunArtifact.inputs?`), and
  Block 9 (`RunArtifact.workflowOutputs?`). The `--resume-from
  <runId>:<stepId>` CLI itself, plus hash-and-warn validation
  and `runCommits` truncation, are v1.x work on top of the v1
  schema.
- **Container snapshotting (CRIU / podman checkpoint)** (§13.2;
  §15.21 — **v2**, alongside Mode 4 cloud control-plane
  execution; NOT v1.x). The git-commit-delta filesystem
  snapshot model (already in saifctl's `RunArtifact`) is
  sufficient for §15.20 resume; CRIU is an orthogonal
  optimisation for live container migration in cloud fleets.
  Cheaper "snappiness" alternatives (long-lived coder
  container per run, pre-warm pool, tarball snapshots
  alongside `runCommits`) noted in §15.21 are also out of v1
  scope.
- **Sink-resolution symmetry / egress container** (§14.20 — closed
  for v1).
- **Saifctl-internal `phase` → `step` rename** (§10.6 / §15.18 —
  separate work-package). Block 12 handles the *on-disk* rename
  (directory + file names); the *code-symbol* rename ships
  separately.

These should not be implemented as part of v1 even if they look
adjacent. Future plan revisions add them as their own blocks.

### 1.5.1 Terminology — "phase" vs "step"

Two terms appear in this doc that point at related-but-distinct
concepts:

- **"phase"** — existing saifctl internals: `compilePhasesToSubtasks`,
  the per-phase config from Phase 1, `runIterativeLoop`, `phaseId`
  on `RunSubtask`. Stays unchanged in v1.
- **"step"** — the new workflow-API concept (§6.1):
  leaf / if-wrapper / external-subworkflow nodes inside a
  workflow.

The two are mechanically related — each leaf step compiles to
one or more subtasks driven by the existing phase loop — but
the surface vocabulary differs. The on-disk `phases/` →
`steps/` rename lands in Block 12 (Migration); the code-symbol
rename (`phaseId` → `stepId`, etc.) ships separately per §10.6
/ §15.18, NOT as part of this plan. When in doubt: spec
talks about "steps" externally, code still calls them "phases"
internally.

### 1.5.2 §15 resolution coverage

Every ✅ section in workflow-api.md §15 should be either
referenced by a Block scope item or noted as not needing one.
Audit summary (as of the doc date above):

- §15.4, §15.5, §15.6, §15.7, §15.11, §15.16 — copy-edit /
  small-design resolutions absorbed by Block 1.1 schema work;
  no separate plan entry.
- §15.8 — per-integration security catalogue → consumed by
  Block 4 (sources) + Block 7 (sinks) implementation choices.
- §15.9 — auth and secrets → Block 1.1 (per-type credential
  fields + `sensitive: true` metadata on every source / sink
  schema) + Block 4 (per-source secret injection on the
  downloader) + Block 5.1 (tmpfs mount at `/saifctl/secrets/`
  + `docker cp` of `inputs.json` into the running container) +
  Block 6.2 (input-secret ↔ agent-secret scope split with
  explicit `{{inputs.<name>}}` bridge) + Block 7 (sink-side
  CLI-host secrets per §14.20 close) + Block 10 (secret-ref
  AST walker; hard-block in `spec:`, warn elsewhere).
- §15.10 — CEL model catalogue → Block 1.2 + Block 3.2 +
  Block 7.2.
- §15.12 — workflow outputs → Block 9.2.
- §15.13 — non-JSON exports → out of scope (rejected; not
  deferred — see §15.13 resolution: files / dirs pass as path
  / URL strings via sources + sinks, no typed `file` / `dir`
  export).
- §15.14 — `runner` → `test` rename → Block 1.1 schema +
  Block 12 migration.
- §15.15 — test definition scope + cumulative scope →
  Block 1.1 schema + Block 6.3 test-writer + Block 13.1 e2e.
- §15.17 — interpolation engine → Block 1.3.
- §15.18 — internal phase→step rename → out of scope (see
  §1.5).
- §15.19 — workflow file as sole source of truth → Block 11.2
  / Block 12.
- §15.20 — resume from a specific step → groundwork in Block
  3.2 / Block 6 / Block 9; CLI itself deferred to v1.x.
- §15.22 — §10 (migration) rewrite → consumed by Block 12.
- §15.24 — workflow inputs → Block 6.
- §15.25 — interpolation across the workflow → Block 1.3 +
  Block 10.
- §15.26 — single-file archive unpacking → Block 4.4.
- §15.27 — step-level sinks → Block 1.1 (`flatten-step-sinks.ts`).
- §15.28 — workflow schema canonical JSON → Block 1.1 (Zod
  source-of-truth) + Block 2 (loaders / SDKs) + Block 0.3
  (JSON Schema first draft).

Open spike: ~~§15.23 (build vs reuse audit) — Block 0~~. **Resolved
inline in workflow-api.md §15.23 across Refreshes 1–6 (2026-05-13);
Block 0.1 task to re-export as a contributing-docs article was
skipped — see Block 0.1 table row below.**

---

## 2. Spike track (parallel, informs but doesn't block)

One spike from §15 should resolve **before** v1 implementation
starts in earnest. Runs in the background of Block 0.

| Spike | Why before v1 | When to resolve by |
|---|---|---|
| §15.23 Build vs reuse audit | Informs library choices in Block 1 (cel-js vs alternatives — already pinned per §15.17), Block 4 (Alpine vs distroless, aws-cli vs SDK), Block 7 (sink library choices). | Block 0 |

**§15.10 Source / sink CEL field sets is no longer a spike** —
fully resolved in workflow-api.md §15.10 (2026-05-12). The CEL
model catalogue is locked end-to-end, including all
`sources.<id>.<field>` and `sinks.<id>.<field>` fields with their
state machines and timing semantics. Block 1.2's CEL Environment
registers them all directly from the locked catalogue; no
placeholder pending.

**§15.20 Resume from step is no longer a spike** — it's
resolved design (workflow-api.md §15.20). The eight
`RunArtifact` schema additions enumerated there ship as part of
v1 (forward-compatible groundwork): `RunArtifact.workflow`,
`RunCommit.originatingSubtaskId`, `RunSubtask.exportsCapture?`,
`RunArtifact.sourceState[]`, `RunArtifact.sinkState[]`, and
`RunSubtask.contentHash` land in Block 3.2; `RunArtifact.inputs?`
in Block 6; `RunArtifact.workflowOutputs?` in Block 9. The
`--resume-from <runId>:<stepId>` CLI itself, plus hash-and-warn
validation and `runCommits` truncation, are v1.x work on top of
the v1 schema.

Two further items don't block v1 and are tracked for v1.x or v2:

- **§15.21 Container snapshotting — v2, NOT v1.x.** The
  git-commit-delta filesystem snapshot model (already in
  saifctl's `RunArtifact`) is sufficient for §15.20 resume;
  CRIU/podman checkpoints solve a different problem (live
  container migration between workers in Mode 4 cloud
  control-plane execution) plus a wall-clock improvement on
  resume. The cheaper "snappiness" alternatives in §15.21 of
  workflow-api.md (long-lived coder container per run,
  pre-warm pool, pre-rendered tarball snapshots alongside
  `runCommits`) are also v1.x+ work, not v1. Block 3.2 doesn't
  do anything special to "prep" for CRIU — the schema
  additions there serve §15.20 directly, not CRIU.
- **§15.26 Remote archive unpacking is no longer a spike** —
  resolved 2026-05-12 (workflow-api.md §15.26 ✅). v1 ships
  `unpack: false | auto | zip | tar | tgz | gz` across all
  single-file source types (`http`, single-object
  `s3` / `gcs` / `r2`, `local` over a file). The default
  remains `unpack: false`; users opt in per source. Block 4.4
  implements the full unpack pipeline (`bsdtar` with
  secure-extraction flags, `auto`-detect via libarchive
  content sniff, `maxUnpackedSize:` cap, four-class error
  catalogue). What IS deferred to v1.x is the additional
  format set `tar.bz2 | tar.xz | 7z | bz2 | xz` — not the
  feature as a whole.

---

## 3. Block 0 — Pre-implementation (1 week)

**Goal:** lock library choices and dev infrastructure before
material code lands.

### 3.1 Tasks

| # | Task | Output |
|---|---|---|
| 0.1 | ~~Build-vs-reuse audit (§15.23) — formal table per subsystem~~ — **SKIPPED (2026-05-13).** §15.23's Refresh 1–6 already captured every per-subsystem rationale inline in workflow-api.md; reformatting into a separate `docs/contributing/architecture/` article would just re-export the same content in a less authoritative location. The dependency-table-with-rationale that *would* fit `docs/contributing/` is out of scope for v1. Block 0.2 below carries the per-dep rationale via inline links to the §15.23 refresh entries that locked each pick. | (none) |
| 0.2 | Pin v1 dependencies: **`@marcbachmann/cel-js` v7.6.1+** (locked per §15.17 verification), **`graphology` + `graphology-dag`** (shared DAG primitive — step DAG validation, sink DAG cycle detection, subworkflow DAG; locked per §15.23 E23 Refresh 3), **`object-hash`** (workflow-hash validation for §15.20 resume; locked per §15.23 A3 Refresh 3), **`@sigstore/verify`** (cosign keyless signature verification of the downloader image at saifctl-host pre-launch; locked per §15.23 F26 Refresh 5), archive libs (later), HTTP clients, AWS / GCS / R2 SDKs vs CLIs | Update to `package.json` + ADR in saifctl docs |
| 0.3 | **Zod schema sketch** — minimal-but-shaped Zod schema covering the workflow top-level + 1–2 source types + 1–2 sink types + 1 step-kind. Per §15.23 H35 Refresh 6: Zod is the canonical source of truth (NOT a hand-drafted JSON Schema). This task front-loads the Zod authoring pattern that Block 1.1 uses at full scale and produces `workflow-schema.json` as a `zod-to-json-schema` side-effect (NOT as a hand-drafted artifact). Validates the canonical-shape decisions before Block 1.1's full implementation. | `src/specs/workflow/schema.sketch.ts` (Zod) + `workflow-schema.json` (derived; replaced wholesale once Block 1.1's full Zod ships) |
| 0.4 | Pick secret-injection mechanism for downloader tmpfs per §5.6.8 — `docker cp` vs `docker exec ... > file` vs alternatives. Run a smoke test of each option on macOS Docker Desktop + Linux Docker daemon; pick the one with the cleaner failure modes (atomic write, no leak via inspect, no race vs container start). | ADR in saifctl docs; decision pinned for Block 5.1 |
| 0.5 | **Pydantic codegen — discriminator round-trip smoke test.** Tool picked per §15.23 B7 (Refresh 3): **`datamodel-code-generator`** with `pydantic_v2.BaseModel` + `--snake-case-field` + `--use-discriminator-of-union` + `--use-annotated`. This Block 0 task is the verification spike — run the full chain (Zod `discriminatedUnion` → `zod-to-json-schema` → `workflow-schema.json` → `datamodel-codegen` → Pydantic) against the Block 0.3 Zod sketch and confirm: (a) source-type / sink-type / step-kind discriminators round-trip cleanly as `Annotated[Union[...], Field(discriminator='type')]`; (b) recursive subworkflow refs land as Pydantic forward refs with `model_rebuild()` calls in the generated `__init__.py`; (c) camelCase JSON ↔ snake_case Python alias round-trips; (d) **custom-keyword preservation per §15.23 H35 Refresh 6** — `description` (from Zod `.describe()`), `examples` arrays, and the custom **`x-saifctl-sensitive: true`** keyword on per-type credential fields (per §5.3) all survive Zod → JSON Schema and remain visible in the generated Pydantic (as field metadata or `Annotated` metadata). If any metadata is dropped anywhere in the chain, capture the gap; the fallback is a ~30 LOC post-processor that injects missing annotations during the saifctl build (cheap mitigation, NOT a tool reselection). | ADR in saifctl docs with the smoke-test fixtures attached; tool + flag set + custom-keyword approach pinned for Block 2.3 |
| 0.6 | Pick container registry target for the downloader image per §5.6.8 (publish location, digest-distribution mechanism, public read vs auth-only) **AND lock cosign keyless signing identity + SLSA L3 provenance verification policy per §15.23 F26 Refresh 5** (signer identity = the saifctl release workflow's OIDC subject; verification policy = `--certificate-identity-regexp` + `--certificate-oidc-issuer https://token.actions.githubusercontent.com`; Rekor instance pinned to `rekor.sigstore.dev`). Output: registry choice + pull strategy + signing/verification policy. | ADR in saifctl docs; decision pinned for Block 4.1 |

No feature-flag gating. Per §10.5 ("no migration tool, no compat
loader, no v1-vs-v2") the implementation goes directly into trunk
as blocks complete; existing `feature.yml` / `phase.yml` features
get updated in place in Block 12. No legacy code path to preserve;
no env-var dispatch shim to maintain.

### 3.2 Acceptance

- ~~Build-vs-reuse table reviewed and merged.~~ Task 0.1
  skipped — §15.23 Refreshes 1–6 in workflow-api.md are the
  authoritative roster.
- `@marcbachmann/cel-js` v7.6.1+ installed; smoke tests
  exercise each row of the §15.17 verification table
  (arithmetic, comparison, logical, conditional, membership,
  indexing list + map, `has` / `size` / `string` / `int` /
  `double` / `dyn`, `all` / `exists` / `filter`, custom
  function registration, parse-error column reporting,
  type-check via `env.check()`).
- Block 0.3's Zod sketch + derived JSON Schema parses (with
  any JSON Schema validator) for at least three hand-written
  sample workflows from §11 of workflow-api.md that fit within
  the sketch's coverage (top-level + the 1–2 source/sink types
  the sketch covers).
- Secret-injection mechanism decision (task 0.4) documented as
  an ADR with the cross-platform smoke-test results attached;
  Block 5.1 references the ADR rather than re-litigating.
- Pydantic codegen smoke test (task 0.5) passes for the
  full Zod → JSON Schema → Pydantic chain on the partial 0.3
  schema; ADR documents the flag set and any fallback
  post-processor needed. Block 2.3 consumes the pinned tool +
  flags directly.
- Downloader image registry target (task 0.6) chosen and
  documented; Block 4.1 push pipeline references the ADR.

### 3.3 Files / paths touched

- `package.json` — new deps (Block 0.2).
- `saifctl/features/workflow-api/workflow-schema.json`
  — new (Block 0.3, derived from the Zod sketch).
- `saifctl/features/workflow-api/workflow-fixtures/*.workflow.json`
  — new (Block 0.3, three canonical-JSON sample workflows).
- `saifctl/features/workflow-api/block-0-pydantic-smoke/`
  — new (Block 0.5 codegen output + smoke-test runner).
- `src/specs/workflow/schema.sketch.ts` — new (Block 0.3 Zod
  sketch; full schema lands in Block 1.1).
- `src/specs/workflow/schema.sketch.test.ts` — new (Block 0.3
  Zod round-trip test against the fixtures).
- `saifctl/features/workflow-api/derive-workflow-schema.ts` — new (build step that
  runs `zod-to-json-schema` against `schema.sketch.ts`, injects
  the OpenAPI-style `discriminator:` annotation for source /
  sink unions, lifts the `@saifctl:sensitive` describe-tag to
  the `x-saifctl-sensitive: true` keyword, and writes
  `workflow-schema.json`; the post-processor mitigation lives
  here per Block 0.5 outcome and carries forward into Block 1.1).

### 3.4 Outcomes (2026-05-13)

#### 3.4.1 Task 0.1 — skipped

See the §3.1 task table row. §15.23 Refreshes 1–6 of
[`workflow-api.md`](./workflow-api.md) are the authoritative
build-vs-reuse roster; the planned contributing-docs article
would just re-export them in a less authoritative location.
The per-dep rationale that *would* fit `docs/contributing/`
(a dependency table) is out of v1 scope.

#### 3.4.2 Task 0.2 — v1 deps pinned

Added to [`package.json`](../../../package.json) (versions are
minimum-pinned with `^` — Renovate manages drift):

| Dep | Version | Role | Rationale anchor |
|---|---|---|---|
| `@marcbachmann/cel-js` | `^7.6.1` | CEL evaluator | workflow-api.md §15.17 + §15.23 B5 |
| `graphology` | `^0.26.0` | Shared DAG primitive (step / sink / subworkflow) | §15.23 E23 Refresh 3 |
| `graphology-dag` | `^0.4.1` | Cycle detection over `graphology` | §15.23 E23 Refresh 3 |
| `graphology-traversal` | `^0.3.1` | BFS for Block 1.4 reachability validator | §15.23 E23 Refresh 3 |
| `object-hash` | `^3.0.0` | Workflow-hash validation (§15.20 forward-compat) | §15.23 A3 Refresh 3 |
| `@sigstore/verify` | `^3.1.0` | Cosign keyless verification of the downloader image | §15.23 F26 Refresh 5 |
| `zod-to-json-schema` *(dev)* | `^3.25.2` | Zod → JSON Schema derivation | §15.28 point 6 / §15.23 H35 Refresh 6 |
| `@types/object-hash` *(dev)* | `^3.0.6` | Types for `object-hash` | — |

Deferred (still listed in task 0.2 description but NOT v1
ship): archive libs (Block 4.4), HTTP clients (Block 4.3),
AWS / GCS / R2 SDKs vs CLIs (Block 4.2 / 4.4 + Block 7.2).
Those pin during their owning blocks rather than up front,
since the build-vs-reuse rationale already locked them inline
in §15.8 + §15.23 (D11–D16, E17–E22) — pinning them now would
freeze versions before the consuming code exists to check
them against.

#### 3.4.3 Task 0.3 — Zod schema sketch + derived JSON Schema

**Sketch coverage** at
[`src/specs/workflow/schema.sketch.ts`](../../../src/specs/workflow/schema.sketch.ts):
workflow top-level (`schemaVersion: 1`, `metadata`, `inputs`,
`sources`, `steps`, `sinks`) + 2 source types (`github` /
`s3`) + 2 sink types (`s3` / `email`) + 1 leaf step kind.
Discriminated unions on `type:` per §15.28 point 3.
**Out-of-scope for the sketch (lands in Block 1.1):** `defaults`
block, workflow `outputs`, if-wrapper + subworkflow step
kinds, step-level sources / sinks, `tests:` block, all
remaining source / sink types, the full input-type catalogue,
and every §15.8 schema-level security validator.

**Custom-keyword preservation pattern.** `sensitive(...)` in the
sketch tags a Zod schema with a leading `@saifctl:sensitive`
prefix on its description. The derive script's `liftSensitiveTag`
post-pass strips the prefix and lifts it to the JSON-Schema
custom keyword `x-saifctl-sensitive: true`. Pattern carries
forward into Block 1.1's full schema — same `sensitive()` helper,
same derive-time lift.

**Discriminator-handling post-pass.** `zod-to-json-schema` emits
`z.discriminatedUnion` as plain `anyOf` with no
OpenAPI-style annotation. The derive script's
`injectDiscriminators` walks every `anyOf` whose members all
share a `type: { const: '<lit>' }` shape, converts to `oneOf`,
and adds `discriminator: { propertyName: 'type' }`. This is the
~30 LOC fallback post-processor the task 0.5 description
flags — implemented up-front in Block 0.3 so Block 0.5 can
verify it end-to-end. Unknown-keyword tolerance: standard
JSON-Schema validators (ajv, etc.) ignore the `discriminator`
keyword silently; datamodel-codegen reads it.

**Derived artifact** at
[`saifctl/features/workflow-api/workflow-schema.json`](./workflow-schema.json).
Rebuild via `pnpm tsx saifctl/features/workflow-api/derive-workflow-schema.ts`.
Regeneration is **not** wired into `pnpm build` yet — that
lands in Block 1.1 / 2.2 alongside the SDK package build.

**Fixtures.** Three canonical-JSON workflows under
[`workflow-fixtures/`](./workflow-fixtures/):
`minimal.workflow.json` (top-level only), `sources.workflow.json`
(both source types), `sinks.workflow.json` (both sink types).
Block 0.3 round-trips them via Zod (vitest); Block 0.5
round-trips the same files via Pydantic.

**Acceptance evidence.** `pnpm vitest run
src/specs/workflow/schema.sketch.test.ts` passes — 6 tests
across the 3 fixtures plus negative cases (unknown top-level
key, invalid source `type:` discriminator).

#### 3.4.4 Task 0.4 — secret-injection mechanism: `docker create` + `docker cp`

**Decision: `docker cp` to a created-but-not-yet-started
container.** Pre-launch sequence:

1. `docker create --mount type=tmpfs,destination=/saifctl/secrets,tmpfs-size=4m,tmpfs-mode=0700 ...`
2. `docker cp <inputs.json> <containerId>:/saifctl/secrets/inputs.json` (writes
   the JSON from saifctl-host memory directly into the
   container's tmpfs; never touches the host disk).
3. `docker start <containerId>` (downloader process starts
   only AFTER the secrets file is in place; no TOCTOU window
   between container start and secret arrival).

**Why over `docker exec ... > file`:**

| Property | `docker cp` (created, not started) | `docker exec ... > file` (running) |
|---|---|---|
| Container must be running | No — `create` → `cp` → `start` | Yes — must `start` first, race with downloader entrypoint |
| Atomic from downloader's POV | Yes — file is present at start(2) | No — file appears mid-process; needs entrypoint-side polling or sleep |
| Shell quoting / escaping | None — raw bytes via API | Required — JSON value flows through `sh -c` |
| Failure modes | One: copy error (cleanly surfaces) | Two: exec error OR partial-write on broken pipe |
| `docker inspect` visibility | No env-var or arg-string trace | No env-var trace (same as `docker cp`) |
| Cross-platform (Linux + Docker Desktop) | Identical semantics | Identical semantics |

**Implementation note for Block 5.1.** The dockerode wrapper
in [`src/utils/docker.ts`](../../../src/utils/docker.ts) needs a
`putArchive`-shaped helper (dockerode exposes `container.putArchive`
which IS `docker cp`'s underlying API). Block 5.1 implements
the tmpfs-mount + secrets-file write as a single sequence;
the Block 0.4 decision means no `docker exec` shell-out
pattern in that code path.

**Smoke-test gap.** Block 0 did not run a cross-platform Docker
binary-level smoke test because the downloader image doesn't
exist yet (Block 4.1) — a smoke test today would only validate
`docker cp` against a stock Alpine image, not the saifctl
downloader. Block 5.1 lands the full cross-platform smoke
test as part of its acceptance work, validating the decision
on macOS Docker Desktop + Linux Docker daemon + Docker
Desktop on Windows. If the smoke test surfaces a failure
mode not covered by the rationale table above, Block 5.1
reopens the choice with the documented fallback (`docker
exec ... > file` with a `flock`-protected entrypoint).

#### 3.4.5 Task 0.5 — Pydantic codegen smoke test

**Tool + flag set pinned for Block 2.3:**

```
datamodel-code-generator (v0.57.0+)
  --input <workflow-schema.json>
  --input-file-type jsonschema
  --output-model-type pydantic_v2.BaseModel
  --snake-case-field
  --use-annotated
  --use-union-operator
  --target-python-version 3.12
  --field-extra-keys x-saifctl-sensitive
  --field-include-all-keys
```

`--use-discriminator-of-union` (named in the original task
description) was renamed / removed in datamodel-codegen v0.30+;
the v0.57.0 successor is "auto-detect from `discriminator:`
keyword in the input JSON Schema." Block 0.3's
`injectDiscriminators` post-pass plants the annotation that
makes auto-detection fire — without it the codegen emits
plain `Sources1 | Sources2` (works under Pydantic v2 smart-
union but worse error messages and no compile-time
exhaustiveness).

**Smoke-test outputs** captured at
[`saifctl/features/workflow-api/block-0-pydantic-smoke/`](./block-0-pydantic-smoke/):
the generated Pydantic models (`workflow_schema.py`) + the
smoke-test runner (`smoke_test.py`) that round-trips the
three Block 0.3 fixtures through `Workflow.model_validate(...)`.

**Reproduce:**

```bash
# 1. Derive JSON Schema from Zod sketch
pnpm tsx saifctl/features/workflow-api/derive-workflow-schema.ts

# 2. Generate Pydantic models
uv tool run --from datamodel-code-generator datamodel-codegen \
  --input saifctl/features/workflow-api/workflow-schema.json \
  --input-file-type jsonschema \
  --output saifctl/features/workflow-api/block-0-pydantic-smoke/workflow_schema.py \
  --output-model-type pydantic_v2.BaseModel \
  --snake-case-field --use-annotated --use-union-operator \
  --target-python-version 3.12 \
  --field-extra-keys x-saifctl-sensitive \
  --field-include-all-keys

# 3. Run the round-trip
cd saifctl/features/workflow-api/block-0-pydantic-smoke
uv run --with pydantic python smoke_test.py
```

**Acceptance results — each criterion from §3.1 task 0.5:**

| Criterion | Result | Evidence |
|---|---|---|
| (a) Source / sink / step-kind discriminators round-trip as `Annotated[Union[...], Field(discriminator='type')]` | **Pass for sources / sinks**; step-kind not exercised (sketch only includes leaf — verifies in Block 1.1) | `workflow_schema.py` lines 154 (`Sources`) + 232 (`Sinks`) emit `Field(discriminator='type')` |
| (b) Recursive subworkflow refs land as Pydantic forward refs with `model_rebuild()` | **Not exercised** — sketch doesn't include subworkflow steps (deferred to Block 1.1) | n/a; flag for Block 1.1 acceptance |
| (c) camelCase JSON ↔ snake_case Python alias round-trips | **Pass** | `save_as: Annotated[str, Field(alias='saveAs', ...)]`; `Workflow.model_dump(by_alias=True)` re-emits the original camelCase shape; smoke test verifies all 3 fixtures' keys appear in the emit |
| (d) `description` + `examples` + `x-saifctl-sensitive` survive Zod → JSON Schema → Pydantic | **Pass for `description` + `x-saifctl-sensitive`**; `examples` not exercised (sketch uses no `.describe()` examples — Block 1.1 add) | `Field(json_schema_extra={'x-saifctl-sensitive': True})` lands on all 6 credential fields across the 3 fixtures (smoke test asserts the count) |

**Gaps documented for Block 1.1 / 2.3:**

- Subworkflow forward-ref behavior (b) needs verification once
  the if-wrapper + subworkflow Zod schemas land. The expected
  shape is a `RootModel` with `model_rebuild()` in the
  generated `__init__.py`; if datamodel-codegen drops the
  rebuild, the same post-pass pattern (post-process the
  generated Python) ships in Block 2.3's SDK build script.
- `examples` (d-partial): Zod's `.describe()` doesn't carry an
  examples array; the path forward is the Zod-ecosystem
  `.openapi({ examples: [...] })` extension (via
  `zod-openapi` or hand-walked) — pin in Block 1.1.

#### 3.4.6 Task 0.6 — downloader registry + cosign verification policy

**Registry: GitHub Container Registry (`ghcr.io`).** Image
identity: `ghcr.io/safe-ai-factory/saifctl-downloader:<saifctl-version>`,
pinned **by digest** in the saifctl release manifest
(per §5.6.6 / §5.6.8). Public read; auth-only push from the
release workflow. Picked over Docker Hub (slower digest
immutability story, no OIDC-keyless flow), AWS ECR Public
(extra account hop for the OSS project), and a self-hosted
registry (operational burden).

**Digest distribution.** Digest embeds in saifctl's
`package.json` under a new top-level `saifctlDownloaderImage`
field (lands in Block 4.1). Saifctl on the host reads it
pre-launch and passes it to dockerode as the immutable image
reference (`<repo>@sha256:<digest>`), never the tag.

**Pull strategy.** First saifctl run: `docker pull` against
the digest. Subsequent runs: local cache hit (Docker engine
caches by digest). No tag fallback — if the digest is
unavailable (Docker Hub mirror outage etc.), surface the
error to the user with the registry URL printed for manual
mirror configuration.

**Cosign keyless signing identity** (per §15.23 F26
Refresh 5):

```
--certificate-identity-regexp \
  '^https://github.com/safe-ai-factory/saifctl/\.github/workflows/release\.yml@refs/tags/v.*$'
--certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Rekor instance: `rekor.sigstore.dev` (public). SLSA L3
provenance attestation produced by the same release workflow;
saifctl host verifies via `@sigstore/verify` (the Block 0.2
runtime dep) before container launch.

**Soft-fail-warn gating for v1.0** (per §15.23 F26 Refresh 5):
verification failure logs a `WARN` and proceeds; v1.x flips to
hard-fail once the release pipeline runs cleanly through
several releases. Hard-fail gate decision criteria:
≥3 consecutive release cycles with green Rekor + Fulcio +
attestation lookups across all supported saifctl versions.

**Implementation owners:** Block 4.1 builds + pushes the
downloader image and adds the GHA workflow (`release.yml`)
that produces the cosign + SLSA attestations.
Block 5.1 wires `@sigstore/verify` into the pre-launch path
(soft-fail-warn). Block 13.1 adds the regression fixtures
(rotated-digest reject, missing-signature reject when hard-fail
flips in v1.x).

---

## 4. Block 1 — Foundations (4 weeks)

**Goal:** the building blocks every later block depends on.

### 4.1 Week 1.1 — Workflow Zod schema

**Scope:**
- Top-level workflow schema: `schemaVersion`, `metadata`,
  `defaults`, `inputs`, `sources`, `steps`, `sinks`, `outputs`
  per §4 + §15.24 + §15.12 + §15.28. (`kind` and
  `apiVersion: saifctl.dev/v1` dropped per §15.28 resolution —
  `schemaVersion: 1` is the only versioning field.)
- **`metadata:` block schema.** `name` (required string),
  `description?` (string), `labels?` (map of string→string),
  `annotations?` (map of string→string). `labels.<key>` and
  `annotations.<key>` are first-class CEL refs per §15.10;
  schema accepts arbitrary keys but Block 1.2 registers them
  for CEL lookup via bracket notation.
- **`defaults:` block schema.** Workflow-level defaults for the
  per-step config surface — `gate` / `agent` / `container` /
  `test` / `limits` sub-blocks, each mirroring the Phase 1
  per-phase-config shape (reuses `src/specs/phases/schema.ts`
  sub-schemas where possible — Block 0 audit confirms reuse
  scope). Merge order at step-execution time (§6.6): step
  `config:` > workflow `defaults:` > project defaults > built-
  in. Each sub-key resolves independently (object-valued) or
  replaces (list-valued). `defaults.test.profile` is the
  authoritative profile resolver consumed by the
  profile-required validator below.
- **`agent.options` pre-shipped** (2026-05-14). The agent
  block of `agentConfigSchema` accepts an `options` map
  (`Record<string, string | number | boolean>`) of
  agent-profile-specific option overrides — already wired
  end-to-end pre-Block-1.1: `resolveAgent` merges by key
  across the inheritance chain, `compile.ts` resolves into
  `RunSubtaskInput.agentProfileOptions`, and the per-subtask
  env file (`src/orchestrator/per-subtask-env.ts` step 6)
  emits `SAIFCTL_AGENT_OPT_<ID>_<NAME>=value` for the active
  subtask. Block 1.1 inherits this for the workflow's
  `defaults.agent.options` AND step-level `config.agent.options`
  with no schema-side work — same `agentConfigSchema` import.
  Run-wide flow lands at container startup via
  `wireAgentProfileOptions` (CLI > feature.yml `agent.options`
  > `defaults.agentOptions.<id>` in saifctl/config.ts > profile
  default). **Known limitation:** cross-phase shadow-keys on
  the `SAIFCTL_AGENT_OPT_*` prefix isn't shipped; run-wide /
  feature-level usage is correct, but per-phase overrides may
  bleed into adjacent phases that don't override the same key.
  Tracked as a follow-up.
- **Lockstep validators (per-phase config §6.9 / spec §9).**
  The existing per-phase-config lockstep validators
  (agent-install ↔ agent-profile ↔ agentScript;
  sandboxProfileId ↔ coderImage / startupScript / gateScript;
  gate-retries) run against **both** the workflow `defaults:`
  block AND every step's `config:` block in isolation, AND
  against the merged effective config per step (so a step
  that inherits half its `agent.*` keys from `defaults:` and
  half from `config:` still gets validated as if the merge
  result were written by hand). Same severity policy as
  per-phase config — warnings stay warnings, errors stay
  errors. Reuses the validators from
  `src/specs/phases/validate.ts` where Block 0 audit confirms
  reuse scope; new wrapper invokes them at each merge level.
- Step-node discriminated union: leaf (`spec`) vs if-wrapper
  (`if` + `steps`) vs external subworkflow (`workflow`) per §6.1.
- **`exports:` shorthand-and-longhand schema per §15.28 point
  8.** Each export entry accepts either a shorthand string
  (`{ rowCount: 'number' }`) or the longhand object form
  (`{ rowCount: { type: 'number' } }`). Shorthand string
  values: `'string' | 'number' | 'integer' | 'boolean' |
  'array' | 'object'` (the JSON-Schema primitive set). Both
  forms parse to the same internal representation; canonical
  JSON emits the longhand form. Longhand carries forward to
  richer Zod types (`{ rowCount: { type: 'number',
  minimum: 0 } }`) in v1.x without a schema break.
- Source schema per type: github / gitlab / bitbucket / s3 / gcs
  / r2 / http / local; each with `id:` (required), per-type
  credential fields marked `sensitive: true`, `saveAs:`
  (required), `if:` (optional CEL) per §15.24, `maxSize:` and
  `maxUnpackedSize:` per §5.4.6, `unpack:` per §5.4.10 (single-
  file-shaped sources only), `overwrite:` per §5.2. Discriminated
  via an explicit `type:` field in canonical JSON
  (`{ id: 'repo', type: 'github', url: ... }`) per §15.28 point
  3; Zod `discriminatedUnion('type', [...])`. The type-as-YAML-
  key authoring shape (`github: {...}`) is a loader/SDK
  convenience that emits the canonical `type:` discriminator —
  see Block 2.1 (YAML loader) and Block 2.2 / 2.3 (SDKs) for
  the transform direction.
- Sink schema per type: s3 / gcs / r2 / github-pr / gitlab-mr /
  bitbucket-pr / email / slack / webhook / local; each with
  `id:` (required), `after:` (required at workflow level;
  optional at step level — synthesized during flatten),
  per-type fields. `webhook` includes `hmac:` block
  (sha1/sha256/sha512 + header + optional prefix) per §15.8.
  Same `type:` discriminator pattern as sources per §15.28
  point 3.
- **Step-level sinks (§15.27).** Leaf and subworkflow step
  shapes accept an optional `sinks:` field with the same
  `Sink[]` type as workflow-level. If-wrappers reject `sinks:`
  at the schema level (validate-time error). A Zod
  `.transform()` runs after parse + before downstream
  consumers see the parsed workflow: **moves every step-level
  sink into the workflow's global `sinks:` list, synthesizing
  `after:
  <parent_step_id>` when the sink omitted it, preserving any
  CEL `after:` override verbatim, and tagging each moved sink
  with a `_sourceLocation` annotation that survives downstream
  validation.** Post-transform the parsed workflow has zero `sinks:` fields
  on step nodes — all sinks live at workflow level. Validator
  warning when a step-level sink's CEL `after:` doesn't
  reference the parent step's state.
- **Step-level sources (§5.5) — leaf-only in v1.** Leaf step
  shape accepts an optional `sources:` field with the same
  `Source[]` type as workflow-level. **If-wrappers AND
  subworkflow steps reject `sources:` at the schema level**
  (validate-time error with fix-pointer). Spec §6.1 table:
  leaf accepts both `sources:` and `sinks:`; subworkflow
  accepts `sinks:` only; if-wrapper accepts neither. The
  sources-on-subworkflow restriction is intentional for v1
  (ordering/precedence question between parent's mounts and
  subworkflow's own sources; deferred per §15.27 sources-
  vs-sinks asymmetry rationale).
- Resource ID grammar enforcement (`[a-z][a-z0-9_]*`) per §15.11.
- All exclusivity rules: workspace-relative `saveAs:`, no
  `/workspace/` prefix, no `..`, etc.
- **`saveAs:` normalization + source-shape inference (§15.4
  Amendment 2).** At parse time, normalize trailing slashes
  on `saveAs:` paths — `/data` and `/data/` are equivalent;
  the canonical form drops the trailing slash. Directory-vs-
  file shape is inferred from the **source** structurally
  (URI shape for s3/gcs/r2; `path:` selector for git; host
  `stat()` for `local`), NOT from any `saveAs:` convention.
  Validator rejects: paths starting with `/workspace/`
  (that's the agent's view; workflow uses workspace-relative);
  paths containing `..`; collisions between two sources at
  the same resolved path (unless `overwrite: true` on the
  child); a child mount that would clobber parent contents
  when the parent's resolved tree is statically known. Nested
  mounts allowed with parent-before-child ordering — but the
  ordering enforcement itself lives in Block 5.1 (host-side
  downloader orchestration); Block 1.1 only validates the
  declared paths are well-formed.
- **`tests:` block schema (§6.7 / §15.15)**. Combined
  definition + policy fields. Accepted at:
  - Step level (under each step node)
  - **Workflow top level (NEW)** — for workflow-level tests
    that contribute to cumulative scope from step 1 onward
    (§15.15).
  Fields: `files` (optional list of relative paths), `assert`
  (optional multi-line string), `mutable` / `fail2pass` /
  `enforce` / `immutable-files` (existing policy fields,
  carried forward from the per-phase-config schema), `none`
  (boolean; mutually exclusive with definition fields).
  Validator rules from §6.7. The legacy `tests.profile:`
  field is rejected with a fix-pointer to `config.test.profile`
  (per §15.14).
- **Profile-required validator** per §6.7. After the
  defaults-chain merge (step `config.test.profile` → workflow
  `defaults.test.profile` → project default → built-in), any
  step whose `tests:` block declares `files:` or `assert:`
  without a resolved profile fails validation. The error
  message names the chain links that were checked and points
  at the step's `tests:` location. Owner: Block 1.1
  (schema-bound; runs alongside the rest of the
  validator pass on the parsed workflow). The Block 13.1
  acceptance test for this case is the regression target.
- **Schema-level security validators from §15.8.** These fire
  at parse / validate time (not at runtime) so authors get the
  error before they ever dispatch. Owners listed here so
  they're not split across Block 4 (sources) / Block 7 (sinks)
  implementation work — those blocks implement the runtime
  paths, this block owns the validate-time checks. Specifically:
  - **Email sink — TLS enforcement.** Reject `port: 25 + secure:
    false` (plaintext SMTP forbidden) with fix-pointer at the
    sink's `port:` / `secure:` location.
  - **CRLF rejection in templated headers / subject.** For
    `http` source `headers:`, `webhook` sink `headers:`, and
    `email` sink `subject:` / `headers:` — any literal `\r`
    or `\n` in the declared value fails validation with the
    field's location (CRLF-injection prevention per §15.8).
    Interpolated values get the same check at step-execution
    time — but the literal-value validator is Block 1.1.
  - **PR sinks — `head:` interpolation lint.** `github-pr` /
    `gitlab-mr` / `bitbucket-pr` sinks require `head:` to
    contain `{{run.id}}` or another per-run-unique
    interpolation. Validator flags a literal-only `head:` as a
    warning with the §15.8 reasoning (force-push collisions
    across concurrent runs).
  - **PR sinks — default-branch reject.** Static-string `head:`
    matching `main` / `master` fails validation as an obvious
    mistake (guardrail against force-pushing to the default
    branch). (API-derived default-branch lookup is v1.x; the
    static-name reject is cheap and catches the common case.)
    Limited to `main` / `master` per spec §15.8 class-level
    rule #4 — `develop` / `trunk` are integration-branch
    conventions, not typically default branches, so don't
    qualify for default-branch protection.
  - **Email sink — HTML-body opt-in.** `body-html:` without
    explicit `body-html-opt-in: true` (or equivalent
    acknowledgement field per §15.8 catalogue) fails validation
    with a fix-pointer; prevents accidental HTML injection
    surface.
  - **Webhook sink — HTTPS-only `url:`.** Static URLs failing
    the `https://` scheme check fail validation. Interpolated
    URLs get the same check at step-execution time via the
    shared HTTPS-flags helper (Block 4.3) — the literal-value
    validator is Block 1.1.
  - **Anonymous-fetch warning** (§15.8 class-level rule #6).
    Source types accessing credential-supporting backends
    (`github` / `gitlab` / `bitbucket` / `s3` / `gcs` / `r2`)
    without credentials emit a validate-time **warning** (could
    be a misconfigured-public mask). Allowed (legitimate
    public-dataset access), not blocked. Validator inspects
    per-type credential fields; if all are unset / unprovided,
    surface the warning with a fix-pointer ("if the bucket is
    public, ignore; otherwise add credentials").
- **Map-shape credential field metadata.** For sensitive
  fields shaped as `map<string,string>` where every value
  position can carry a credential — `http` source `headers:`
  is the canonical case — the schema marks the **whole
  value-position as sensitive** (single bit per map, not per
  key). The §15.25 secret-ref AST walk (Block 1.3) reads this
  metadata when classifying secret-bearing interpolations.
  Spec §5.3: mild over-marking (e.g. `User-Agent` /
  `Accept` interpolations with secret-typed inputs also
  trigger the warning) is acceptable — the workflow author
  explicitly chose to put a secret there. Mirror the same
  marking on `webhook` sink `headers:` and `email` sink
  `headers:` for symmetry.

**Out of scope this week:** semantic validation (DAG reachability,
ref resolution, type-checking against exports). That's later in
Block 1.

**Files:**
- `src/specs/workflow/schema.ts` — new (alongside existing
  `src/specs/phases/schema.ts`, same Zod patterns).
- `src/specs/workflow/types.ts` — derived TypeScript types.
- `src/specs/workflow/flatten-step-sinks.ts` — new; the Zod
  `.transform()` post-pass that moves step-level sinks into
  the global `sinks:` list per §15.27. Preserves source
  locations.
- `src/specs/workflow/normalize-save-as.ts` — new; trailing-
  slash normalization + nested-mount + collision check for
  `saveAs:` per §15.4 Amendment 2. Runs as a Zod `.transform()`
  /`.refine()` step on each source.
- `src/specs/workflow/validate-defaults.ts` — new; reuses
  Phase 1 per-phase-config sub-schemas for the workflow
  `defaults:` block.
- `src/specs/workflow/validate-sink-security.ts` — new; the
  §15.8 schema-level validators (TLS, CRLF, `head:` lint,
  default-branch reject, HTML-body opt-in, HTTPS `url:`,
  anonymous-fetch warning).
- `src/specs/workflow/validate-step-shape.ts` — new; rejects
  `sources:` on if-wrappers and subworkflow steps per §6.1
  table (sinks-on-if-wrapper rejection lives in the
  flatten-step-sinks pass).

**Acceptance:**
- Parses every example from §4 / §11 of workflow-api.md.
- Rejects every invalid example with a clear error path.
- ~95% line coverage on unit tests (Zod schemas are unit-testable
  cleanly).
- **Step-level sinks flatten correctly.** A workflow authored
  with step-level sinks produces canonical JSON structurally
  identical to the same workflow authored with workflow-level
  sinks (synthesized `after:` matches; declaration order
  preserved in the flattened list; source-location annotations
  point at the original `steps[N].sinks[M]` position).
  If-wrappers with `sinks:` fail validation at parse time with
  a clear fix-pointer (per §15.27).
- **`metadata:` block accepts arbitrary `labels` / `annotations`
  keys**, both addressable from CEL via bracket notation in
  Block 1.2's environment registration.
- **`defaults:` block** with each of `gate` / `agent` /
  `container` / `test` / `limits` populated parses identically
  to per-phase-config sub-schemas (snapshot test against
  `src/specs/phases/schema.ts` shape).
- **Lockstep validators fire at all three merge levels.** Each
  per-phase-config §6.9 lockstep group (agent-install ↔ profile
  ↔ agentScript; sandboxProfileId ↔ image / startup /
  gateScript; gate-retries) is exercised with a positive case
  and a negative case at: (a) workflow `defaults:` alone,
  (b) step `config:` alone, and (c) split across `defaults:` +
  `config:` where neither side trips the validator in
  isolation but the merged effective config does. Severity
  matches per-phase config (warnings stay warnings).
- **`saveAs:` normalization.** Source declaring `saveAs: '/data/'`
  and same workflow declaring `saveAs: '/data'` produce
  byte-identical canonical JSON. Source declaring
  `saveAs: '/workspace/data'` fails validation with a pointer
  citing §15.4 Amendment 2. Source with `saveAs: '/../escape'`
  fails. Two sources at identical resolved paths fail unless
  the child sets `overwrite: true`.
- **§15.8 schema validators fire.** Each of the seven rules in
  the security-validators bullet has a positive (accept) and
  negative (reject / warn with correct fix-pointer) unit test:
  email TLS, CRLF in subject / headers, PR `head:` literal-only
  warning, PR default-branch reject (`main` / `master` only —
  `develop` / `trunk` accepted), email HTML opt-in, webhook
  HTTPS-only `url:`, anonymous-fetch warning on
  credential-supporting sources.
- **Step-kind shape constraints (§6.1 / §5.5 / §15.27).** A
  workflow declaring `sources:` under an if-wrapper fails
  validation. A workflow declaring `sources:` under a
  subworkflow step (`workflow:`) also fails validation. Both
  errors point at the offending node with the spec §6.1 table
  cited in the fix-pointer. Leaf steps continue to accept both
  `sources:` and `sinks:`.
- **Map-shape sensitivity metadata** is exposed via the SDK's
  introspectable schema (so Block 1.3's secret-ref AST walk can
  query it for `http` source `headers:`, `webhook` sink
  `headers:`, `email` sink `headers:`).

### 4.2 Week 1.2 — CEL evaluator integration + model catalogue

**Library: `@marcbachmann/cel-js` v7.6.1+** (verified during
§15.17 design pass — see workflow-api.md §15.17 verification
table). MIT, zero deps, 22× faster than alternatives, active
maintenance. Covers every CEL feature the spec needs
(arithmetic / comparison / logical / conditional / indexing /
built-in macros / Environment API for typed variables and
checks).

**Scope:**
- `@marcbachmann/cel-js` wrapper module exposing
  `parse(expr)` → AST, `evaluate(ast, ctx)` → typed value, and
  `check(expr, env)` → validation result.
- **Saifctl `Environment` setup** — register every CEL ref
  catalogue entry from §15.10 (locked) as a typed variable:
  - `inputs.<name>` per declared input type (§15.24).
  - `steps.<id>.{status, success, failed, errored, skipped,
    completed, exitCode, duration, attempts, exports.<key>}`
    per §6.5 + §6.4.
  - `sources.<id>.{status, resolved, skipped, failed,
    completed, size, unpackedSize, fileCount, uri, savedAs,
    startedAt, duration, errorMessage}` per §15.10.
  - `sinks.<id>.{status, success, failed, errored, skipped,
    completed, attempts, startedAt, duration, errorMessage}`
    per §15.10.
  - `run.{id, url, startedAt}` per §15.10.
  - `workflow.metadata.{name, description, labels.<key>,
    annotations.<key>}` per §15.10.
- Model catalogue per §15.10 (locked). Bracket notation
  (`map["key"]`) is canonical for non-identifier keys per
  §15.10's "Field access notation" note. Cross-sink CEL refs
  (`sinks.<otherId>.success`) participate in the same
  Environment — see Block 7.2 for the dispatch-loop
  re-evaluation hooks (§7.3.3).
- **Compile-time type-checking** via `env.check()` —
  type-mismatch errors caught at workflow validate-time before
  evaluation.
- **Same evaluator powers `{{ ... }}` interpolation** per
  §15.17. Block 1.3's tokenizer delegates expression parsing
  + evaluation to this module.

**Files:**
- `src/specs/workflow/cel.ts` — new; thin wrapper exposing
  `parse(expr)`, `evaluate(ast, ctx)`, `check(expr, env)`.
- `src/specs/workflow/cel-env.ts` — new; builds the saifctl
  `Environment` from a parsed workflow (registers all
  refs with their types).
- `src/specs/workflow/cel-types.ts` — model catalogue types.

**Acceptance — feature coverage verification (one test per
row of the §15.17 verification table):**

- Arithmetic: `1 + 2 * 3` → `7` (BigInt).
- String concat: `"a" + "b"` → `"ab"`.
- Comparison: `1 < 2` → `true`.
- Logical: `true && false` → `false`.
- Conditional: `true ? "y" : "n"` → `"y"`.
- Membership: `2 in [1, 2, 3]` → `true`.
- List indexing: `[10, 20, 30][1]` → `20`.
- Map indexing (bracket): `{"a": 1}["a"]` → `1`.
- Map indexing (dotted): `{"a": 1}.a` → `1`.
- `has(x.field)` — works on declared variables.
- `size([1, 2, 3])` → `3`.
- `string(42)` → `"42"`; `int("42")` → `42n`;
  `double("3.14")` → `3.14`.
- `all([1, 2, 3], x, x > 0)` → `true`.
- `exists([1, 2, 3], x, x > 2)` → `true`.
- `exists_one([1, 2, 3], x, x > 2)` → `true` (exactly-one
  predicate).
- `filter([1, 2, 3], x, x > 1)` → `[2, 3]`.
- `map([1, 2, 3], x, x * 2)` → `[2, 4, 6]` (transformation
  macro, distinct from the map type).
- `bytes("abc")` → byte string with expected length.
- `dyn(x).type` works on a dynamic-typed value (escape hatch
  for ad-hoc type coercion in v1.x extensions).

These cover every macro the §8.2 grammar declares as v1. cel-js
provides them all today; we pin them so a future library drop
that drops one is caught by CI rather than at runtime.
- Multi-line expression with whitespace inside `{{ }}` parses
  successfully (the tokenizer strips outer whitespace; CEL
  parser handles internal newlines).
- Type-mismatch in `env.check()` produces a clear error with
  `range` + `summary`.
- Custom function registration (`env.registerFunction(...)`)
  works — even though v1 won't expose it through workflow
  YAML, verify the API is available for v1.x.

**Acceptance — saifctl integration:**

- All §6.5 example predicates parse and type-check.
- Bracket-form examples from §15.10 (`headers["Content-Type"]`)
  parse and resolve when the variable is registered.
- Wrapper has a stable internal API (no leakage of
  `cel-js`-specific types into the rest of saifctl — replaceable
  if `cel-js` proves problematic; lean: no contingency planning
  needed, the verification above covers everything we expose).
- Renovate-managed dependency update path (cel-js repo uses
  Renovate; saifctl follows).

### 4.3 Week 1.3 — Interpolation engine + resolution-plan

**Architecture per §15.17:** thin home-brew tokenizer over the
Block 1.2 CEL evaluator. No external templating library.

**Scope:**
- **Tokenizer** (~40 LOC): splits an input string into
  alternating literal segments and `{{ ... }}` expression
  segments. Handles:
  - Whitespace trimming inside `{{ ... }}` (§15.17).
  - Multi-line CEL inside `{{ ... }}` (newlines allowed).
  - Liquid-shaped escape via CEL string literal:
    `{{ "{{" }}` → renders as `{{` literal.
  - Balanced-brace tokenization; rejects nested `{{ ... }}`
    at parse time.
- **Delegation to Block 1.2 evaluator** for inner expressions:
  each `{{ ... }}` segment's content is parsed + type-checked
  via the saifctl CEL wrapper.
- **Type-coercion + substitution glue** (~30 LOC) per §15.25's
  expanded coercion table:
  - `string` → as-is.
  - `int` (BigInt) → decimal digits (`String(BigInt)` works).
  - `double` (number) → `String(x)` (note: `1.0` → `"1"` per
    JS default; document; users use `string()` macro for
    explicit formatting).
  - `bool` → `"true"` / `"false"`.
  - `null` / unset → error at interpolation time with field
    name + expression in message.
  - `list` / `map` → error (user must index/access).
  - `timestamp` → ISO 8601.
  - `duration` → Go-style string.
- **Single-pass substitution** — results not re-parsed for
  `{{ ... }}` syntax (§15.17 security rationale).
- **`resolution_plan` IR annotation:** for each
  interpolatable string field, walk the AST of every
  `{{ ... }}` segment and find the deepest-resolving ref
  kind. Classify into `validate-time` / `run-start` /
  `step-execution` per §15.25's three-pass model. Static
  fields with no `{{ ... }}` segments are pre-resolved at
  validate-time.
- **Secret-ref AST walk** — for each `{{ ... }}` segment's
  parsed AST, walk for `inputs.<name>` refs and check the
  declared type. If any node touches a `type: secret` input,
  flag the entire segment as secret-bearing. v1 simplicity:
  even `has()` / `size()` over a secret-typed input is
  flagged (§15.17 §3.9). Per-destination policy from §15.25's
  matrix: hard-block in `spec:`, warn in `config.agent.env`
  / sink message bodies / sink URIs / attachments filenames,
  no check elsewhere.
- **Error column-mapping** (~20 LOC): translate
  `cel-js`'s parse-error column-within-`{{ ... }}` back to a
  column in the original YAML / TS source string so error
  messages point at the user's file location.

**Files:**
- `src/specs/workflow/interpolate.ts` — new; tokenizer +
  delegation + coercion + substitution.
- `src/specs/workflow/resolution-plan.ts` — new; AST-walk
  classifier into validate-time / run-start / step-execution.
- `src/specs/workflow/secret-ref-walk.ts` — new; AST walker
  for the secret-ref check (shared between bare-CEL and
  `{{ ... }}` paths).

**Acceptance:**
- Every example in §15.17 / §15.25 passes through the
  resolver — including the operator / indexing / macro / 
  conditional / concat cases.
- Whitespace inside `{{ }}` is trimmed; both `{{x}}` and
  `{{ x }}` produce identical results.
- Multi-line `{{ ... }}` expressions parse and evaluate.
- Escape: `{{ "{{" }}` renders as literal `{{`.
- Single-pass: a `value` input whose value contains
  `"{{run.id}}"` does NOT get re-interpolated.
- BigInt coercion: `{{ inputs.count + 1 }}` where `count: 3`
  renders as `"4"` (no `n` suffix).
- Double coercion: `{{ inputs.ratio * 2.0 }}` where
  `ratio: 0.5` renders deterministically (document the
  output).
- Null coercion: `{{ inputs.optional }}` where `optional`
  was not provided → error with clear field-name pointer.
- List/map result error: `{{ inputs.tags }}` (where tags is
  a list) → error suggesting indexing.
- Secret-ref AST walk produces hard-block on spec
  interpolation; warning on `email.subject`; no check on
  sink URIs that aren't credential-shaped fields.
- Resolution-plan output is deterministic (snapshot-tested).
- Error column-mapping points at the original YAML line + col
  for parse errors inside `{{ ... }}`.

### 4.4 Week 1.4 — Predicate evaluation model + step terminal-state machine

**Scope:**
- Step state machine: `pending → success | failed | errored |
  skipped` per §6.5.
- Boolean projections (`.success`, `.failed`, etc.) and string
  `.status` per §6.5.
- Eager per-transition predicate re-evaluation: definite-true →
  fire/run; definite-false → won't-fire/skip; indeterminate → wait.
- `if:` and `after:` share the evaluation model; only the
  triggered action differs.
- Skip-cascade semantics per §6.5 (skipped subtree; siblings
  continue; skipped step's typed fields are undefined).
- **Step reachability validator** per §9 ("Reachability. Every
  step is reachable from the workflow root (no orphans)").
  After schema validation (Block 1.1) and predicate-graph
  construction, walk the step graph from the root entry
  point; any step not reachable through `steps:` /
  if-wrapper-children / subworkflow-step nesting is reported
  as an orphan with its source location. This rules out
  classes of authoring mistakes that look fine in schema
  (well-formed step definitions tucked in the wrong section)
  but never execute. **Built on `graphology`** (pinned in
  Block 0.2 per §15.23 E23 Refresh 3) — shared DAG primitive
  also used by Block 7.2 sink-cycle-check and Block 9
  subworkflow validator.

**Files:**
- `src/specs/workflow/state-machine.ts` — new.
- `src/specs/workflow/predicate-eval.ts` — new.
- `src/specs/workflow/dag.ts` — new; thin wrapper over
  `graphology` for building the step graph from a parsed
  workflow (used by reachability, sink-cycle-check, and
  subworkflow validators). Single source of "how do we
  represent a workflow as a graph."
- `src/specs/workflow/reachability.ts` — new;
  `graphology-traversal` BFS from the root; emits diagnostic
  per orphan step.

**Acceptance:**
- Unit tests cover every branch of the state machine.
- Property tests verify the three-outcome (true / false /
  indeterminate) classifier against random terminal-state
  inputs.
- A workflow with a step defined inside an extra `extras:`
  block (not the canonical `steps:` list) fails validation
  with the orphan step's source location pointed at.
- A workflow with all steps reachable from root passes the
  reachability check.

### 4.5 Block 1 — risks

- **`@marcbachmann/cel-js` production-readiness.** Verified
  during §15.17 design pass — all required features present
  (operators, indexing, macros, Environment API, type
  checking, parse-error column reporting). Active maintenance
  (v7.6.1 April 2026, 88 releases). Zero deps, MIT.
  Mitigation: Block 0 smoke tests exercise every feature
  surface we expose; if a specific feature regresses across
  versions, pin the working version.
- **BigInt vs JS number divergence** (`cel-js` int = BigInt,
  double = JS number per CEL spec). Mitigation: type-coercion
  glue in Block 1.3 explicitly handles BigInt via `String(x)`
  (which strips the `n` suffix). Tested in Block 13.1
  fixtures.
- **Recursive Zod schemas** (subworkflows reference workflow
  schema). Mitigation: use `z.lazy()` per existing patterns in
  saifctl.

---

## 5. Block 2 — Authoring surfaces (3 weeks)

**Goal:** users can write workflows in YAML, TS, Python, or
direct canonical JSON, and get a validated canonical JSON
workflow out the other side. The TS / Python / YAML loaders
share the canonical-JSON output contract per §12.3; the JSON
loader skips the surface step entirely (§12.5 escape hatch).

### 5.1 Week 2.1 — YAML loader (+ JSON loader)

**Scope:**
- Parse YAML → JSON → Zod-validate against the workflow schema.
- Kebab-case → camelCase translation at the SDK boundary per
  §4.4.
- **Source / sink type-key → `type:` discriminator transform
  per §15.28 point 3.** YAML authoring shape uses the
  type-as-key form (`github: {...}` under a source / sink
  entry); the loader rewrites this to the canonical-JSON
  shape (`{ type: 'github', ... }`) before Zod validation.
  Exactly one type key per source / sink entry; zero or
  multiple → validate-time error with location pointer.
- Source-location preservation: errors point at YAML
  line/column (survives the type-key → discriminator
  transform).
- Schema error → "this YAML doesn't match the schema" framing
  (no magical "convert to a code SDK" messaging — see §15.7
  resolution).
- **JSON escape-hatch loader per §12.5.** `.json` files take
  the canonical-JSON-only fast path: read → JSON.parse →
  Zod-validate. No kebab-case translation, no type-key sugar
  (`{ github: {...} }` rejected — `.json` is canonical only).
  Same Zod validator + same error reporting as the YAML
  loader; the entire surface is ~20 LOC. Every canonical-JSON
  fixture used for IR round-trip tests (§12.3) becomes a
  loader-json acceptance test for free.
- **Loader-dispatch helper.** Single `loadWorkflow(path)`
  entry point routes by extension to the right loader
  (`.yml`/`.yaml` → YAML; `.json` → JSON; `.ts`/`.mts`/`.cts`/
  `.js`/`.mjs`/`.cjs` → TS-loader from Block 2.2; `.py` → Python
  loader from Block 2.3). Auto-discovery in CWD per §12.5 /
  §10.1 ordering — full 10-extension list, first match wins:
  `workflow.json` → `workflow.yml` → `workflow.yaml` →
  `workflow.ts` → `workflow.mts` → `workflow.cts` →
  `workflow.js` → `workflow.mjs` → `workflow.cjs` →
  `workflow.py`. Multiple matches log a warning naming the
  chosen file (the higher-precedence one).

**Files:**
- `src/specs/workflow/loader-yaml.ts` — new.
- `src/specs/workflow/loader-json.ts` — new; canonical-JSON
  fast-path loader per §12.5.
- `src/specs/workflow/loader-dispatch.ts` — new; the
  `loadWorkflow(path)` entry point + extension routing +
  CWD auto-discovery.
- `src/specs/workflow/normalize-type-key.ts` — new; the
  type-key → `type:` discriminator transform (shared with the
  Python SDK's emission path).

**Acceptance:**
- Every YAML example in §4.3 / §11 / §13.1 parses.
- `sources: [{ github: { url: ..., saveAs: ... } }]` YAML
  produces canonical JSON `sources: [{ type: 'github', url:
  ..., saveAs: ... }]`. Same for every source / sink type.
- A source entry with two type keys (`{ github: {...}, s3:
  {...} }`) fails at parse time with both key locations in
  the error.
- A source entry with zero type keys fails at parse time
  pointing at the entry's location.
- Malformed YAML produces actionable errors.
- **JSON loader: round-trip parity.** Every TS / Python / YAML
  example, when emitted as canonical JSON via §12.3 round-trip,
  then loaded via the JSON loader, parses to the same in-memory
  object. (Reusing existing fixtures.)
- **JSON loader: rejects YAML sugar.** A `.json` file with
  type-key form (`{ "sources": [{ "github": {...} }] }`)
  fails validation with a pointer at the offending entry and
  the fix-hint "use canonical shape `{ type: 'github', ... }`
  or rename the file to `.yml`".
- **Loader dispatch: extension routing.** All 10 supported
  extensions present in CWD (`workflow.json` / `.yml` /
  `.yaml` / `.ts` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs`
  / `.py`): auto-discovery picks `workflow.json` per §12.5
  order, logs a warning naming the chosen file. Smaller
  fixtures verify each pair-wise precedence in the chain
  (e.g. `.yml` wins over `.yaml`, `.ts` wins over `.mts`).
- **Loader dispatch: unknown extension.** `workflow.toml`
  fails with a clear "no loader for .toml; supported: .json /
  .yml / .yaml / .ts / .mts / .cts / .js / .mjs / .cjs / .py".

### 5.2 Week 2.2 — TypeScript SDK

**Scope:**
- `@safe-ai-factory/saifctl-workflow-sdk` package supports both authoring patterns per
  §15.28 point 7:
  - **Pattern A (raw objects).** Package exports the
    Zod-derived public types (`Workflow`, `Step`, `Source`,
    `SourceGithub`, `Sink`, `SinkSlack`, `Inputs`, `Outputs`,
    `Exports`, etc.) so users can author `const wf: Workflow
    = { schemaVersion: 1, ... }` with no builder imports.
    Raw-object workflows feed the same validate / emit path
    as Pattern B.
  - **Pattern B (builders).** `defineWorkflow`, `step`,
    `source.*`, `sink.*`, `subworkflow`, `expr.*`, `z`
    re-export per §12.1. Builders emit canonical JSON with
    the `type:` discriminator on sources / sinks per §15.28
    point 3 — users never write `type: 'github'` by hand;
    `source.github({...})` produces it.
- Zod-derived typed exports — `step({ exports: { rowCount:
  z.number() } })` produces a typed handle `step.exports.rowCount:
  NumberRef` per §6.4. Shorthand string form
  (`exports: { rowCount: 'number' }`) accepted equivalently
  per §15.28 point 8.
- Expression builder (`expr.gt(stepA.exports.x, 0)`) produces CEL
  strings with type-checked refs per §8.3.
- Canonical JSON emission: `defineWorkflow(...)` returns a
  Workflow object that serialises to the same canonical JSON the
  YAML loader produces (loss-less round-trip).
- **TS loading model: in-process via `jiti`** per §12.1.
  Saifctl already uses `jiti` at runtime
  (`src/design-discovery/tools.ts`); the workflow loader
  reuses the same primitive. `createJiti(<saifctl-parent>).import(<workflowPath>)`
  → user's default export → Zod validate. No subprocess in
  the v1 happy path, no `tsx` / `ts-node` install required in
  the user's project. The subprocess + alt-runtime path
  (Bun / Deno via `--runtime` / `SAIFCTL_TS_RUNTIME` /
  `--node` / `SAIFCTL_NODE`) is deferred to v1.x; flag space
  reserved per §12.1. **Today's escape hatch for non-Node
  users is the JSON loader** (Block 2.1, §12.5).
- **JSON Schema artifact at `dist/workflow-schema.json`** per
  §15.28 point 10. Generated from the Block 1.1 Zod schemas
  via `zod-to-json-schema` as a build step; ships in the
  `@safe-ai-factory/saifctl-workflow-sdk` npm package AND in the main `saifctl` npm
  package. **No public `$schema` URL** — distribution is
  by in-package path only (avoids the name-squatting attack
  surface that would come from auto-fetching a `$schema` URL
  for a domain we don't own; per workflow-api.md §15.28 point
  10).
- **`acceptedSchemaVersions` engine metadata.** Both the
  `@safe-ai-factory/saifctl-workflow-sdk` and the main saifctl package declare
  `acceptedSchemaVersions` in `package.json` (custom field;
  e.g. `"acceptedSchemaVersions": [1]`). `peerDependencies`
  in `@safe-ai-factory/saifctl-workflow-sdk`'s `package.json` declare the engine
  version range (npm warns at install if mismatched). Same
  shape ships in Block 2.3 for the Python package
  (`accepted_schema_versions` in `pyproject.toml`; pip extras
  declare engine pin). Per §12.4 + §15.28.

**Files:**
- `packages/workflow-sdk-ts/` — new monorepo package (or vendored as
  appropriate; Block 0 audit decides packaging).
- `packages/workflow-sdk-ts/src/define-workflow.ts`
- `packages/workflow-sdk-ts/src/step.ts`, `source.ts`, `sink.ts`,
  `subworkflow.ts`, `expr.ts`
- `packages/workflow-sdk-ts/src/types.ts` — Zod-derived public type
  re-exports for Pattern A authoring.
- `packages/workflow-sdk-ts/scripts/build-schema.ts` — new; runs
  `zod-to-json-schema` to emit `dist/workflow-schema.json`.
- `packages/workflow-sdk-ts/package.json` — `acceptedSchemaVersions`
  field + `peerDependencies` on saifctl engine version.
- `src/specs/workflow/loader-ts.ts` — new; host-side `jiti`
  invocation (`createJiti(...).import(...)`) for `.ts` / `.mts`
  / `.cts` / `.js` / `.mjs` / `.cjs` workflow files +
  default-export validation + module-resolution error mapping
  (clear pointers for missing `@safe-ai-factory/saifctl-workflow-sdk`
  or other user deps).

**Acceptance:**
- Every TS example in §4.1 / §11 of workflow-api.md compiles +
  emits canonical JSON that round-trips with the YAML loader.
- Pattern A authoring works: `const wf: Workflow = {
  schemaVersion: 1, metadata: { name: 'demo' }, steps: [...] }`
  type-checks and validates via the same parse path as builder
  output.
- Type-error attempts (mismatch on `expr.gt` operands, wrong
  export ref shape) produce compile errors with useful messages.
- **TS loader: in-process happy path via `jiti`.** A
  `workflow.ts` that imports only
  `@safe-ai-factory/saifctl-workflow-sdk` loads and emits canonical
  JSON without requiring `tsx` / `ts-node` in the user's
  `package.json`. A `workflow.ts` with additional user imports
  (e.g. a date utility) resolves against the user's
  `node_modules` (jiti roots resolution from the workflow
  file's location). Missing `@safe-ai-factory/saifctl-workflow-sdk` in
  the user's project surfaces a clear "install
  `@safe-ai-factory/saifctl-workflow-sdk`" error rather than a raw
  Node `ERR_MODULE_NOT_FOUND`. Repeat invocations hit jiti's
  filesystem cache (sub-50ms re-load on unchanged files).
- **`.js` / `.mjs` / `.cjs` workflows load the same path** —
  jiti handles plain JS identically.
- `dist/workflow-schema.json` is regenerated on build; checked
  in as a snapshot artifact; CI diffs the build output against
  the snapshot and fails on drift.
- `package.json` carries the `acceptedSchemaVersions` field
  and a `peerDependencies` entry against the saifctl engine
  version (semver range matching the schema-major-version
  contract).

### 5.3 Week 2.3 — Python SDK

**Scope:**
- `saifctl` Python package with `workflow`, `source`, `step`,
  `sink`, `subworkflow`, `expr` modules per §12.2.
- Same Pattern A + Pattern B support as TS SDK per §15.28
  point 7. Pydantic models serve both: users can construct
  the model objects directly (Pattern A) or use builder
  helpers (Pattern B). Builders emit the canonical `type:`
  discriminator per §15.28 point 3.
- **Pydantic codegen via `datamodel-code-generator`** (pinned in
  Block 0.5 per §15.23 B7). Source-of-truth chain: Block 1.1 Zod
  schemas → `zod-to-json-schema` build step → `workflow-schema.json`
  → `datamodel-codegen` → vendored `saifctl_workflow_sdk/_generated_models.py`.
  Invocation:
  ```bash
  datamodel-codegen \
    --input dist/workflow-schema.json \
    --input-file-type jsonschema \
    --output packages/workflow-sdk-python/saifctl_workflow_sdk/_generated_models.py \
    --output-model-type pydantic_v2.BaseModel \
    --target-python-version 3.10 \
    --use-double-quotes \
    --snake-case-field \
    --use-annotated \
    --use-discriminator-of-union \
    --use-standard-collections \
    --reuse-model \
    --collapse-root-models
  ```
  **Vendored, not build-time-generated.** The
  `_generated_models.py` file is committed; a CI step
  regenerates and diffs to catch schema-drift PRs that didn't
  rerun the generator. Underscore prefix discourages user
  imports; the public surface (`saifctl_workflow_sdk/workflow.py`
  etc.) re-exports the relevant types. Block 0.5 covers the
  discriminator round-trip verification; if Block 0 surfaces
  metadata gaps, add the ~30 LOC post-processor pinned there
  before this week.
- `if_` / `for_` aliases for keyword collisions per §4.4.
- snake_case → camelCase normalization at canonical-JSON
  emission per §4.4 / §15.28 point 2.
- Subprocess loading: saifctl spawns the user's Python with
  `<python-command> workflow.py`; the file writes canonical JSON
  to stdout; saifctl reads it. **Invocation resolution per
  §12.2**: `--python` flag (path OR tokenized command like
  `"uv run python"`) → `SAIFCTL_PYTHON` env (same shape) →
  `VIRTUAL_ENV` → `python3` on `PATH` → `python` on `PATH`.
  Failure surfaces a clear error listing every path checked
  with its source.
- **Saifctl is env-agnostic, not an env manager** per §12.2.
  No auto-detection of `pyproject.toml` / `uv.lock` /
  `poetry.lock`. User invokes saifctl through their preferred
  env (`uv run saifctl ...`, `poetry run saifctl ...`, or via
  activated venv); saifctl only does Python invocation
  resolution + spawn.
- **Tokenized-command support for `--python` / `SAIFCTL_PYTHON`**
  via shellwords-style parser. First token execs; remaining
  tokens prepend to `workflow.py` as positional args. Supports
  `--python "uv run python"` / `--python "poetry run python"`
  without requiring the user to activate their env first.
- **Structured error envelope on stderr** per §12.2 table:
  child Python writes `{kind, message, hint, file, line, col}`
  JSON to stderr for `sdk-not-installed`,
  `python-version-too-old`, `user-syntax-error`,
  `user-runtime-error`; saifctl maps these to actionable CLI
  errors (`pip install` hint, version-mismatch hint, source
  pointer, etc.). Stdout stays clean for IR JSON; mismatched
  exit codes never silently swallowed.
- **JSON Schema artifact at `saifctl/dist/workflow-schema.json`
  inside the wheel/sdist.** Same in-package file as TS SDK;
  same `zod-to-json-schema` source; bundled at build time.
- `accepted_schema_versions` field in `pyproject.toml` (or
  `[project.entry-points]` shim) declaring supported schema
  majors; engine version pin via pip extras per §12.4.

**Files:**
- `packages/workflow-sdk-python/` — new.
- `packages/workflow-sdk-python/saifctl_workflow_sdk/__init__.py`
- `packages/workflow-sdk-python/saifctl_workflow_sdk/workflow.py`,
  `step.py`, `source.py`, `sink.py`, `expr.py`.
- `packages/workflow-sdk-python/saifctl_workflow_sdk/cli.py` —
  canonical JSON emission entry point.
- `src/specs/workflow/loader-python.ts` — new; host-side Python
  invocation resolution (§12.2 order) + shellwords tokenizer
  for tokenized `--python "uv run python"` commands +
  subprocess spawn + stdout JSON capture + structured stderr
  error envelope parsing + error-class → CLI-hint mapping.
- `packages/workflow-sdk-python/saifctl_workflow_sdk/_generated_models.py` —
  vendored Pydantic models, regenerated by the codegen step
  above on schema bumps. Underscore-prefixed; not part of the
  public API. CI diff-checks this file on PRs that touch the
  Zod schema.
- `packages/workflow-sdk-python/scripts/bundle-schema.py` — new; copies
  `workflow-schema.json` into the package distribution.
- `packages/workflow-sdk-python/scripts/regen-models.sh` — new;
  one-shot wrapper around the `datamodel-codegen` invocation
  above; invoked from CI on Zod schema changes and from
  developers' local pre-commit if they edited the schema.
- `packages/workflow-sdk-python/pyproject.toml` —
  `accepted_schema_versions` metadata + saifctl engine pin.

**Acceptance:**
- Every Python example in §4.2 / §11 of workflow-api.md runs
  and emits canonical JSON.
- Pattern A authoring works: instantiating `Workflow(...)`
  Pydantic model directly produces the same canonical JSON
  as the builder helpers.
- snake_case authoring (`save_as=...`, `max_size=...`) emits
  camelCase canonical JSON (`saveAs`, `maxSize`).
- JSON round-trips via the host (Python → JSON → host validation
  → same workflow object).
- Pydantic validation errors surface clearly when the user
  passes wrong types.
- `workflow-schema.json` ships inside the installed wheel at
  the expected path; verified in install test.
- `pyproject.toml` carries `accepted_schema_versions` metadata
  and the engine pin.
- **Python invocation resolution**: `--python` flag overrides
  `SAIFCTL_PYTHON`; env var overrides `VIRTUAL_ENV` auto-detect;
  `VIRTUAL_ENV` overrides PATH lookup; `python3` preferred over
  `python` in PATH fallback. Resolution failure lists every
  path attempted with its source (flag / env / venv / PATH).
  Venv resolution works on both POSIX (`bin/python`) and Windows
  (`Scripts\python.exe`).
- **Tokenized command** accepted by `--python` and
  `SAIFCTL_PYTHON`: `--python "uv run python"` correctly execs
  `uv` with args `["run", "python", "workflow.py"]`.
  `--python "poetry run python"` works analogously. Shell
  quoting (single quotes preserve spaces) handled per
  shellwords semantics.
- **Structured error mapping**:
  - Missing SDK → "Install with `pip install
    saifctl-workflow-sdk` / `uv add saifctl-workflow-sdk`."
    Names the resolved Python binary.
  - Python <3.10 → "SDK requires Python ≥3.10; resolved Python
    reports `<version>`. Override with `--python <newer>`."
  - User syntax error → `file:line:col` pointer.
  - User runtime exception during workflow build → traceback
    pass-through; "did your workflow code throw before
    emitting?"

### 5.4 Block 2 — risks

- **Cross-language schema drift.** Mitigation: derive Pydantic
  schemas from the same JSON Schema as the TS SDK
  (`datamodel-code-generator` step pinned in Block 0.5, not
  hand-maintained). Vendored `_generated_models.py` + CI
  regen-diff catches PRs that change Zod without rerunning
  codegen.
- **Subprocess IPC fragility for Python.** Mitigation: simple
  stdout JSON protocol with explicit error envelope (no streaming,
  no partial IR).

---

## 6. Block 3 — Run model + step lifecycle (2 weeks)

**Goal:** parsed workflow → existing RunArtifact + per-phase subtask
stream.

### 6.1 Week 3.1 — Step lifecycle + RunArtifact mapping

**Scope:**
- Parsed workflow → `RunSubtaskInput[]` compilation. One impl
  subtask per leaf step; N critic subtasks per step using the
  existing per-phase config mechanism (§6.6 of workflow-api.md).
- Reuse `compilePhasesToSubtasks` (per Block 0 audit;
  [src/specs/phases/compile.ts:204](src/specs/phases/compile.ts)).
- Map workflow step state ↔ existing `RunSubtask.status`. The
  workflow's five-state machine (`pending` / `success` / `failed`
  / `errored` / `skipped`) projects onto the existing run
  artifact's per-subtask status.
- **Clear `/workspace/.saifctl/exports/` between every step**
  per §6.4 of workflow-api.md ("cleared between steps — no
  leakage forward"). The orchestrator emits an
  exports-clear action between each step's terminal state
  and the next step's coder start (and between the workflow-
  level downloader's exit and step 1's coder start). Without
  this, a step would read sibling exports from a previous
  run still in the workspace; that's a silent correctness
  bug, not just a leak. Captured commits attribute to the
  same `saifctl-downloader <saifctl-downloader@safeaifactory.com>`
  identity that owns the step-level downloader commits.

**Files:**
- `src/specs/workflow/compile.ts` — new (analogue of
  `src/specs/phases/compile.ts`).
- `src/orchestrator/workflow-step-state.ts` — new; bridges
  workflow state machine ↔ existing RunSubtask state.
- `src/orchestrator/workflow-exports-clear.ts` — new; the
  between-steps exports-dir clear action.

**Acceptance:**
- Linear workflow compiles to the same `RunSubtaskInput[]`
  shape today's `feat run` consumes.
- Existing per-phase loop (`runIterativeLoop`) drives a workflow
  end-to-end without modification.
- After step N completes and before step N+1's coder starts,
  `/workspace/.saifctl/exports/` is empty. Regression test:
  step N writes `foo.json`, step N+1 reads
  `steps.<N>.exports.foo` via the artifact (works) but a
  filesystem read of `/workspace/.saifctl/exports/foo.json`
  inside step N+1's coder fails (the directory is empty).

### 6.2 Week 3.2 — Step exports + run-record integration

**Scope:**
- Step exports declared in IR get validated at step-end against
  the agent's writes to `/workspace/.saifctl/exports/<key>.json`
  per §6.4.
- Zod runtime validation; failure marks step as `failed`.
- Exports pinned into the run record per step.
- JSON root scalars accepted per §15.5 (no special wrapping).
- **Both shorthand and longhand export schemas validate at
  runtime per §15.28 point 8.** Shorthand `'number'` and
  longhand `{ type: 'number' }` produce identical runtime
  validation behaviour; the canonical-form normalization
  happens at compile-time in Block 1.1.
- `RunArtifact` schema additions for forward-compatibility with
  v1.x resume (per §15.20 / §14.18 of workflow-api.md): land the
  fields now, even though the `--resume-from` CLI itself is v1.x.

**Files:**
- `src/orchestrator/workflow-exports.ts` — new.
- `src/runs/types.ts` — schema additions per §15.20 / §14.18 / §15.10
  of workflow-api.md:
  * `RunArtifact.workflow` — serialised compiled workflow at
    run start (for resume-time comparison + replay).
  * `RunCommit.originatingSubtaskId` — every recorded commit
    tagged with the subtask that produced it (for v1.x
    truncate-at-end-of-step-N).
  * `RunSubtask.exportsCapture?` — per-step exports JSON
    persisted into the artifact so replay doesn't need the live
    workspace.
  * **`RunArtifact.sourceState[]`** — one entry per source
    with the §15.10 catalogue fields (`status`, `size`,
    `unpackedSize`, `fileCount`, `uri`, `savedAs`,
    `startedAt`, `duration`, `errorMessage`). Populated from
    the downloader container's `/saifctl/state/sources.json`
    output (§5.4.9 amendment).
  * **`RunArtifact.sinkState[]`** — one entry per sink
    (workflow-level + flattened step-level per §15.27) with
    the §15.10 catalogue fields (`status`, `attempts`,
    `startedAt`, `duration`, `errorMessage`). Populated by
    the saifctl host as sinks dispatch.
  * (`RunArtifact.inputs?` lands in Block 6; `RunArtifact.workflowOutputs?`
    lands in Block 9 — same schema, separate additions per their
    respective primitives.)
  * **`RunSubtask.contentHash`** — SHA-256 over
    `(spec_text, config_canonical_json, tests_canonical_json,
    sourceList_for_step_level_sources)` per workflow-api.md
    §15.20's modified-step validation policy. Computed and
    pinned at compile time so the v1.x `--resume-from` CLI
    can compare hashes deterministically without re-walking
    the artifact. Lands in v1 alongside the other §15.20
    schema groundwork — avoids a v1.x schema migration if we
    deferred it. Hash function and input field list match
    §15.20 verbatim.
- `src/orchestrator/loop.ts` — when a `runCommit` is appended,
  tag it with the active subtask's id (`originatingSubtaskId`).
  For the synthesised downloader subtask (Block 8 / §5.4),
  commits use the downloader's pseudo-subtask id.

**Acceptance:**
- A step that declares `exports: { rowCount: z.number() }`
  succeeds when its agent writes `42` to `rowCount.json` and
  fails when it writes `"forty-two"`.
- Run record after completion contains the exports per step.
- Run record after completion contains the compiled workflow
  in `RunArtifact.workflow` (round-trips through
  serialise → deserialise unchanged).
- Every `runCommit` carries a non-null `originatingSubtaskId`
  that resolves to a known subtask in the artifact.
- CEL refs (`steps.<id>.exports.rowCount`) resolve correctly in
  downstream `if:` / `after:` predicates.

### 6.3 Week 3.3 — Test-writer subtask + cedar policy (§5.4.12 / §15.15)

**Goal:** spawn a saifctl-controlled subtask that translates
`tests.assert:` text into actual test files in the workspace,
sandboxed under cedar so impl/critic agents can read but not
modify the generated tests.

**Scope:**
- **New subtask kind `test-writer`** in
  `src/orchestrator/phases/subtask-driver-types.ts`. Schema:
  `{ kind: 'test-writer'; assertText: string; profileId: string;
  outputPath: string; specContext: string }`.
- **Test-writer prompt builder** in
  `src/orchestrator/test-writer/build-prompt.ts` (new). Inputs:
  - Assertion text (the `tests.assert:` content)
  - Profile id + profile description (loaded from
    `src/test-profiles/<id>/profile.ts`)
  - Profile template files (loaded from
    `src/test-profiles/<id>/templates/`)
  - Helper file contents (e.g.
    `src/test-profiles/<id>/templates/helpers.ts`)
  - Spec / metadata text (step `spec:` for step-level;
    workflow `metadata.description` for workflow-level)
  Builds the system prompt + user prompt for the agent CLI.
- **Test-writer container variant** — same agent CLI image as
  impl/critic, different cedar policy:
  - Read-allowed everywhere under `/workspace/`
  - Write-allowed ONLY under
    `/workspace/.saifctl/__generated_tests__/`
  - All other writes forbidden
- **Compile-time subtask emission** in
  `src/specs/workflow/compile.ts`:
  - For workflow-level `tests.assert:`: emit one test-writer
    subtask at the FRONT of the subtask list (before any
    step's subtasks). Output path:
    `/workspace/.saifctl/__generated_tests__/__workflow__/assertions.spec.<ext>`.
  - For each step's `tests.assert:`: emit one test-writer
    subtask at the START of that step's subtask group (before
    its impl subtask). Output path:
    `/workspace/.saifctl/__generated_tests__/<step_id>/assertions.spec.<ext>`.
- **runCommit attribution** — the test-writer's output commits
  with author identity `saifctl-test-writer <saifctl-test-writer@safeaifactory.com>`,
  message `chore(test-writer): generate tests for <scope>`.
- **`testScope.include` integration** — the test-writer's
  output file path is added to the subsequent test-runner
  subtasks' `testScope.include` so the cumulative scope
  picks it up (§15.15 cumulative scope mechanism).

**Cedar policy update** (`src/orchestrator/policies/default.cedar`):

```cedar
forbid (
  principal in Action::"coder",
  action == Action::"fs::write",
  resource
)
when {
  resource.path like "/workspace/.saifctl/__generated_tests__/*"
};

permit (
  principal in Action::"test-writer",
  action == Action::"fs::write",
  resource
)
when {
  resource.path like "/workspace/.saifctl/__generated_tests__/*"
};
```

**Files:**
- `src/orchestrator/test-writer/build-prompt.ts` — new
- `src/orchestrator/test-writer/run.ts` — new; wraps the
  agent CLI invocation with the test-writer system prompt +
  cedar variant
- `src/orchestrator/phases/subtask-driver-types.ts` — extend
  `kind` union with `'test-writer'`
- `src/specs/workflow/compile.ts` — emit test-writer subtasks
- `src/orchestrator/loop.ts` — dispatch test-writer subtask
  kind to its driver
- `src/orchestrator/policies/default.cedar` — read/write
  rules per actor

**Acceptance:**
- A step with `tests.assert: "- workspace/x.txt exists"` and
  `config.test.profile: node-vitest` generates a vitest test
  file at `/workspace/.saifctl/__generated_tests__/<step>/
  assertions.spec.ts` before the impl subtask runs.
- Same workflow with `config.test.profile: python-pytest`
  generates a pytest file instead (uses the python-pytest
  templates + helpers).
- Workflow-level `tests.assert:` produces a single test-writer
  subtask at the front of the subtask list; the generated file
  lands in `__generated_tests__/__workflow__/`.
- The test-runner subtask at each step has the generated file
  in its `testScope.include`; the test runner discovers and
  runs the file.
- Cumulative scope: a workflow-level `assert:` file is in
  scope at EVERY step's test runner; a step-level `assert:`
  file is in scope from THAT step onward.
- Cedar enforcement: impl-agent attempts to modify
  `/workspace/.saifctl/__generated_tests__/<scope>/assertions.spec.ts`
  are denied by Leash; test-writer's writes there succeed.
- runCommit attribution: `git log` shows the test-writer's
  commits with the `saifctl-test-writer` author identity,
  distinct from coder commits.

### 6.4 Block 3 — risks

- **Resume-from-step forward compatibility (§15.20).** §15.20 is
  resolved design, not a spike. The six schema additions
  enumerated above (`RunArtifact.workflow`,
  `RunCommit.originatingSubtaskId`,
  `RunSubtask.exportsCapture?`, `RunArtifact.sourceState[]`,
  `RunArtifact.sinkState[]`, `RunSubtask.contentHash`) ship in
  Block 3.2 as the groundwork; `RunArtifact.inputs?` lands in
  Block 6 and `RunArtifact.workflowOutputs?` in Block 9. The
  `--resume-from <runId>:<stepId>` CLI plus hash-and-warn
  validation plus `runCommits` truncation are v1.x work on top
  of this v1 schema. No risk; schema is pinned.

---

## 7. Block 4 — Downloader infrastructure (4 weeks)

**Goal:** the saifctl-owned `saifctl-downloader` container image
populates `/workspace/` from declared sources.

### 7.1 Week 4.1 — Downloader image + Dockerfile + digest pinning

**Scope:**
- Alpine + tools Dockerfile per §5.6.6:
  `git`, `curl`, `ca-certificates`, `bash`, `rclone`
  (single Go binary covers `s3` / `gcs` / `r2` — replaces
  `aws-cli` + `gsutil`; ~150 MB image saving; see §15.8
  library-choice resolution), `libarchive-tools` (provides
  `bsdtar` — replaces `unzip` + `tar` for safer archive
  extraction; see §5.4.10 for rationale and the
  secure-by-default flags).
- Build pipeline in saifctl's release process: build → push →
  capture digest → **cosign sign (keyless via GitHub Actions
  OIDC)** → **SLSA L3 provenance attestation
  (`actions/attest-build-provenance@v2`)** → embed digest +
  signing-identity reference in saifctl's package metadata.
  Per §15.23 F26 Refresh 5; identity + verification policy
  locked in Block 0.6.
- Saifctl host pre-launch validation (per §5.4.1 + §15.23 F26):
  1. Verify the running image's digest matches the pinned digest.
  2. Verify the cosign signature against the pinned OIDC
     identity via **`@sigstore/verify`** (Block 0.2 dep pin).
  3. Verify the SLSA provenance attestation.
  Failure on any step aborts with a clear supply-chain error.
- **Gating ladder** for verification per §15.23 F26: v1.0 ships
  with verification **soft-fail-warn** (logs loudly but
  proceeds) to guard against accidentally bricking v1 users if
  Rekor / Fulcio has an outage during early rollout. After
  several saifctl releases run cleanly through the verify
  path, v1.x flips to **hard-fail** (refuse to launch).
  Gate via `SAIFCTL_DOWNLOADER_VERIFY_MODE=warn|fail` env var;
  default flips with the release that promotes it.

**Files:**
- `src/downloader-image/Dockerfile` — new.
- `src/downloader-image/build.sh` — new build wrapper.
- `src/cli/util/downloader-image.ts` — digest validation +
  cosign signature verification + SLSA provenance check via
  `@sigstore/verify` (new). ~50 LOC for the signing/provenance
  additions per F26.
- `.github/workflows/build-downloader-image.yml` — CI to build,
  push, **cosign sign keyless, emit SLSA provenance
  attestation** (new). Uses `id-token: write` permissions for
  GitHub OIDC; no stored signing keys.

**Acceptance:**
- Image builds locally (`pnpm docker build downloader`).
- Saifctl-side digest validation rejects a tag-mismatched image.
- **Cosign signature verification rejects an unsigned image**
  (test fixture: built without `cosign sign`); error message
  cites the supply-chain check.
- **Signature verification rejects a signature from the wrong
  OIDC identity** (test fixture: image signed by an unrelated
  GitHub Actions workflow); error names the expected vs.
  observed identity.
- **SLSA provenance attestation parses** and links to the
  saifctl release workflow's run URL.
- Soft-fail-warn mode logs the verification result without
  aborting (`SAIFCTL_DOWNLOADER_VERIFY_MODE=warn`); hard-fail
  mode aborts (`SAIFCTL_DOWNLOADER_VERIFY_MODE=fail`).

### 7.2 Week 4.2 — `saifctl-downloader` binary skeleton

**Scope:**
- `saifctl-downloader` is a shell script for v1 (per §5.6.6;
  Go binary in v1.x).
- `resolve-sources` subcommand (v1's only mode).
- Reads `/saifctl/sources.json` (config) +
  `/saifctl/secrets/inputs.json` (tmpfs) — both per §5.4.1.
- Templating pass: substitutes `{{inputs.<name>}}` refs in the
  sources config against the in-memory secrets map per §5.3.
- Dispatches per-source-type fetcher (stub for now; real
  fetchers in Week 4.3/4.4).
- **Per-source state emission** per §5.4.9. After each source
  resolves (or skips / fails), the dispatcher records its
  §15.10 catalogue fields (`status`, `size`, `unpackedSize`,
  `fileCount`, `uri`, `savedAs`, `startedAt`, `duration`,
  `errorMessage`) into an in-memory map. Before container exit,
  the binary writes the full per-source map to
  `/saifctl/state/sources.json` (tmpfs-backed, alongside
  `/saifctl/secrets/`). The host reads this file via `docker cp`
  post-teardown (see Block 5.2). Without this emission step,
  `RunArtifact.sourceState[]` (Block 3.2) and the CEL
  `sources.<id>.*` refs (§15.10) have no data source.
- `dispatch-sinks` subcommand: stub-only for v1 (per §5.6.6,
  forward-compat for v1.x when §14.20 reopens).

**Files:**
- `src/downloader-image/saifctl-downloader` (shell script) —
  new.
- `src/downloader-image/lib/templating.sh` — new.
- `src/downloader-image/lib/dispatch.sh` — new.
- `src/downloader-image/lib/state.sh` — new; in-memory
  per-source state aggregation + final write to
  `/saifctl/state/sources.json` per §5.4.9.

**Acceptance:**
- Binary runs in the container, reads the two config files,
  emits a log of "would fetch X" for each source.
- Secret values never appear in logs.
- After dispatch completes (even when some sources fail or
  skip), `/saifctl/state/sources.json` exists with one entry
  per declared source, populated with the §15.10 catalogue
  fields. Schema-validated against the same shape Block 3.2's
  `RunArtifact.sourceState[]` declares.

### 7.3 Week 4.3 — Source types: `local` + `github` / `gitlab` / `bitbucket`

**Scope:**
- `local`: bind-mount + rsync from `/saifctl/sources/local-<id>/`
  to `/workspace/<saveAs>/` with `.gitignore` filtering and
  `.git` exclusion per §5.1. **For `local` over a single-file
  path with `unpack:` set, hand off to the unpack pipeline
  (Block 4.4) before placing in the workspace.** Symmetric with
  remote single-file unpacking per §5.4.10.
- `github` / `gitlab` / `bitbucket`: full-clone case (`saveAs: /`)
  plus `path:` selector (sparse-checkout) per §5.1. Token via
  `token:` per-type credential per §5.3.
- **HTTPS-ingress hardening for git clones per §5.4.11:** every
  `git clone` invocation uses
  `git -c http.maxRedirects=5 -c http.followRedirects=https-only`
  (5-hop redirect cap + scheme-downgrade rejection). Protocol
  allowlist enforced by validating the URL scheme is `https://`
  at parse time.

**Files:**
- `src/downloader-image/sources/local.sh` — new.
- `src/downloader-image/sources/github.sh` — new (covers gitlab
  / bitbucket via slight URL rewriting).
- `src/downloader-image/lib/https-flags.sh` — new; shared
  `curl` / `git` flag helpers per §5.4.11 (used here and in
  Block 4.4).

**Acceptance:**
- Each source type fetches successfully against a fixture.
- Sparse-checkout works for both file (`path: docs/README.md`)
  and directory (`path: docs/`).
- Hooks / smudge filters are disabled per §5.4.2 reasoning (no
  in-resolver hardening; relies on post-resolver cleanup).
- `local` over a `*.tar.gz` host file with `unpack: tgz`
  extracts correctly into the workspace.
- A redirect chain >5 hops fails with the full chain in the
  error per §5.4.11; a scheme-downgrade redirect refuses
  cleanly.

### 7.4 Week 4.4 — Source types: `s3` / `gcs` / `r2` / `http`

**Scope:**
- `s3` / `gcs` / `r2`: URI-shape inference (prefix vs single
  object) per §5.1; **via `rclone` (single Go binary covers all
  three backends — replaces `aws-cli` + `gsutil` per §15.8
  library-choice resolution).** Auth via per-type credential
  fields per §5.3. **Single-object URIs accept `unpack:` per
  §5.4.10; prefix URIs reject it at validate time.**
- `http`: single file by default. **All HTTP methods (`GET`,
  `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`) via `method:` field
  (default `GET`); `body:` for request body; `query:` map for
  URL query parameters; `body-format: json | raw` controls
  Content-Type and body validation.** Headers (incl
  `Authorization`) populated via interpolation per §5.3.
  `unpack:` field per §5.4.10 with value set
  `false | auto | zip | tar | tgz | gz`; extraction via `bsdtar`
  from the `libarchive-tools` package installed in Block 4.1.
- **`unpack:` pipeline (shared across types):**
  - `auto`-detect via libarchive content sniff with Content-Type
    / extension as warning-only sanity checks.
  - Secure extraction flags
    (`--secure-symlinks --secure-nodotdot --secure-noabsolutepaths`)
    on every `bsdtar` invocation.
  - Post-decompression `maxUnpackedSize:` cap enforced (default
    `5 × maxSize:`).
  - Four-class error catalogue per §5.4.10
    (`format-unidentifiable`, `format-mismatch`,
    `traversal-attempt`, `cap-exceeded`).
  - Unpack telemetry (file count, longest path, max single-entry
    size, total unpacked size) captured into run record.
- **HTTPS-ingress hardening per §5.4.11** — applies to `http` and
  to S3/GCS/R2 over HTTPS. Three hard-coded defaults:
  `curl --max-redirs 5 --proto =https --proto-redir =https`.
  Three-class error catalogue (`redirect-cap-exceeded`,
  `scheme-downgrade`, `protocol-forbidden`). Reuses the
  `https-flags.sh` helper introduced in Block 4.3.

**Files:**
- `src/downloader-image/sources/s3.sh`, `gcs.sh`, `r2.sh` —
  new; thin wrappers around `rclone` with per-backend config.
- `src/downloader-image/sources/http.sh` — new; `curl` with
  HTTPS-flags helper + method/body/query/headers support.
- `src/downloader-image/lib/unpack.sh` — new; shared `bsdtar`
  dispatch with secure flags + `maxUnpackedSize:` enforcement.
- `src/downloader-image/lib/rclone-config.sh` — new; renders
  ephemeral `rclone.conf` from per-source credential fields.

**Acceptance:**
- Each source type fetches against fixtures.
- `maxSize:` enforced per §5.4.6 — refuses to proceed past the
  bound rather than truncating.
- `unpack: zip` / `tar` / `tgz` / `gz` extract correctly against
  fixtures.
- `auto` resolves correctly when Content-Type is correct, when
  it's wrong (warning emitted; libarchive verdict wins), and
  when the format is unidentifiable (clean error).
- Zip-slip fixture refused with `traversal-attempt` error.
- Archive-bomb fixture refused with `cap-exceeded` error.
- Symlink-escape fixture refused (target outside extraction
  dir).
- Redirect chain >5 hops fails with full chain in error
  (`redirect-cap-exceeded`).
- `https://` → `http://` redirect refused (`scheme-downgrade`).
- `ftp://` / `file://` URL refused (`protocol-forbidden`).

### 7.5 Block 4 — risks

- **Tool feature gaps inside Alpine.** Some image versions of
  `aws-cli` v2 are large or have musl issues. Mitigation: Block
  0 audit verifies; fallback is the older `aws-cli` v1 or vendored
  Go SDK.
- **libarchive / `bsdtar` Alpine package edge cases.** The Alpine
  `libarchive-tools` package is small and well-tested; the
  secure-flag set is stable. Mitigation: smoke test on Block 4.1.
- **`curl` / `git` flag drift.** `--proto-redir` and
  `http.followRedirects` semantics need verification against the
  exact Alpine versions of curl and git. Mitigation: pin Alpine
  version (`alpine:3.20` per §5.6.6); test fixtures exercise the
  hardening paths.

---

## 8. Block 5 — Host-side downloader orchestration (2 weeks)

**Goal:** saifctl on the host launches the downloader at the
right times with the right inputs.

### 8.1 Week 5.1 — Engine extension + tmpfs + digest validation

**Scope:**
- Extend the Docker engine (`src/engines/docker/index.ts`) with a
  `runDownloader(opts)` method.
- Bind-mounts: `/workspace/`, `/saifctl/sources.json` (`:ro`,
  from host tmpfile), `/saifctl/sources/local-<id>/` (`:ro`,
  per-local-source).
- Tmpfs mount for `/saifctl/secrets/` per §5.4.1 / §5.6:
  `--mount type=tmpfs,destination=/saifctl/secrets,
  tmpfs-size=4m,tmpfs-mode=0700`.
- `docker cp` of secrets/inputs.json into the running container
  after creation. (The §5.6.8 open question on `docker cp` vs
  `docker exec ... > file` was resolved in Block 0 task 0.4 —
  see Section 3.1.)
- Digest validation: query the running image's digest, compare
  against pinned manifest, abort on mismatch.
- **Nested-mount resolution ordering** per §9 ("Nested mounts
  allowed; parent resolves before child"). Sources are
  topologically sorted by `saveAs:` path depth before
  dispatch — a source mounted at `/a/` resolves before any
  source mounted under `/a/b/`. Sibling mounts at the same
  depth resolve in declaration order. The downloader script
  receives an already-ordered list (no in-container
  re-ordering); failure to populate a parent path before a
  child is a host-side bug, not a downloader bug. Required
  to make collision detection deterministic and to keep
  child-mount writes from disappearing into a later
  parent-mount overwrite.

**Files:**
- `src/engines/docker/downloader.ts` — new.
- `src/engines/types.ts` — extend `Engine` interface with
  `runDownloader()`.
- `src/engines/local/index.ts` — local-engine fallback per
  §5.4.5; no downloader container; host-side resolution.
- `src/orchestrator/source-resolution-order.ts` — new;
  topological sort by `saveAs:` depth before downloader
  invocation; shared between docker engine and local-engine
  fallback.

**Acceptance:**
- Test workflow with one `local` source + one `github` source
  populates `/workspace/` correctly.
- Tmpfs mount confirmed in-memory (`docker inspect` shows
  `tmpfs`).
- Digest mismatch produces a clean error before container starts.
- Nested-mount fixture: sources declared `[ {saveAs: '/a/b/'},
  {saveAs: '/a/'}, {saveAs: '/c/'} ]` resolve in order
  `[/a/, /a/b/, /c/]` (parent before child; siblings in
  declaration order). Verified by capturing the dispatch
  sequence and asserting ordering.

### 8.2 Week 5.2 — Post-download cleanup + git-commit semantics

**Scope:**
- After downloader exit + before first coder container start
  (per §5.4.3):
  1. **Read `/saifctl/state/sources.json`** from the
     (still-running, pre-teardown) downloader container via
     `docker cp` per §5.4.9. Parse, validate against the
     `RunArtifact.sourceState[]` shape (Block 3.2), and merge
     each entry into the live `RunArtifact.sourceState[]`. Same
     `docker cp` mechanism Block 5.1 uses to write
     `/saifctl/secrets/inputs.json`, just in the reverse
     direction. Failure to read / parse the state file is a
     non-fatal warning (sources still resolved; the CEL
     `sources.<id>.*` refs will be sparse).
  2. Strip `/workspace/.git/hooks/*` — replace with empty dir.
  3. Validate `/workspace/.git/config` against allowlist (no
     `core.hooksPath`, no `core.fsmonitor`, no `diff.external`,
     no `filter.*.smudge` / `filter.*.clean`, no `includeIf.*`,
     no `include.path`). The `includeIf.*` / `include.path`
     additions are per spec §15.8 class-level rule #10 — these
     keys can load arbitrary additional config from arbitrary
     paths, which subverts the rest of the allowlist.
- Hardened host-side git invocation: every `git` call from
  saifctl uses `-c core.hooksPath=/dev/null -c
  filter.lfs.smudge=cat -c filter.lfs.clean=cat`.
- Git commit semantics per §5.4.4:
  - After downloader exits and cleanup completes, saifctl
    commits the workspace state under `saifctl-downloader
    <saifctl-downloader@safeaifactory.com>` author with `chore(downloader):
    workflow-level sources` message.
  - Subsequent agent commits stay separate (existing
    `extractPatch` / `apply-patch` mechanism, unchanged).

**Files:**
- `src/orchestrator/workflow-post-download-cleanup.ts` — new.
- `src/utils/git.ts` — extend with hardened-flag helpers.
- `src/orchestrator/workflow-commit.ts` — new (downloader commit
  identity).
- `src/orchestrator/workflow-source-state-merge.ts` — new;
  reads `/saifctl/state/sources.json` from the downloader
  container via `docker cp` and merges into
  `RunArtifact.sourceState[]` per §5.4.9.

**Acceptance:**
- Test workflow with a malicious-fixture repo (planted
  `.git/hooks/post-checkout`) runs end-to-end without host-side
  command execution.
- `.git/config` containing `includeIf "gitdir:/etc"` is
  rejected at validation with a fix-pointer citing §15.8
  class rule #10. Same for any `include.path` key.
- `git log` after a workflow run shows distinct downloader and
  agent commits.
- After downloader teardown: `RunArtifact.sourceState[]` is
  populated with one entry per declared source, each carrying
  the §15.10 catalogue fields (verified against the JSON
  emitted by Block 4.2's `/saifctl/state/sources.json`
  fixture). CEL `sources.<id>.size` / `.fileCount` / etc.
  resolve correctly from the persisted state in later step
  predicates.

---

## 9. Block 6 — Workflow inputs (2 weeks)

**Goal:** users (CLI + web) provide values at run time per
§15.24.

### 9.1 Week 6.1 — Inputs schema + CLI flag plumbing

**Scope:**
- `inputs:` block per §15.24: `value` / `enum` / `secret` types;
  `default:` / `optional:` / `values:` per type's rules.
  Per-type field rules enforced at validate time:
  - `default:` allowed on `value` / `enum`. **Rejected on
    `secret`** — secrets are never written into the workflow
    file (§15.24).
  - `values:` required for `type: enum` (non-empty array of
    strings).
  - Required by default; `optional: true` opts in.
- CLI flags per §15.24:
  - `--input KEY=VAL,KEY2=VAL2` — comma-separated KEY=VALUE
    pairs.
  - `--input-file path1,path2` — JSON flat object per file.
    **Multiple `--input-file` flags allowed AND comma-separated
    paths inside one flag value supported** (mirroring
    `--input-secret-file`); later overrides earlier for
    duplicate keys.
  - `--input-secret NAME1,NAME2` — env-var names from host;
    values pulled from saifctl host env.
  - `--input-secret-file path1,path2` — `.env`-format files
    (`KEY=value`, `#` comments).
- Precedence merge per §15.24: file → flag → web-app (later wins).
- Null semantics per §15.24: engine pre-populates `inputs` map
  so every declared input has a known representation; optional-
  no-default → `null`; `inputs.<name>` always resolves in CEL.

**Files:**
- `src/cli/args/inputs.ts` — new flag definitions.
- `src/orchestrator/workflow-inputs.ts` — bind & merge.

**Acceptance:**
- All combinations of flag + file + env-secrets resolve
  deterministically.
- `inputs.<name>` is addressable from CEL after binding.
- `has(inputs.<name>)` returns false for optional-no-default
  unprovided inputs.
- **`default:` on `type: secret` fails validation** with a clear
  pointer ("secrets are not stored in the workflow file; supply
  via `--input-secret` at run time").
- **Multi-path `--input-file`**: two invocations (`--input-file
  a.json --input-file b.json`) and one invocation with
  comma-separated paths (`--input-file a.json,b.json`) produce
  identical bind state; per-key collisions resolve with the
  later path winning.

### 9.2 Week 6.2 — Source `if:` + secret isolation

**Scope:**
- Source `if:` per §15.24 — CEL boolean predicate evaluated
  after inputs bind, before fetching. Skipped sources don't
  create their `saveAs:` target.
- Secret isolation between downloader and coder containers:
  `--input-secret` lands in downloader tmpfs;
  `--agent-secret` lands in coder env. Crossing boundary requires
  explicit interpolation in agent-visible field
  (`config.agent.secrets[i]: '{{inputs.<name>}}'` per §15.24).

**Files:**
- `src/orchestrator/source-if-evaluator.ts` — new.
- `src/orchestrator/secret-routing.ts` — new (boundary enforcement).

**Acceptance:**
- A source with `if: 'inputs.optional_flag != null'` skips when
  the input isn't provided.
- An input-secret never reaches the coder container unless the
  workflow explicitly forwards it.

---

## 10. Block 7 — Sinks (2 weeks)

**Goal:** outbound side of the workflow — egress to s3 / email /
slack / github / etc.

### 10.1 Week 7.1 — Sink type implementations

**Scope (per §7.2 / §15.8):**
- `s3` / `gcs` / `r2` — upload file or workspace tarball.
  **Library: provider SDKs on host-side (`@aws-sdk/client-s3`,
  `@google-cloud/storage`, S3 SDK for R2 with endpoint
  override).** Native multipart, retry, presigned-URL support.
  When §14.20 reopens for v1.x, sinks move into the downloader
  image and use `rclone` (uniform with source side).
  **`SinkTransport` interface** (per §15.23 E17 Refresh 3):
  cloud-upload sink modules expose a `SinkTransport` interface
  (`upload(plan) → SinkResult`) implemented by
  `HostSdkTransport` (v1) and reserved for `ContainerRcloneTransport`
  (v1.x post-§14.20). The dispatcher consumes the interface;
  swapping the implementation in v1.x is a per-file change,
  not a dispatcher refactor. ~10 LOC; pure shape lock for
  forward compat.
- `github-pr` / `gitlab-mr` / `bitbucket-pr` — open PR with
  workspace diff vs source. **Library: `@octokit/rest` (GitHub),
  `@gitbeaker/rest` (GitLab), home-brew REST calls (Bitbucket
  — no good SDK).** Plus `git` for `checkout -b` + commit +
  `push --force-with-lease`. Empty-diff detection (`git diff
  --quiet`) skips PR creation cleanly. Author identity defaults
  to `saifctl <saifctl@safeaifactory.com>` (matches the existing
  `SAIFCTL_DEFAULT_AUTHOR` constant in
  [src/orchestrator/patch.ts](../../../src/orchestrator/patch.ts));
  configurable per-sink. Per the bot-identity convention in
  [`docs/contributing/architecture/git-and-patches.md`](../../../docs/contributing/architecture/git-and-patches.md#bot-identities-and-commit-authorship):
  any new internal actor that writes commits uses
  `<role> <<role>@safeaifactory.com>` and pins its identity as a
  sibling export to `SAIFCTL_DEFAULT_AUTHOR`.
- `email` — SMTP. **Library: `nodemailer`** (industry-standard
  Node SMTP lib). Enforces TLS — validator rejects `port: 25 +
  secure: false`; HTML-body opt-in (`body-html: true`); rejects
  CR/LF in header / subject values.
- `slack` — incoming webhook (v1). **Library: home-brew HTTPS
  POST** (single call, no SDK dep). App-token + Block Kit mode
  via `@slack/web-api` deferred to v1.x.
- `webhook` — POST/PUT/PATCH/DELETE a templated payload.
  **Library: Node native `fetch` (Node 18+); no external dep.**
  **HMAC signing in v1** via `hmac:` block (`secret`, `header`,
  `algorithm: sha1 | sha256 | sha512`, optional `prefix`).
  Idempotency-key support via `headers:` interpolation
  (`X-Idempotency-Key: {{run.id}}` pattern).
  **`flavor:` field reserved in schema** (per §15.23 E20
  Refresh 3) for the v1.x `standard-webhooks` Svix-spec
  format (`webhook-id` / `webhook-timestamp` /
  `webhook-signature` headers, signs
  `webhook-id.webhook-timestamp.payload`). v1 schema accepts
  only `flavor: 'raw'` (default); `flavor: 'standard-webhooks'`
  rejected at validate time with "deferred to v1.x" pointer.
  Forward-compat lock; no v1 code beyond the schema rejection.
- `local` — copy workspace file or directory to a host path
  (renamed from `download` — symmetric with `local` source).
  **Library: Node `fs/promises` + `fs.cp({ recursive: true })`
  for host-side copy.** `overwrite: false` default; refuse
  existing-path collision unless explicit opt-in.
- Per-type credential fields (per §5.3, sink side); marked
  `sensitive: true`.
- Sink templating — minimal `{{...}}` substitution per §7.4 +
  §15.17 (locked 2026-05-12: home-brew tokenizer delegating to
  the same `@marcbachmann/cel-js` evaluator as `if:` / `after:`);
  Liquid-style escape (`{{ '{{' }}`). Block 1.3 ships the shared
  tokenizer + evaluator; Block 7.1 just consumes it.

**Files:**
- `src/orchestrator/sinks/transport.ts` — new; `SinkTransport`
  interface (`upload(plan) → SinkResult`) per §15.23 E17.
  v1 ships `HostSdkTransport` only; `ContainerRcloneTransport`
  reserved for v1.x.
- `src/orchestrator/sinks/s3.ts`, `gcs.ts`, `r2.ts` — new;
  provider SDK wrappers with retry / multipart / abort-on-error
  cleanup; implement `SinkTransport` via `HostSdkTransport`.
- `src/orchestrator/sinks/github-pr.ts`, `gitlab-mr.ts`,
  `bitbucket-pr.ts` — new; SDK + git push + empty-diff skip.
- `src/orchestrator/sinks/email.ts` — new; nodemailer wrapper
  with TLS enforcement.
- `src/orchestrator/sinks/slack.ts` — new; home-brew webhook
  POST.
- `src/orchestrator/sinks/webhook.ts` — new; fetch + HMAC
  signing helper.
- `src/orchestrator/sinks/local.ts` — new (renamed from
  `download.ts`); workspace → host copy with overwrite
  enforcement.
- `src/orchestrator/sinks/hmac.ts` — new; HMAC body-signing
  helper shared by `webhook` (and any future provider that
  needs it).
- `src/orchestrator/sinks/templating.ts` — new (minimal `{{ }}`
  substitution).

**Acceptance:**
- Each sink type dispatches against a test fixture (mock S3,
  mock SMTP, etc.).
- Sink failure isolation per §7.5 lean: log + continue;
  sequential by declaration order.
- `webhook` sink with `hmac:` block produces a request whose
  `<header>` value matches the expected HMAC over the body
  using the declared algorithm (per-algorithm test vectors).
  `flavor: 'standard-webhooks'` rejected at validate time
  with v1.x pointer message; `flavor: 'raw'` (default)
  accepted.
- `email` sink rejects `port: 25 + secure: false` at validate
  time; rejects CR/LF in subject / header values.
- `local` sink refuses to write when destination exists and
  `overwrite: false`; succeeds with `overwrite: true`.
- `github-pr` sink skips PR creation cleanly when workspace
  diff is empty.

### 10.2 Week 7.2 — Sink dispatch + `after:` evaluator + cycle detection

**Scope:**
- `after:` discriminator (bare step ref → `<id>.success`
  desugar; otherwise CEL predicate) per §7.3.
- **Discrete-hook re-evaluation model** per §7.3.3:
  - **Hook A** — after each step transition.
  - **Hook B** — after each sink transition (enables
    cross-sink dependencies).
  - **Hook C** — after each source transition.
  - **Hook D** — run-end pass (defensive).
- **FIFO queue** (per §7.3.3.2): at each hook, evaluate all
  pending sinks; append newly-resolvable sinks to the queue
  in declaration order; dispatch queue head. Natural
  serialization of sink→sink dependencies. **Plain array +
  index pointer (~5 LOC)**; v1 has no parallelism (§14.1
  deferred), so a concurrent task-queue library (`p-queue` /
  `p-limit`) is overkill. Pinned per §15.23 E23 Refresh 3.
- **Per-sink terminal state** per §15.10 catalogue
  (`success` / `failed` / `errored` / `skipped`) populates
  `RunArtifact.sinkState[]` (per Block 3.2).
- **`errorMessage`** captured into the run record on
  failed / errored sinks.
- **Cycle detection at validate-time** (per §7.3.3.1 / §9)
  via **`graphology` + `graphology-dag`** (pinned in Block 0.2
  per §15.23 E23 Refresh 3):
  - After the §15.27 step-level-sink flatten, build a
    `DirectedGraph` of sink → sink dependencies.
  - `graphology-dag`'s `hasCycle()` for detection;
    `topologicalSort()` for ordering.
  - Reject any cycle with a location-pointing error citing
    the participating sink IDs.
  - Self-references (`sinks.X.after = sinks.X.success`)
    rejected as trivial cycles.
  - Forward references (declaration-order doesn't match
    dependency direction) are NOT cycles; allowed.
  - Shared with step DAG validation (Block 1.1) and
    subworkflow DAG (Block 9) — single library across all
    three sites.
- `firePolicy:` deferred per §7.5; v1 implicit "at most once."
- Sinks fire from saifctl CLI host (no egress container per
  §14.20); use existing host-side process.

**Files:**
- `src/orchestrator/sinks/dispatcher.ts` — new; FIFO queue +
  hook-driven re-evaluation loop.
- `src/orchestrator/sinks/after-evaluator.ts` — new; CEL
  predicate evaluation against the live source/step/sink
  state.
- `src/specs/workflow/sink-cycle-check.ts` — new; validator-
  time `graphology` + `graphology-dag` cycle detection +
  topological sort over the post-flatten sink list. Thin
  wrapper around the shared DAG primitive (also used by
  step DAG and subworkflow DAG validators).

**Acceptance:**
- Sinks fire at the right time for linear / branching workflows.
- CEL-form `after:` resolves correctly with mixed step states.
- Tests cover skip-cascade (sink referencing a skipped step).
- **Cross-sink chain**: `sinks.upload` → `sinks.notify`
  (after: `sinks.upload.success`) fires `notify` AFTER
  `upload` succeeds.
- **Cross-sink failure routing**: `sinks.alert` with
  `after: 'sinks.upload.failed || sinks.upload.errored'` fires
  exactly when upload fails.
- **FIFO ordering**: a sink declared first but depending on a
  later sink fires LAST (per §7.3.3.2 example).
- **Cycle detection**: self-ref + 2-sink cycle + 3-sink cycle
  all rejected with location pointers at parse time.
- **Forward-reference allowed**: sink A depends on later-
  declared sink B; succeeds at parse time, fires correctly at
  runtime.
- **errorMessage propagation**: a sink whose dispatch fails
  populates `sinks.X.errorMessage`, addressable by downstream
  sinks via interpolation.

### 10.3 Block 7 — risks

- **Sink security catalogue (§15.8 still open).** Mitigation:
  ship v1 with per-type credential fields; security review per
  type happens in §15.8 spike. Block 13 may add hardening if
  catalogue surfaces issues.
- **`firePolicy:` deferred could leak into multi-fire bugs.**
  Mitigation: v1 has no fan-in points (no parallelism, no
  loops), so at-most-once is structurally guaranteed.

---

## 11. Block 8 — Step-level sources (1 week)

**Goal:** per-step ingress per §5.5.

### 11.1 Week 8.1 — Step-level downloader invocation

**Scope:**
- **Leaf-only constraint** per §5.5 / §6.1 table — step-level
  `sources:` accepted only on **leaf** steps; rejected on
  if-wrappers and subworkflow steps at parse time. The schema-
  level rejection lives in Block 1.1 (`validate-step-shape.ts`);
  Block 8 implements the runtime path for the leaf case only.
  Note this is asymmetric with step-level **sinks** (which accept
  both leaf and subworkflow steps per §15.27) — see §15.27
  sources-vs-sinks asymmetry rationale.
- Engine inserts a downloader-container invocation between
  prior step's coder exit and current step's coder start, with
  the step's `sources:` block as `sources.json`.
- Sequential ordering (one container at a time mutates workspace).
- Same security model: post-download cleanup (including
  Block 5.2's `.git/config` deny list with `includeIf.*` /
  `include.path`), separate git commit with author identity,
  per-step `/saifctl/state/sources.json` emission (Block 4.2)
  + host-side merge (Block 5.2).
- DAG-ordering validator: step-level source `{{...}}` refs must
  point at steps that come BEFORE this step.
- `overwrite: true` flag per §5.2 — bypasses workspace-collision
  check.
- **No auto-cleanup** per §5.5: resolved files persist in the
  workspace as normal mutations after the step ends. If the
  user wants files removed, they declare a follow-up sink or
  an additional step.

**Files:**
- `src/orchestrator/step-level-source-driver.ts` — new.
- `src/specs/workflow/validate-dag-order.ts` — extend with
  step-level source ref checks.

**Acceptance:**
- A workflow where step B references step A's exported S3 URL
  and pulls the file into the workspace works end-to-end.
- Forward / self refs are rejected at validate-time.
- A workflow declaring `sources:` on an if-wrapper or
  subworkflow step fails validation at parse time with a
  pointer citing §6.1 (the leaf-only constraint).

---

## 12. Block 9 — Subworkflows + outputs (2 weeks)

**Goal:** external subworkflows and the `outputs:` contract per
§15.12.

### 12.1 Week 9.1 — External subworkflow loader

**Scope:**
- `workflow:` field on step node loads a workflow from a path
  (relative to the current workflow file).
- Recursive validation: loaded workflow validated by the
  same schema; nested CEL scopes per §15.10 ("inputs / steps /
  workflow are scope-local; run is root-scope singleton").
- Static path (literal) vs dynamic path (with `{{...}}`
  interpolation) per §15.25 — load timing differs.
- **Cross-subworkflow step / source / sink ID uniqueness
  validation** (per §15.11). After recursive load completes,
  walk the full parent + descendant tree and reject duplicate
  IDs across any parent / child / sibling subworkflow with a
  location-pointing error. Required because §15.11 specifies
  step IDs are globally unique across the whole workflow
  including inner steps of subworkflows — a check that's
  structurally impossible at top-level schema parse time
  (when subworkflows haven't been loaded yet).
- **Subworkflow DAG built on `graphology`** — the recursive
  tree of parent + descendant workflows is represented as a
  `DirectedGraph` via the shared `dag.ts` wrapper from
  Block 1.4. Cycle detection (a subworkflow that transitively
  loads itself) via `graphology-dag.hasCycle()` with a
  location-pointing error citing the cycle's participating
  workflow file paths. Pinned per §15.23 E23 Refresh 3.
- **Subworkflow input contract bridge AND validation in v1**
  (per workflow-api.md §9 — subworkflow input contract
  enforced in v1, symmetric with root-workflow input
  validation in Block 6).
  - **Bridge mechanism:** parent step's step-level `inputs:`
    block becomes the subworkflow's `inputs.*` map at
    subworkflow entry. Inside the subworkflow, `inputs.<name>`
    resolves against this forwarded map, NOT against the
    parent's input scope. CEL scope reset is part of the
    subworkflow-loader's responsibility (matches the existing
    §15.10 scope-local rule for `inputs.*`).
  - **Validation:** parent's forwarded inputs must satisfy
    the subworkflow's declared `inputs:` schema — every
    required input present, types match the declared
    `value` / `enum` / `secret` type, enum values within the
    declared set, no unknown keys. For static subworkflow
    paths the check runs at parse time alongside subworkflow
    schema validation; for dynamic paths
    (`workflow: "./deploy-{{inputs.env}}.yml"`) the check
    defers to step-execution time per §15.25's three-pass
    model (the subworkflow can't be loaded until the path
    interpolates).
  - **Errors:** symmetric framing with Block 6 root-workflow
    input errors — same message shape, same fix-pointer
    style.

**Files:**
- `src/specs/workflow/subworkflow-loader.ts` — new.
- `src/specs/workflow/cross-subworkflow-id-check.ts` — new;
  global ID-uniqueness walk over the loaded tree.
- `src/specs/workflow/subworkflow-inputs-bridge.ts` — new;
  parent-step `inputs:` → subworkflow `inputs.*` scope reset
  plus declared-schema validation.

**Acceptance:**
- External subworkflow runs end-to-end in a parent.
- Static path loaded at parent validate-time; dynamic at
  run-start / step-execution time per §15.25.
- A parent that declares a step ID also used as a step ID
  inside an external subworkflow fails validation with both
  locations pointed at.
- Same uniqueness rule covers source IDs and sink IDs across
  parent / subworkflow / nested subworkflow.
- Parent step's `inputs:` block populates the subworkflow's
  `inputs.<name>` scope; the subworkflow reads them; the
  parent's own `inputs.*` are NOT visible inside the
  subworkflow.
- Parent forwarding a missing-required input → validate-time
  error pointing at the missing key on the subworkflow side.
- Parent forwarding a string into a `type: number` input →
  validate-time error.
- Parent forwarding an enum value not in the declared
  `values:` set → validate-time error with the declared set
  in the message.
- Dynamic subworkflow path: input-contract check deferred to
  step-execution time; runtime error has the same shape as
  the static check's error.

### 12.2 Week 9.2 — Workflow outputs evaluation

**Scope:**
- `outputs:` block per §15.12: `<id>: { type, value }` (+
  `values:` for enum, `optional:` for opt-out).
- Resolved at workflow-end (after all reachable steps reach
  terminal).
- For subworkflows: outputs become `steps.<stepId>.exports.<output_id>`
  in the parent's namespace.
- For top-level workflows: outputs pin into run record under
  `RunArtifact.workflowOutputs?` (the schema slot from §15.20);
  surface in `saifctl run info <runId>`.
- Inner step exports stay private (no flat-access from parent).
- **Null-permissive single-ref evaluation** per §15.12: when
  `value:` is a single-ref substitution (`value: "{{ inputs.x }}"`)
  and the ref resolves to null, the output is null (no error).
  For multi-string interpolation (`value: "prefix-{{ inputs.x }}"`)
  with a null ref, evaluation errors per §15.25's standard
  null-coercion rule. Documented trade: single-ref outputs
  naturally propagate null; mixed-string outputs fail loudly.
- **Required vs optional output failure** per §15.12: required
  output (default) with null `value:` at workflow-end fails the
  workflow's output evaluation → the workflow itself ends in
  `errored`. For subworkflows this propagates to the parent
  (the subworkflow step transitions to `.errored`). For
  top-level workflows, the run record's status reflects the
  failure. `optional: true` accepts null and propagates as
  null.
- **Secret-typed outputs handling** per §15.12 (Secrets in
  outputs). Validate-time check: parse each output's `value:`
  interpolation as CEL, walk the AST, detect any
  `inputs.<name>` ref where the declared input is
  `type: secret`. When detected:
  - Emit a **validate-time warning** with location pointer
    ("output `<id>` resolves to a secret-typed input;
    the value will be redacted in run-record artifacts and
    `saifctl run info` output").
  - At run-end, redact the resolved value before persisting
    into `RunArtifact.workflowOutputs?` (store the redaction
    marker, not the raw secret).
  - Subworkflow case: parent reads `steps.<subwf>.exports.
    <output_id>` and gets the redacted marker — explicit
    enough that the parent author notices, avoiding a silent
    leak through the cross-workflow contract.
- Block 10 (spec text mitigations) catches the spec-text
  branch of secret-leakage; this is the outputs branch of the
  same secret-handling story.

**Files:**
- `src/orchestrator/workflow-outputs.ts` — new.
- `src/specs/workflow/validate-secret-outputs.ts` — new;
  AST-walk on each output's `value:` interpolation; shares
  the secret-ref-walk module from Block 1.3.
- `src/runs/types.ts` — extend `RunArtifact` with
  `workflowOutputs?:` (matching the §15.20 schema-addition
  enumeration; field name is `workflowOutputs?`, NOT `outputs:`
  — avoids collision with workflow-level `outputs:` block).

**Acceptance:**
- Subworkflow output appears as a step export in the parent.
- Top-level workflow outputs persist in the run record (under
  `RunArtifact.workflowOutputs?`) and show in `saifctl run
  info`.
- Required-output null failure transitions workflow to errored
  per §15.12; subworkflow propagation transitions the parent
  step to `.errored`.
- Optional output (`optional: true`) with null `value:` at
  workflow-end propagates as null without erroring.
- **Null-permissive single-ref evaluation.** `value: "{{ inputs.x }}"`
  with null `inputs.x` resolves to null (no error). The same
  output with `value: "prefix-{{ inputs.x }}"` and null
  `inputs.x` fails with the standard null-coercion error per
  §15.25.
- Output whose `value:` resolves to a `type: secret` input →
  validate-time warning with location pointer.
- Same workflow at run-end: `RunArtifact.workflowOutputs?`
  contains a redaction marker, NOT the raw secret value.
- Subworkflow with a secret-typed output: parent's
  `steps.<subwf>.exports.<output_id>` reads the redaction
  marker (not the raw secret); CEL refs that touch it
  propagate the redaction.

---

## 13. Block 10 — Spec text mitigations + secret-ref validator (1 week)

**Goal:** safe interpolation into spec text per §15.25
mitigations B + D.

### 13.1 Week 10.1 — Tag wrapping + secret-ref validator

**Scope:**
- At step-execution time, before the agent runs:
  - Resolve all `{{...}}` in `spec:` text.
  - Wrap each resolved value in
    `<saifctl_value name="..." type="...">VALUE</saifctl_value>`
    tags per §15.25 mitigation B.
  - Escape any literal `<saifctl_value` in user spec text to
    `&lt;saifctl_value` to preserve unforgeability.
  - Prepend saifctl system-prompt prefix explaining the
    convention to the agent.
- **Mark the system-prompt prefix as a prompt-cache breakpoint**
  per §15.23 G28 Refresh 5. The prefix is identical across
  every workflow run; annotating it with `cache_control:
  { type: 'ephemeral' }` (Anthropic) or the equivalent
  provider-specific cache hint amortises its cost across runs.
  Lives in the agent-invocation layer (where saifctl assembles
  the message stack), not inside `spec-tag-wrapping.ts`
  itself — but tracked here because the prefix shape is
  Block 10.1's responsibility. Cheap perf win; no
  build-vs-reuse trade.
- Secret-ref validator at validate-time per §15.25 mitigation D:
  - Hard-block any `{{...}}` in `spec:` that resolves to a
    `type: secret` input.
  - Warn on `{{...}}` to `type: secret` refs in non-sensitive
    sink/agent-env fields (per §5.3 rules).

**Files:**
- `src/orchestrator/spec-tag-wrapping.ts` — new.
- `src/specs/workflow/validate-secret-refs.ts` — new.

**Acceptance:**
- A workflow that interpolates a non-secret input into spec
  succeeds; the agent sees tagged content.
- A workflow that tries to interpolate a `type: secret` input
  into spec fails at validate-time with a clear error.
- A workflow that uses `type: secret` in a sink message body
  produces a warning but isn't blocked.
- **Prompt-cache annotation on the system prefix verified** —
  the agent invocation includes a `cache_control` (or
  equivalent) marker on the saifctl prefix segment; cache hit
  rate observable in the agent-CLI's telemetry on the second
  workflow run.

---

## 14. Block 11 — CLI commands + `feat run` refactor (2 weeks)

**Goal:** end-user entry points.

### 14.1 Week 11.1 — `saifctl workflow run` / `validate` / `schema`

**Scope (per §10.1):**
- `saifctl workflow run [--workflow <path>]` — kicks off a fresh
  run from a workflow file. Defaults to `./workflow.{json,yml,yaml,ts,mts,cts,js,mjs,cjs,py}` per §12.5
  in CWD.
- `saifctl workflow validate [--workflow <path>]` —
  schema/CEL/DAG validation only; no run.
- `saifctl workflow schema [--workflow <path>]` — parse the
  workflow file and write the **computed workflow schema** as
  canonical JSON to stdout (camelCase, defaults resolved,
  step-level sinks flattened). Same parse pipeline as `run` and
  `validate`; outputs the parsed object instead of executing.
  Useful for inspection / diff / external tooling.
- Accept all input-related flags from Block 6.
- Local-engine fallback (`--engine local`) per §5.4.5.
- Plug into the existing run-storage / artifact persistence
  (`createRunStorage`, etc.).

**Files:**
- `src/cli/commands/workflow.ts` — new (the `workflow run` /
  `workflow validate` / `workflow schema` parent + subcommands).
- `src/cli/index.ts` — register `workflow` subcommand.

**Acceptance:**
- `saifctl workflow run --workflow ./examples/revenue.yml`
  runs an end-to-end workflow.
- `saifctl workflow validate ./examples/revenue.yml` reports
  validation errors without running.
- `saifctl workflow schema ./examples/revenue.yml > out.json`
  produces a JSON file that, when fed back to `workflow
  validate` (e.g. via a Block 13 round-trip test), passes
  identically.

### 14.2 Week 11.2 — `saifctl feat run` / `saifctl feat schema`

**Scope:**
- `feat run --feature <X>` internally:
  1. Loads the feature dir.
  2. If `workflow.{json,yml,yaml,ts,mts,cts,js,mjs,cjs,py}` (per §12.5) exists at the feature root, uses
     it directly (rejecting explicit `sources:` per §10.3).
  3. Else, synthesizes a workflow with one implicit `local`
     source (`source.local({ saveAs: '/' })`) pointing at the
     project working directory; steps derived from the feature's
     `steps/` directory order.
- `feat schema --feature <X>` — same synthesis as `feat run`,
  but writes the computed workflow schema as canonical JSON to
  stdout instead of executing. Matches the output shape of
  `workflow schema`.
- Shares all downstream code with `workflow run`.
- All `feat run` flags continue to work (`--include-dirty`,
  `--agent`, etc.); they map to the synthesized workflow's
  `local` source and `defaults:`.

**Files:**
- `src/cli/commands/feat.ts` — refactor existing `runCommand`
  to delegate to the new workflow runner; add `schemaCommand`
  that reuses the same synthesis pipeline.
- `src/specs/workflow/synthesize-from-feature.ts` — new.

**Acceptance:**
- Existing in-tree features (saifctl's own dogfooding features)
  run unchanged from the user's perspective.
- The synthesized workflow round-trips with the workflow loader.
- Explicit `sources:` in a feature workflow file is rejected.
- `saifctl feat schema --feature <X>` and `saifctl workflow
  schema --workflow <X/workflow.yml>` produce identical JSON when
  the feature has an explicit workflow file.

### 14.3 Block 11 — risks

- **Behavior regressions on existing `feat run`.** Mitigation:
  Block 13 includes a comprehensive regression suite against
  the in-tree features.

---

## 15. Block 12 — Migration + saifdocs update (2 weeks)

**Goal:** existing on-disk artifacts and emitters use the new
shape.

### 15.1 Week 12.1 — In-tree feature migration

**Scope (per §10.2 / §10.5):**
- For every feature dir under `saifctl/features/`:
  - Rename `phases/` → `steps/`.
  - Rename per-step `spec.md` → `README.md`.
  - Merge per-feature `specification.md` + `plan.md` → single
    `README.md` at feature root.
  - Remove `feature.yml` and `phase.yml`.
- Same renames apply to test fixtures that depend on the
  layout.
- All resource IDs (step IDs etc.) renamed to match the
  CEL-compatible grammar (`[a-z][a-z0-9_]*`).
- **Delete legacy `feat phases *` CLI commands.** Per spec §9
  ("Surfaced through `saifctl workflow validate` (rename of
  today's `feat phases validate`)"), the existing
  `feat phases validate` / `feat phases preflight` / etc.
  subcommands at [src/cli/commands/feat-phases.ts](src/cli/commands/feat-phases.ts)
  are removed. Replacement is `saifctl workflow validate`
  (Block 11.1) for hand-written workflows and
  `saifctl feat schema` (Block 11.2) for synthesized feature
  workflows. No alias, no deprecation warning — saifctl is
  single-user (§10.5), the new commands ship from day one of
  v1. Delete the file + test files + CLI registration.

**Files:**
- Every feature directory under `saifctl/features/` —
  renamed/restructured in place.
- Anywhere in the code that references `phases/` /
  `phase.yml` / `feature.yml` for path-shaped lookups.
- `src/cli/commands/feat-phases.ts` + its sibling test files
  (`feat-phases.test.ts`, `feat-phases.preflight.test.ts`) —
  **deleted**.
- `src/cli/index.ts` (or wherever subcommands are registered)
  — remove the `feat phases` registration.

**Acceptance:**
- All existing features still run via `feat run` after the
  migration.
- `git log` shows a single migration commit per feature.
- No `feature.yml` / `phase.yml` files remain in-tree.
- `saifctl feat phases validate` exits with "unknown command"
  (or equivalent help-routed error). `saifctl workflow
  validate` is the documented replacement.
- `rg "feat-phases|feat phases"` against the source tree
  returns no live references (test files and CLI tab-completion
  shim included).

### 15.2 Week 12.2 — Saifdocs update

**Scope:**
- Update saifdocs at `vendor/saifdocs/`:
  - Drop the existing `feature.yml` / `phase.yml` emission.
  - Emit `workflow.yml` into
    `<project>/saifdocs/<timestamp>/workflow.yml` per §10.4.
  - Workflow has a `local` source pointing at `../..`.
  - Steps emitted into `<timestamp>/steps/<n>-<name>/` with
    per-step `README.md` + `tests/`.
- Update saifdocs's compiler / template generator
  ([vendor/saifdocs/src/features/compiler.*]) to produce the
  new shape.

**Files:**
- `vendor/saifdocs/src/features/compiler.*` — extensively
  rewritten.
- `vendor/saifdocs/src/manifest/writer.ts` — possibly updated.
- `vendor/saifdocs/templates/` — new templates.

**Acceptance:**
- A fresh `saifdocs gen` produces a standalone, runnable
  workflow directory under `<project>/saifdocs/<timestamp>/`.
- `saifctl workflow run --workflow <path>` runs the saifdocs-
  emitted workflow.

### 15.3 Block 12 — risks

- **In-tree feature changes mid-migration.** Mitigation: lock
  the feature tree during this week; coordinate with any
  in-flight per-feature work.
- **Saifdocs has external users (none known).** Mitigation: per
  §10.5, no compat layer; if external users exist they migrate
  in place.

---

## 16. Block 13 — Test coverage + bug-bash + polish (2 weeks)

**Goal:** v1 is shippable.

### 16.1 Week 13.1 — Comprehensive e2e tests

**Scope:**
- E2E test for each in-spec example (§11.1 / §11.2 / §11.3 /
  §11.4 / §11.5).
- E2E `workflow schema` / `feat schema` round-trip test (per
  Block 11.1 acceptance): for every example in §11, run
  `saifctl workflow schema --workflow <path> > out.json`, then
  feed `out.json` back into `saifctl workflow validate` —
  expect identical parse result (same canonical JSON, same
  validation outcome). Symmetric test for `saifctl feat
  schema --feature <X>` against features that have both an
  explicit and a synthesized workflow form.
- E2E test for each source type with real fixtures (S3
  localstack, mock GitHub server, local fs).
- E2E test for each sink type (mock S3, mock SMTP, mock Slack
  webhook, mock GitHub API).
- E2E test for the regression: every existing in-tree feature
  runs through the refactored `feat run`.
- E2E test for workflow inputs end-to-end (CLI flags → CEL
  interpolation → agent's spec).
- E2E test for subworkflows (workflow A → calls B → returns
  output → A reads).
- E2E test for `if:` skip cascade.
- E2E test for downloader-container security (malicious
  `.git/hooks/`, oversized clone).
- E2E tests for archive unpacking per §5.4.10:
  - Happy paths: zip / tar / tar.gz / gz over `http`,
    single-object `s3`, and `local`-over-a-file.
  - `auto` detection with correct Content-Type, wrong
    Content-Type (warning), unidentifiable format (clean error).
  - Zip-slip fixture (entry path `../escape`) — refused with
    `traversal-attempt`.
  - Archive-bomb fixture (small archive, huge expansion) —
    refused with `cap-exceeded`.
  - Content-Type-lies fixture (tar.gz served as `text/html`) —
    warning, libarchive verdict wins.
  - Symlink-escape fixture (symlink target outside extraction
    dir) — refused.
- E2E tests for HTTPS-ingress hardening per §5.4.11:
  - Redirect chain >5 hops — refused with full chain in error.
  - `https://` → `http://` redirect — refused
    (`scheme-downgrade`).
  - `file://` / `ftp://` URL — refused (`protocol-forbidden`).
  - Same three tests applied to `git`-clone-based sources
    (`github` / `gitlab` / `bitbucket`).
- E2E tests for HTTP source methods per §15.8:
  - `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD` against mock
    receivers; verify method on the wire.
  - `body:` field with `body-format: json` — receiver
    validates JSON shape.
  - `body:` field with `body-format: raw` — receiver receives
    bytes as-is, no Content-Type override.
  - `query:` map merges into URL query string with proper
    encoding.
  - CRLF in `headers:` value rejected at validate time.
- E2E tests for `webhook` sink HMAC per §15.8:
  - `sha1` / `sha256` / `sha512` signatures match test vectors
    against a reference implementation.
  - `prefix: "sha256="` produces the GitHub-style
    `X-Hub-Signature-256: sha256=<hex>` value.
  - Receiver verifies signature; mutated body fails
    verification.
- E2E tests for `local` sink per §15.8 (renamed from
  `download`):
  - Copy single file from `/workspace/x.pdf` to host
    `/Users/me/x.pdf` succeeds.
  - Copy workspace directory recursively to host path.
  - Existing destination refused with `overwrite: false`;
    succeeds with `overwrite: true`.
- E2E test that `email` sink rejects plaintext SMTP at validate
  time (`port: 25 + secure: false`).
- E2E test that `github-pr` sink skips cleanly when workspace
  diff is empty.
- E2E tests for interpolation engine per §15.17 / §15.25:
  - **Whitespace handling**: `{{x}}` and `{{ x }}` and
    `{{  x  }}` produce identical results.
  - **Multi-line `{{ ... }}`**: a multi-line conditional
    inside `{{ ... }}` evaluates correctly.
  - **Escape**: `{{ "{{" }}` and `{{ "}}" }}` produce literal
    `{{` / `}}` in output.
  - **Single-pass substitution**: a `value` input whose
    value is the literal string `"{{run.id}}"` does NOT get
    re-interpolated when referenced.
  - **List indexing inside `{{ ... }}`**:
    `{{ steps.fetch.exports.tags[0] }}` resolves to the first
    element, string-coerced.
  - **Map bracket indexing**:
    `{{ sources.api.headers["Content-Type"] }}` works (dashes
    in key).
  - **Conditional ternary**: `{{ steps.X.success ? "OK" : "FAIL" }}`
    selects the right branch.
  - **String concat**: `{{ "Bearer " + inputs.api_token }}`
    produces the bearer header (warns since `api_token` is
    secret-typed).
  - **Built-in macros**: `{{ size(steps.X.exports.tags) }}` and
    `{{ has(inputs.optional_flag) }}` work.
  - **BigInt coercion**: `{{ inputs.count + 1 }}` with
    `count: 3` renders as `"4"` (not `"4n"`).
  - **Double coercion**: `{{ inputs.ratio * 2.0 }}` with
    `ratio: 0.5` renders deterministically (snapshot test).
  - **Null result**: `{{ inputs.optional }}` where `optional`
    was not provided fails at interpolation time with a clear
    field-name pointer.
  - **List/map result errors**: `{{ steps.X.exports.config }}`
    (an object export) fails with "object not coercible;
    index/access into it" message.
  - **AST-walk secret detection** — hard-block spec text:
    - `spec: "{{ inputs.api_token }}"` → validate-time error.
    - `spec: "{{ \"Bearer \" + inputs.api_token }}"` → also
      blocked (AST contains secret ref).
    - `spec: "{{ has(inputs.api_token) }}"` → also blocked
      (v1 simplicity).
  - **AST-walk secret detection** — warn-only destinations:
    - `email.subject: "Token: {{ inputs.api_token }}"` →
      warning, allowed.
    - `slack.message: "Got {{ size(inputs.api_token) }} chars"`
      → warning.
  - **Resolution-plan classifier**: an interpolated field whose
    deepest ref is `inputs.*` classifies as run-start time; a
    field with any `steps.<id>.*` ref classifies as
    step-execution time. Snapshot-tested.
  - **Error column-mapping**: a parse error inside
    `{{ inputs.tags[ }}` (missing index) points at the column
    inside the original YAML.
- E2E tests for §15.10 CEL catalogue (sources/sinks):
  - **Source state refs**:
    - `if: 'sources.upload.resolved'` on a step gates correctly
      when the source resolved vs was `if:`-skipped.
    - `{{ sources.dataset.size }}` interpolates the wire byte
      count.
    - `{{ sources.dataset.fileCount }}` after a directory
      source's resolution.
    - `{{ sources.dataset.unpackedSize }}` after an `unpack:`
      source's resolution.
    - `sources.<id>.errorMessage` is null when resolved
      successfully.
  - **Sink state refs (cross-sink chain)**:
    - `after: 'sinks.upload.success'` on a downstream sink
      fires AFTER upload succeeds — never before.
    - `after: 'sinks.upload.failed || sinks.upload.errored'`
      fires only on upload failure.
    - `{{ sinks.upload.errorMessage }}` interpolates the
      upload's error string into a follow-up sink's message
      body.
    - **FIFO ordering test**: declaration order `[notify
      (after upload), upload, alert (after build)]` produces
      fire order `[upload, alert, notify]`.
  - **Sink cycle detection (validator)**:
    - Self-cycle `sinks.X.after = sinks.X.success` rejected
      at parse time with a location pointer.
    - 2-sink cycle `A → B → A` rejected.
    - 3-sink cycle `A → B → C → A` rejected.
    - Forward reference (A declared before B, A depends on B)
      accepted at parse time; fires correctly at runtime.
  - **`workflow.metadata` refs**:
    - `{{ workflow.metadata.name }}` and `{{ workflow.metadata.description }}`
      interpolate correctly.
    - `{{ workflow.metadata.labels["release-channel"] }}`
      bracket notation works for non-identifier keys.
    - `{{ workflow.metadata.annotations.owner }}` dotted form.
  - **Run-record persistence**: after a run, `saifctl run info`
    surfaces `RunArtifact.sourceState[]` and
    `RunArtifact.sinkState[]` with the catalogue fields
    populated correctly.
  - **Unknown-field rejection**: `sources.X.notAField` and
    `sinks.X.notAField` rejected at validate time with column
    pointers.
- E2E tests for tests-block + test-writer per §6.7 / §15.15 / §5.4.12:
  - **`files:` only at step level** — explicit test files are
    discovered by the test runner at that step; pass/fail
    gates the step.
  - **`assert:` only at step level** — test-writer subtask runs
    before impl, generates a `.spec.<ext>` in the right
    profile's syntax, test runner discovers and runs it.
  - **`files:` + `assert:` combined** — test runner sees both
    as a unified set; both must pass.
  - **`none: true`** — no test-runner subtask emitted for this
    step.
  - **`none: true` + `files:`/`assert:`** — validator rejects
    at parse time.
  - **Workflow-level `tests:`** — one test-writer subtask
    emitted at front of subtask list (for `assert:` content);
    generated file in `__generated_tests__/__workflow__/`.
    Cumulative scope: this file appears in every step's
    test runner.
  - **Cumulative scope across steps** — workflow with steps
    A, B, C and step-level tests A-tests, B-tests, C-tests
    plus workflow-tests: test runner at step A sees
    workflow-tests + A-tests; at step B sees workflow-tests
    + A-tests + B-tests; at step C sees all four.
  - **Profile resolution** — `tests:` without
    `config.test.profile` set anywhere in the chain → error
    at validate time.
  - **Profile resolution from defaults** — `tests:` set at
    step level, `config.test.profile` set only in workflow
    `defaults:` → resolves correctly through the chain.
  - **Test-writer prompt context** — verify the test-writer
    agent receives profile description + template files +
    helper file contents (not just profile id).
  - **Per-profile test generation** — same `assert:` text
    with `config.test.profile: node-vitest` produces vitest
    syntax; with `python-pytest` produces pytest syntax;
    with `go-gotest` produces go-test syntax.
  - **Cedar policy enforcement** — impl-agent's write to
    `/workspace/.saifctl/__generated_tests__/<scope>/*`
    is denied by Leash; test-writer's write succeeds.
  - **runCommit attribution** — `git log` shows test-writer's
    commits with `saifctl-test-writer <saifctl-test-writer@safeaifactory.com>`
    author identity.
  - **Author guidance regression** — workflow-level `assert:`
    that references a file produced only at step 3 fails at
    step 1's test runner (the file doesn't exist yet) — this
    is the documented "place tests at the right level" pattern,
    NOT a bug.
  - **Legacy `tests.profile:` rejection** — workflow that
    sets `tests.profile:` (legacy v0 field) errors at parse
    time with pointer to `config.test.profile`.
- E2E tests for lockstep validators across the workflow
  `defaults:` ↔ step `config:` merge per spec §9 +
  per-phase-config §6.9:
  - **Agent lockstep — split across merge levels.** Workflow
    sets `defaults.agent.profile: claude`; step sets
    `config.agent.install: <openhands install script>` with
    no profile override. Neither layer is mismatched on its
    own; the merge IS. Validator surfaces the §6.9 agent
    lockstep warning, pointing at both source locations.
  - **Sandbox-profile lockstep — defaults-only.** Workflow
    sets `defaults.container.sandboxProfileId: node-pnpm` and
    `defaults.container.image: <unrelated python image>`;
    validator surfaces the §6.9 sandbox lockstep warning at
    the `defaults:` location.
  - **Gate-retries lockstep — step-only.** Step sets
    `config.gate.retries: 5` with no agent-install override;
    validator surfaces the §6.9 gate-retries warning.
  - **No-lockstep happy path.** Each lockstep group with a
    coherent setting at one or both levels passes cleanly
    (no warning, no error). Severity check: a Level-1 lockstep
    miss is a warning (not a parse error).
- E2E tests for step-level sinks per §15.27:
  - Implicit `after:` — sink declared under `steps[N].sinks[0]`
    fires on `<parent>.success`.
  - Explicit CEL `after:` — `after: 'steps.<self>.failed ||
    steps.<self>.errored'` fires only on parent failure.
  - Validator warning when CEL `after:` doesn't reference the
    parent step.
  - **Flatten correctness** — same workflow authored two ways
    (step-level sinks vs equivalent workflow-level sinks)
    produces structurally identical canonical JSON. Round-trip
    determinism.
  - **Source-location preservation** — a validation error in
    a step-level sink points at the original
    `steps[N].sinks[M]` position, not the post-flatten
    `sinks[K]` position.
  - **ID collision cases**: step-level vs workflow-level same
    ID; step-level vs sibling step's step-level sink; two
    step-level sinks with the same ID on the same step. All
    three rejected with location-pointing errors.
  - **If-wrapper rejection** — `sinks:` declared on an
    if-wrapper fails validation at parse time.
  - **Subworkflow case** — step-level sink on a `workflow:`
    step fires after the subworkflow's terminal state. CEL
    refs in the sink's `after:` / message body resolve against
    the parent's scope (`steps.<subwf>.exports.<output_id>`
    works; `steps.<inner_step_id>` fails — inner steps are
    private per §15.12).
- E2E tests for step-kind source restrictions per §6.1 / §5.5:
  - **Leaf accepts `sources:`** — already covered by Block 8
    fixtures.
  - **If-wrapper rejects `sources:`** — workflow declaring
    `sources:` under an if-wrapper fails validation at parse
    time with a fix-pointer citing the §6.1 table.
  - **Subworkflow step rejects `sources:`** — workflow
    declaring `sources:` under a `workflow:` step fails
    validation with the same fix-pointer style. Confirms the
    leaf-only-in-v1 constraint from §5.5.
- E2E tests for §15.8 newly-enumerated validators:
  - **Anonymous-fetch warning** — `s3` source with no
    credentials surfaces a validate-time warning; `s3` source
    with credentials does not. Same for `gcs`, `r2`, and
    git-shaped sources.
  - **`.git/config` deny list — `includeIf` / `include.path`** —
    a malicious-fixture `.git/config` with
    `[includeIf "gitdir:/etc"]` or `[include]\npath = …`
    fails Block 5.2 cleanup with a clear pointer to §15.8
    class rule #10.
- E2E test for **`default:` on `type: secret`** — workflow
  declaring `inputs: { api_token: { type: secret, default: "..." } }`
  fails validation with the §15.24 fix-pointer.
- E2E test for **multi-flag / comma-separated `--input-file`** —
  two-file precedence resolves deterministically; comma-separated
  paths inside one flag value match the multi-flag result.

**Files:**
- `test/integration/workflow-*.test.ts` — new.

### 16.2 Week 13.2 — Bug-bash + polish

**Scope:**
- All known issues from Blocks 1–12 swept.
- Documentation pass: every error message reviewed for
  actionability (per §15.7 framing: real errors, not magical
  detection).
- Performance check: workflow validate < 100 ms, schema parse <
  50 ms, downloader image pull warm < 2 s.
- Final security review against §15.8 catalogue (as much as
  it's pinned).
- **NEW docs page: "Secrets management" concept page** per
  §15.23 G30 Refresh 5. Documents the composition patterns for
  using `--input-secret` / `--input-secret-file` with external
  secret brokers (HashiCorp Vault, AWS Secrets Manager, GCP
  Secret Manager, SOPS, Doppler, 1Password CLI, direnv / mise
  / activated venvs). Examples for each broker showing the
  shell-pipe pattern. Lives at
  `docspec/products/saifctl/concepts/secrets.md` (or the
  closest matching path in the saifdocs concept tree). Goal:
  prevent users from assuming a built-in broker integration is
  needed before they discover the composition pattern works.
- **NEW docs page: "Run record as observability source"** per
  §15.23 H32 Refresh 6. Documents that the `RunArtifact`
  (already persisted per §14.18 + §15.20) is v1's structured
  event log — every step transition, source state, sink state,
  export, error, and timing is captured. Anyone wanting
  Datadog / Honeycomb / OpenTelemetry can write a post-hoc
  adapter that reads the artifact and emits spans; no engine
  instrumentation is needed for v1. Real-time emission (a
  `RunObserver` interface) is a planned v1.x boundary —
  flagged in §14.10, NOT shipped in v1. Lives at
  `docspec/products/saifctl/concepts/observability.md` (or
  the closest matching path).
- Documentation acceptance: a reader new to saifctl can find
  the secrets concept page from the workflow-inputs reference,
  pick a broker matching their stack, and copy-paste a working
  command pattern. A reader looking for "how do I monitor a
  workflow run" finds the observability concept page and the
  `RunArtifact` schema reference.

### 16.3 Block 13 — risks

- **Spike outputs may land after v1.** Mitigation: any spike
  (§15.21 / §15.26) that finishes during Block 13 gets noted
  but doesn't block v1 ship. v1.x / v2 picks them up. §15.20
  is resolved design — schema groundwork ships in Block 3.2;
  CLI / truncation logic in v1.x.

---

## 17. Test approach (cross-cutting)

### 17.1 Layers

- **Unit tests** per file in each block — Zod schemas, CEL ops,
  interpolation rules, state-machine transitions. ~95% line
  coverage target.
- **Integration tests** per block — driver invokes the block's
  output end-to-end against fixtures.
- **E2E tests** in Block 13 — full `saifctl workflow run`
  invocations against multi-source / multi-sink workflows.
- **Property tests** for predicate evaluation (state-machine
  determinism, idempotence on re-evaluation).

### 17.2 Fixtures

- A fixture workflow directory per spec example.
- A "malicious-source" fixture: tarball with planted
  `.git/hooks/post-checkout` — for §5.4.3 cleanup tests.
- A "secret-injection-attempt" fixture: workflow that tries to
  interpolate `type: secret` into spec text — for §15.25
  mitigation D tests.

### 17.3 Local-engine vs docker-engine

- Most tests run against the docker engine (the primary path).
- Local-engine fallback gets its own (smaller) test suite
  validating that source resolution still works host-side per
  §5.4.5.

---

## 18. Risks, unknowns, sequencing notes

### 18.1 Risks

1. **Open spec items.** Most §15 spike items are now resolved
   (§15.8 / §15.10 / §15.14 / §15.15 / §15.17 / §15.20 / §15.24
   / §15.25 / §15.26 / §15.27 / §15.28 all ✅ as of 2026-05-13).
   The one active spike (§15.23 build-vs-reuse audit) is on the
   Block 0 critical path; if it surfaces a library choice that
   changes Block 1 / 4 / 7 plans, blocks shift accordingly.
   §15.18 (internal phase→step code-symbol rename) is tracked as
   a separate work-package, not blocking v1.
2. **CEL evaluator viability.** If `cel-js` proves inadequate,
   Block 1.2 slips. Mitigation: Block 0 smoke test.
3. **Cross-language schema drift between TS and Python SDKs.**
   Mitigation: codegen from JSON Schema.
4. **Existing `feat run` regression.** Block 11.2 + Block 13
   regression suite both target this.
5. **Tmpfs / `docker cp` cross-platform.** Docker Desktop on
   macOS / Windows has tmpfs emulation that may have quirks.
   Mitigation: Block 5.1 tests against both macOS and Linux.
6. **Downloader image build/publish pipeline.** Block 4.1 is
   substantial because of the digest-pinning + supply-chain
   considerations. Mitigation: don't gate Block 4.2+ on a
   perfect pipeline; ship the image manually for development.

### 18.2 Hidden complexity

- **Predicate evaluation under skip cascade.** Block 1.4 covers
  the model, but real workflows surface corner cases that
  property tests should catch.
- **Resolution plan determinism.** Block 1.3 outputs a
  resolution plan that the engine must follow exactly; snapshot
  tests are mandatory.
- **Subworkflow schema caching.** Block 9.1 should cache parsed
  static subworkflows to avoid re-parsing every step.
- **Git-commit author identity for downloader vs agent.**
  Block 5.2 needs to not collide with existing
  `apply-patch.ts` author detection.

### 18.3 Sequencing notes

- **Build vs reuse audit (Block 0)** strongly informs Block 4
  (image base) and Block 7 (sink libs). Don't skip it.
- **§15.20 resume is resolved design**, not a spike. The eight
  `RunArtifact` schema additions enumerated in §15.20 of
  workflow-api.md land in Block 3.2 (six fields) + Block 6
  (`RunArtifact.inputs?`) + Block 9 (`RunArtifact.workflowOutputs?`)
  as forward-compatible groundwork; the `--resume-from
  <runId>:<stepId>` CLI plus hash-and-warn validation plus
  `runCommits` truncation are v1.x work on top of this v1
  schema.
- **Tests precede implementation** within each block where
  practical — schema-first, then loader, then validator, etc.
- **Migration (Block 12) lands last.** If anything in Blocks
  1–11 changes the workflow schema, Block 12 absorbs it.
  Saifdocs shouldn't be touched before the schema is locked.
- **Don't ship until Block 13.** Even though Block 11 produces
  a usable CLI, the cumulative quality bar (security
  cleanup, e2e fixtures, regression suite) only gets met in
  Block 13.

---

## 19. What v1 ships

When all 13 blocks complete:

- `saifctl workflow run` / `saifctl workflow validate` /
  `saifctl workflow schema` — authoritative workflow entry points.
- `saifctl feat run` / `saifctl feat schema` — backwards-
  compatible sugar; same UX as today, internally synthesized as
  a workflow.
- `saifctl run start <runId>` — **unchanged** (resume-by-ID per
  spec §10.1). Continues to work against existing run artifacts;
  not extended to take a workflow file (that's `workflow run`'s
  job). Listed here for completeness — no Block changes the
  existing command's behaviour.
- YAML, TypeScript SDK, and Python SDK as three authoring surfaces;
  all produce identical canonical JSON. YAML is the most natural
  authoring form; SDKs are typed builders (Patterns A + B per
  §12.1).
- `workflow-schema.json` (JSON Schema definition) generated from
  the Zod source-of-truth and shipped in the SDK packages.
- `schemaVersion: 1` — single-integer major version axis;
  strict-on-unknown-fields at parse.
- Downloader container — saifctl-owned, digest-pinned;
  populates `/workspace/` from declared sources.
- Source types: `github` / `gitlab` / `bitbucket` (full + `path:`
  selector + hardened HTTPS clone flags), `s3` / `gcs` / `r2`
  (file + prefix; via `rclone`), `http` (all HTTP methods +
  body + query + HMAC-friendly headers), `local` (file or dir;
  symmetric `unpack:` support). All single-file-shaped sources
  accept `unpack:` (zip / tar / tgz / gz / auto / false) per
  §5.4.10.
- Sink types: `s3` / `gcs` / `r2` / `github-pr` / `gitlab-mr` /
  `bitbucket-pr` / `email` (TLS-enforced) / `slack` (incoming
  webhook v1) / `webhook` (with optional `hmac:` body signing)
  / `local` (symmetric with `local` source).
- Workflow inputs with CLI flags + null-permissive semantics.
- Workflow outputs surfaced in run record + parent's exports
  namespace (subworkflows).
- CEL DSL for `if:` / `after:` / `{{...}}` interpolation per
  §6.5 / §7.3 / §15.25.
- Spec text mitigations B + D (tag wrapping + secret-ref
  validator) per §15.25.
- Per-step config (existing per-phase-config v1) carries
  through unchanged.
- External subworkflows with explicit `outputs:` contract per
  §15.12.
- Step-level sources per §5.5.
- Saifdocs emits standalone workflow directories.
- All in-tree features migrated to the new shape.

---

## 20. What v1 does NOT ship (tracked for v1.x)

- For-loops, inline group nodes, parallelism.
- Triggers (cron / webhook).
- Resource budgets / runaway protection.
- Observability primitives (OTel, structured logs, event stream).
- HITL approval steps.
- **Resume-from-specific-step CLI** (v1.x). The schema
  groundwork — the eight `RunArtifact` fields enumerated in
  §15.20 of workflow-api.md — DOES ship in v1 (Block 3.2 six
  fields / Block 6 inputs? / Block 9 workflowOutputs?). Both
  CLI surfaces from §15.20 are deferred: `--resume-from
  <runId>:<stepId>` (explicit step pick) and
  `--resume-from-last-success <runId>` (sugar that auto-picks
  the last `success` subtask). Plus the hash-and-warn
  modified-step validation and `runCommits` truncation logic
  that both flags share.
- **"Snappiness" optimisations for resume** (v1.x; spec §15.21):
  long-lived coder container per run, pre-warm coder pool,
  pre-rendered tarball snapshots alongside `runCommits`.
  Cross-platform (Mac OK); cheaper engineering than CRIU.
- **Container snapshotting (CRIU / podman checkpoint)** — **v2**,
  alongside Mode 4 cloud control-plane execution. Linux-only;
  serves live container migration in cloud worker fleets, not
  the §15.20 resume case (which the git-commit-delta filesystem
  snapshot already covers).
- Sink-side container (egress).
- Saifctl-internal phase → step code-symbol rename (separate
  work-package).
- **SDK Pattern C** (typed cross-references like `extract.success`
  returning a typed CEL handle per spec §12.1). v1 ships
  Patterns A + B only; Pattern C deferred to v1.x.
- Vault / AWS Secrets Manager / SOPS / Doppler integration (spec
  §13.2 vault management). v1 reads secrets via CLI flags / env;
  vault integration needs a control plane.
- Inline `script:` step kind (spec §13.2). Non-AI shell-only
  steps as an escape hatch; ships when a clear v1.x user need
  surfaces.

Tracking in §13.2 + the open-questions §14 of workflow-api.md.

---

## 21. Cross-references

- [`workflow-api.md`](./workflow-api.md) — the spec this plan
  builds toward.
- [`product-shape.md`](./product-shape.md) — the four-mode
  vision; this plan delivers Mode 1 + Mode 2 surfaces.
- [`per-phase-config/design.md`](../per-phase-config/design.md) —
  Phase 1 work; shipped; this plan layers on top.
- [Build-vs-reuse audit](../../../docs/contributing/architecture/workflow-api-build-vs-reuse.md)
  — Block 0 output; informs library choices.
