---
persona: engineer
prereq_concepts: []
learns_concepts:
  - features
  - feat-run-loop
  - gate-reviewer-holdout
goal: Build a feature in saifctl from an empty directory by adding files in the order they're needed, learning the spec-driven model as the layout grows
---

Tutorial intent: this is the canonical introduction to spec-driven development in saifctl, framed as a progressive disclosure of the feature directory layout. Distinct from the goal-oriented `spec-to-pr` tutorial (which races through "spec → PR") — this one walks more slowly and explains _why_ each file appears.

Approximate structure (subject to refinement when the agent generates the page):

1. **What spec-driven development means in saifctl.** One paragraph: the user writes the spec + tests, the agent writes the code, saifctl drives the agent through a gauntlet until everything passes. Nothing about feature.yml or critics yet.

2. **Anatomy of a feature directory.** Show the layout as it grows:
   - Empty: `saifctl/features/<name>/` (just an empty dir).
   - Add `specification.md` — the precise behaviour contract. Point at `SKILL.md` §4 for the recommended sections; do not duplicate them here.
   - Add `tests/` — visible test cases. Mention the staging tests vs. holdout tests distinction (cross-link to `concepts/gate-reviewer-holdout.md`).
   - That's the minimum viable feature — `saifctl feat run` works at this point.

3. **Walkthrough: building a small feature end-to-end.** Concrete example: a small change like "add a `--json` flag to an existing CLI command". Show:
   - `mkdir saifctl/features/add-json-flag/`
   - Write `specification.md` (3-5 lines is enough for a tiny feature).
   - Write `tests/01-json-flag.spec.ts` (or similar) with one or two test cases.
   - Run `saifctl feat run add-json-flag`.
   - Observe the agent's progress — explain that it's looping through Gate → Reviewer → Holdout until pass.
   - When it finishes: open the PR / branch.

4. **Optional: feature.yml.** When you want to override defaults — different agent, different model per role, different max-runs, different storage. Show a 5-line example. Cross-link to the config reference.

5. **Optional: phased features.** When the feature is too big to converge in one shot. Brief intro to:
   - `phases/01-…/spec.md` (one subdir per phase).
   - `feature.yml` declaring phase order + critics.
   - `critics/<id>.md` (adversarial review templates that run after each phase's gate).
   - Pointer to `saifctl/features/_phases-example/` (the runnable annotated example) and `_phases-and-critics/` for depth. Don't try to teach phases comprehensively here — that's `_phases-example/`'s job.

6. **Running it.** `saifctl feat run <name>`. Mention the live progress output and what each line means (gate pass, reviewer pass, etc.).

7. **Observing it.** `saifctl run inspect <runId>` for stepping into the agent's container; the VS Code sidebar for tree navigation. Cross-link `how-tos/inspect-and-start.md` for the deeper how-to.

8. **Where to go next.** Pointers to:
   - `SKILL.md` (the reference manual for agents driving the workflow — denser, more prescriptive).
   - `saifctl/features/_phases-example/` (annotated phased feature with the full contract surface).
   - `saifctl/features/_phases-and-critics/` (smaller phased example focused on critics).
   - `concepts/feature-lifecycle.md` (the proposal → design → build → ship arc).

**Tone**: explanatory, not prescriptive. The reader is _evaluating_ saifctl and wants to understand what working with it looks like, not following commands. Examples should be tiny — the page should fit comfortably on one scroll for the minimum-viable section, expanding only when introducing optional concepts.

**Cross-links to use**: `concepts/features.md` (the feature dir as a concept), `concepts/feat-run-loop.md` (what feat run does internally), `concepts/gate-reviewer-holdout.md` (the gauntlet), `references/commands/feat.md` (CLI surface), `how-tos/run-first-feature.md` (companion goal-oriented how-to).

**Resolves release-readiness/DOC-08** (saifctl release-readiness specification §3.4). Was pending as a hand-written `docs/spec-driven-development.md`; routed through release-readiness/DOC-09 as a saifdocs-generated tutorial instead, per the locked release-readiness/DOC-09 plan.
