# Branding

## Naming conventions

- Product name: SaifCTL
- CLI name: `saifctl`

Example: *SaifCTL* is documented here; use `saifctl run start` to launch a run.

### Product name

Use **SaifCTL** when the name appears as a **proper noun** for the tool or product:

- Landing page headlines and hero copy
- Prose in docs when referring to “the tool” rather than a shell invocation

Do **not** use **SAIFCTL** in user-facing text. All-caps reads as shouting and does not match common patterns for `*ctl` tools.

### CLI name

Use **`saifctl`** (all lowercase) for:

- The published binary name
- Shell examples, install instructions, and any place the user types the command

```bash
saifctl run start
saifctl run inspect
```

### Rationale

- Lowercase matches Unix convention for executables and matches what people type.
- **SaifCTL** signals a kubectl-style control tool without renaming the binary.
- Splitting display vs CLI avoids awkward typography (e.g. “SaifCTL” in a `$` prompt block).

When in doubt: **headlines and prose → SaifCTL; commands and backticks → `saifctl`.**

### Repo layout

- **Project metadata directory** in a consumer repo: `saifctl/` (Cosmiconfig module `saifctl`, default `--saifctl-dir saifctl`).
- **Local run state**: `.saifctl/` (e.g. `.saifctl/runs/`).

Defensive **tombstone** packages for the unscoped names `safe-ai-factory` and `saifctl` live under `npm-tombstones/`; see `npm-tombstones/README.md` for publish steps.

## Messaging

Applies to: landing page, CLI help, docs, in-product copy.

### Concision

- Be **concise**: no filler, no repeated points.
- Don’t state what’s **already implied** by context or the line before.

### Happy paths

- Name the main journeys (install, first run, typical workflows).
- Each doc and the landing page should make the **next step** obvious; improve structure before adding edge cases.

**Optional `doc-meta` block** — For markdown under `docs/`, you may record happy-path hints in an HTML comment at the **very top** of the file (before the first heading). It does not render in normal Markdown preview, unlike YAML frontmatter.

Use a fixed prefix `doc-meta:` so editors and scripts can grep for it (`doc-meta`).

```markdown
<!--
doc-meta:
  happy-paths: [isolation, extract]
  out-of-scope: [sandbox]
  next: sandbox.md
  audience: end-users
-->

# Title
```

| Key | Purpose |
| --- | --- |
| `happy-paths` | Main journeys this doc supports (free-form list). |
| `out-of-scope` | Features/concepts that are out of scope for this doc (free-form list). |
| `next` | Suggested follow-on doc; path relative to the `docs/` directory (e.g. `sandbox.md`, `commands/feat-run.md`). |
| `audience` | Who the page is for (e.g. `end-users`, `contributors`). |

Add more keys only if they stay stable and useful across the tree. Omit the whole block when a page does not need structured hints.

### Plain language

- Prefer plain words; introduce a necessary term once.
- Don’t lead with internals or rare cases (e.g. long notes on errors when storage is `none`—put those in reference or troubleshooting).

### Value proposition

Lead with **outcome** (“run AI agents safely”), not **category** (“open source orchestrator for autonomous AI agents”). Hero: what you do and why, not ecosystem labels.

| Avoid | Prefer |
|-------|--------|
| “This is an open source orchestrator for autonomous AI agents.” | “Run AI agents safely.” |
