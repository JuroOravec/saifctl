# `_phases-example/` — worked example for phased features (Blocks 4 + 4b + per-phase-config)

This directory is **not** a real feature. The `_` prefix tells `saifctl`'s
feature discovery to skip it (see `src/specs/discover.ts`). It exists as a
runnable, copy-pasteable reference for the full Block 1–4 contract plus the
per-phase-config v1 lifecycle levels:

- a `feature.yml` declaring critic selection and per-phase defaults,
- multiple `phases/<id>/` dirs each with their own `spec.md`,
- per-phase `phase.yml` overrides — each one demonstrates a different
  lifecycle level (cost class) so the file shape doubles as a reference
  card for the per-phase-config groups (`gate`, `agent`, `container`,
  `runner`, `limits`, `tests.none`):
  - `01-validate-input/` — no overrides; inherits `feature.yml` defaults
    (the baseline three critics, `tests.mutable: false`).
  - `02-emit-output/` — overrides the inherited critic list (replaces; no
    key-level merge) AND adds a Level-1 `gate.script: stricter-gate.sh`
    override. Level-1 fields rewrite a file the live container reads each
    inner round — free per round (no restart). The end-state-defining
    phase deserves a second pass of `paranoid` and a stricter gate.
  - `03-codegen/` — declares `tests.none: true` (Level-4 routing) for the
    pure-output case: the runner is bypassed for this phase. Feature- and
    project-level tests still gate at the run's last phase via the
    cumulative scope, so end-state contracts always run somewhere. See
    `how-to pure-output-phase`.
  - `04-tighten/` — Level-1.5 fast path: `agent.model` swap to a cheaper
    model and `agent.reviewer: false` to skip the semantic reviewer. Both
    fields land on the per-subtask env file (`<saifctlPath>/subtask-env.sh`)
    that the long-lived coder container sources each inner round — no
    container restart.
- three `critics/<id>.md` templates that between them exercise every
  documented mustache variable plus the `{{> file <path>}}` partial:
  - `strict.md` — drift / nuance / shortcut detection (uses the partial).
  - `paranoid.md` — security-first, focused on cross-tenant access and
    silent failures.
  - `audit.md` — the daily-driver fusion of the two; the template the
    project author actually runs against lesser-model output (also uses
    the partial).

For the lifecycle-cost model see `concept per-phase-config`. For the
standalone minimal `tests.none` walkthrough see
`saifctl/features/_phases-pure-output-example/`.

This is a doc-only example; it intentionally **does not ship**
`phases/<id>/tests/` directories. Compile output references those paths
because that's the production shape, but the test runner skips missing
dirs silently. A real feature would put assertions there.

## What `saifctl feat run _phases-example` would do (if it weren't skipped)

The compiler would emit, in order (per Block 4b each critic round = a
discover/fix pair, so `rounds: N` ⇒ `2N` subtasks per critic per phase):

```
phase:01-validate-input impl
phase:01-validate-input critic:strict   round:1/1 discover
phase:01-validate-input critic:strict   round:1/1 fix
phase:01-validate-input critic:paranoid round:1/1 discover
phase:01-validate-input critic:paranoid round:1/1 fix
phase:01-validate-input critic:audit    round:1/1 discover
phase:01-validate-input critic:audit    round:1/1 fix
phase:02-emit-output    impl
phase:02-emit-output    critic:strict   round:1/1 discover
phase:02-emit-output    critic:strict   round:1/1 fix
phase:02-emit-output    critic:paranoid round:1/2 discover
phase:02-emit-output    critic:paranoid round:1/2 fix
phase:02-emit-output    critic:paranoid round:2/2 discover
phase:02-emit-output    critic:paranoid round:2/2 fix
phase:03-codegen        impl
phase:03-codegen        critic:strict   round:1/1 discover
phase:03-codegen        critic:strict   round:1/1 fix
phase:04-tighten        impl
phase:04-tighten        critic:strict   round:1/1 discover
phase:04-tighten        critic:strict   round:1/1 fix
```

Things to notice:

- **`paranoid` runs twice on phase 02** because `phases/02-emit-output/phase.yml`
  overrides the inherited critic list with `rounds: 2` — the end-state-defining
  phase deserves a second adversarial pass.
- **`audit` does NOT run on phase 02 / 03 / 04.** Each of their `phase.yml`
  files REPLACES the inherited list (per §5.3 — no key-level merge);
  `audit` is in the feature-level list but not in any override, so it's
  dropped. Add `{ id: audit }` to a phase's override if you want it. This
  asymmetry is the canonical worked example of the override-replaces gotcha.
- **Phases 03 / 04 trim critics down to `strict` only** for readability —
  the point of those phases is the per-phase-config override, not the
  critic surface; trimming keeps the compiled subtask sequence small.
- **Phase 03's runner is bypassed** because `tests.none: true` is set; you
  won't see "running staging tests" output for that phase even though the
  critic discover/fix subtasks still drive the loop.
- **Phase 04 uses a different LLM model** — `agent.model: 'openai/gpt-4o-mini'`
  parses as a globalModel override (no `=` ⇒ single bare value applies to
  every agent unless an `agent=value,...` form names a more specific override).
  Assuming no other run-level or phase-level model overrides, the coder's
  `LlmConfig.fullModelString` resolves to `openai/gpt-4o-mini` and the
  per-subtask env file is rewritten with `LLM_MODEL=openai/gpt-4o-mini` at
  the phase boundary; `coder-start.sh` re-sources it on the next inner
  round, so no container restart fires.

This sequence is locked by `src/specs/phases/phases-example.integration.test.ts`
— if it drifts the test fails.

## Mustache variables — closed set

Critic templates can reference these (and only these). Anything else throws
`CriticPromptRenderError` at runtime — typos surface loudly instead of
quietly producing empty strings.

| Variable              | Example                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `feature.name`        | `_phases-example`                                                              |
| `feature.dir`         | `saifctl/features/_phases-example`                                             |
| `feature.plan`        | `/workspace/saifctl/features/_phases-example/plan.md`                          |
| `phase.id`            | `01-validate-input`                                                            |
| `phase.dir`           | `/workspace/saifctl/features/_phases-example/phases/01-validate-input`         |
| `phase.spec`          | `/workspace/saifctl/features/_phases-example/phases/01-validate-input/spec.md` |
| `phase.baseRef`       | `abc1234` (git rev at start of phase impl — runtime-captured)                  |
| `phase.tests`         | `/workspace/saifctl/features/_phases-example/phases/01-validate-input/tests`   |
| `critic.id`           | `paranoid`                                                                     |
| `critic.round`        | `1`                                                                            |
| `critic.totalRounds`  | `2`                                                                            |
| `critic.step`         | `discover` (or `fix`) — see "Discover/fix split" below                         |
| `critic.findingsPath` | `/workspace/.saifctl/critic-findings/01-validate-input--paranoid--r1.md`       |

## Discover/fix split

Each critic round compiles to **two subtasks**: a `discover` step that finds
issues and writes them to `{{critic.findingsPath}}`, and a `fix` step that
reads the file, applies fixes, and deletes the file. User templates
(`critics/<id>.md`) are rendered ONLY for the discover step. The fix step
uses a saifctl-owned built-in template.

For `rounds: N`, you get `N` discover-fix pairs (`2N` subtasks). Both
subtasks in a pair share the same `findingsPath` so the fix step can read
what discover wrote. Different rounds get different paths so re-runs don't
collide.

## File partial

`{{> file <workspace-relative-path>}}` inlines a file's contents inside a
fenced code block. The path is relative to `/workspace`. Three layers of
sandbox-escape guard:

1. Template-side: `..` segments and absolute paths are rejected at render time, before the resolver is called (see `substitutePartials` in `src/specs/phases/critic-prompt.ts`).
2. Resolver-side: the host-side reader canonicalises both root and target
   via `realpath` and refuses any path that resolves outside the sandbox
   (blocks the agent from planting a symlink to `/etc/passwd`).
3. Missing files throw — never silently produce an empty fence.

Use sparingly — for short, always-needed preambles only. See
`critics/strict.md` for a real usage; it pulls in `_preamble.md`.

### Authoring partial files (preambles, snippets, etc.)

The partial inlines the file's contents **verbatim** into the LLM prompt,
inside a fenced code block. Two consequences worth knowing:

1. **The agent sees everything you put in the file.** Don't include
   author-aimed HTML comments (`<!-- ... -->`), editorial notes, or
   commentary about the partial mechanism itself — the LLM reads them
   alongside the actual instructions and may treat them as guidance.
   Keep partial files to direct content only (rules, conventions,
   reference text the agent should act on). The `_preamble.md` in
   this dir is intentionally minimal for this reason.

2. **Partial content is text, not a template.** Mustache tokens inside
   an inlined file (`{{phase.id}}`, etc.) render as literal text — they
   are NOT substituted with runtime values. This is deliberate: it means
   a referenced file can't accidentally trigger render errors via stale
   tokens, and it keeps the partial mechanism a one-way pipe (template
   pulls from file, never the other direction). If you need a variable
   in the inlined section, put it in the _template_ before/after the
   `{{> file ...}}` partial, not in the file itself.

A practical implication: if your partial file mentions partial syntax in
prose (e.g. documenting how the partial works), that prose ships into
every prompt that uses it. Either avoid mentioning the syntax, or
extract the doc-aimed prose into a sibling README that isn't inlined.
