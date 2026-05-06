# Feature lifecycle

A feature in saifctl moves through four stages — **proposal**, **design**, **build**, and **ship** — each driven by a specific command or convention. Understanding this progression tells you where your work lives, what guarantees apply, and when to split a feature into phases.

## The four stages

| Stage | What happens | How it's driven |
|---|---|---|
| **Proposal** | You decide what to build and write a spec | Your editor; no saifctl command yet |
| **Design** | Specs and TDD tests are placed in the feature directory | Convention: `saifctl/features/<feature-id>/` |
| **Build** | `saifctl feat run` drives an agent through the convergence loop until every gate passes | `saifctl feat run --feature <feature-id>` |
| **Ship** | The agent's patch is promoted to a branch and a PR is opened | Automatic on a passing build (if PR creation is enabled) |

You spend your time on proposal and reviewing the finished PR. Everything in between — writing code, fixing failures, passing the reviewer — is the agent's job.

## Single-phase vs. phased features

Most features fit in a single phase: one spec, one test suite, one convergence run, one PR. That is the default.

A feature warrants phases when any of the following applies:

- **Large scope** — the change is large enough that an agent building it in one pass would be navigating too much uncertainty at once. Splitting into phases gives each step a tighter, verifiable goal.
- **Staged delivery** — earlier phases establish a stable foundation (a new data model, an API contract) that later phases build on. Each phase freezes that foundation before the next begins.
- **Intermediate adversarial review** — you want a critic to evaluate each increment rather than reviewing the entire change at the end. Critics run after each phase, not only at the end of the feature.

If none of these apply, a single phase is simpler and faster.

## How phased builds work

When a feature directory contains a `phases/` subdirectory, `saifctl feat run` runs the convergence loop once per phase in declaration order. A phase's gate must pass — including all its critic rounds — before the next phase begins.

### Test scope accumulates

Each phase's gate runs against the union of:

- Tests in `phases/<earlier-phase-id>/tests/` for every completed phase
- Tests in `phases/<current-phase-id>/tests/` for the active phase
- Tests in `tests/` at the feature root — **final phase only**
- Tests in `<saifctlDir>/tests/` (project-level tests) — **final phase only**

This means later phases cannot silently break earlier ones. If the agent's changes in phase three cause a phase-one test to fail, the phase-three gate catches it. Regressions are caught mechanically, not by memory or convention.

Feature-root and project-level tests are withheld from intermediate phases deliberately. Those tests describe end-state contracts — the complete, finished state of the feature and the project. An intermediate phase may be mid-migration: APIs are being restructured, data models are in transition, and the end-state contracts cannot yet pass. Requiring them to pass at every step would force the agent to complete the entire change in a single phase, defeating the purpose of phasing. Only the final phase — where the full change must be in place — gates on these broader contracts.

### One PR for the whole feature

Phased execution is an implementation detail of the build stage. Reviewers see a single PR with the complete diff. The fact that the feature was built phase-by-phase does not fragment the review or create a chain of PRs — the agent accumulates changes and the final promotion happens once, after all phases pass.

## The mutability gate

By default, `saifctl feat run` runs in `--strict` mode. In this mode, saifctl treats spec and test files as immutable: if an agent round modifies them, the round is rolled back and the agent is penalised.

This prevents the agent from changing the rules it is being evaluated against — deleting a failing test to make the gate green, for example, or weakening a spec to justify a shortcut.

To allow the agent to modify specs and tests (for example, during a phase that is explicitly meant to refine tests), pass `--no-strict`. Use this deliberately; the default exists for a reason.

## Related pages

- [The `feat run` convergence loop](feat-run-loop.md) — how the gate, reviewer, and holdout tests interact within a single loop iteration
<!-- reference/feat-run.md — forthcoming -->
<!-- how-to/define-phased-feature.md — forthcoming -->
