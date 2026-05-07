# Contributing to saifctl

`docs/contributing/` is the source of truth for everything below — this
file is the entry door, not the manual. Start with
[`docs/contributing/README.md`](docs/contributing/README.md).

## Reporting bugs

Open a [GitHub issue](https://github.com/safe-ai-factory/saifctl/issues/new).
Include:

- What you expected vs. what happened.
- Steps to reproduce (a minimal `saifctl feat run` invocation is ideal).
- Your environment: `saifctl --version`, OS, Node version, Docker
  version. `saifctl doctor` output is the fastest way to capture the
  preflight state.

For security vulnerabilities, follow [`SECURITY.md`](SECURITY.md) — do
not open public issues.

## Proposing features

Open a [GitHub issue](https://github.com/safe-ai-factory/saifctl/issues/new)
describing the problem you're solving and the rough shape of the
change. Wait for a maintainer's reply before opening a PR for anything
beyond a small fix — the discussion on the issue is where scope and
approach get aligned.

## Dev setup

```bash
git clone https://github.com/safe-ai-factory/saifctl.git
cd saifctl
git submodule update --init --recursive  # vendor/argus, vendor/leash, vendor/saifdocs
pnpm install
pnpm run check                            # lint + typecheck + tests; same script CI runs
```

Requirements: Node 22 LTS, pnpm 9+, Docker. See
[`docs/contributing/README.md`](docs/contributing/README.md) for the
full day-to-day dev loop.

## Branch + PR conventions

| Step              | Convention                                                                     |
| ----------------- | ------------------------------------------------------------------------------ |
| Branch from       | `main`                                                                         |
| Branch name       | `<type>/<short-slug>` — e.g. `feat/run-resume-fix`, `docs/contributing-rewrite` |
| Commit message    | imperative mood, present tense (`fix: ...`, `feat: ...`, `docs: ...`)          |
| PR title          | mirrors the commit-message convention                                          |
| PR body           | what changed + why; link issues with `Fixes #NNN` / `Refs #NNN`                |
| Pre-merge check   | `pnpm run check` must pass; CI runs the same script                            |

Squash-merge to `main` is the default; the PR title becomes the squash
commit message, so write it carefully.

## Code style

Tooling enforces most of it:

- [`.editorconfig`](.editorconfig) — indent, line endings.
- [`.prettierrc`](.prettierrc) — formatting; run `pnpm run format`.
- [`eslint.config.js`](eslint.config.js) — lint; run `pnpm run lint`.
- [`pnpm run check`](package.json) — bundles lint + typecheck + tests.

Architectural conventions (file layout, naming, where new code goes)
live in [`docs/contributing/architecture/`](docs/contributing/architecture/).

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
