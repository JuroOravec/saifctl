# Contributing

Thanks for your interest in contributing to this repo. It holds shared Cursor configuration (agents, skills, rules) and imports projects as nested git clones.

## How to report bugs

Open an issue, include:

- What went wrong (skills not triggering, rules ignored, etc.)
- Steps to reproduce
- Your environment (Cursor version, OS)

## How to propose features

Open an issue, describe the problem you're solving and how you'd like it to work.

## Development setup

1. Clone the root repo:

   ```bash
   git clone https://github.com/safe-ai-factory/saifctl.git
   cd agents
   ```

2. See [docs/development/](docs/development/) for info on this project.

## Pull request process

1. Fork the repo.
2. Create a branch from `main`.
3. Make your changes.
4. Open a PR against `main`.
5. Describe what you changed and why.

There is no build or test at root — changes to agents, skills, and rules are markdown/config. Nested projects have their own CI; if you change files inside a nested project, follow that project's contribution guidelines.

## Code style

This repo uses [EditorConfig](.editorconfig) for basics (indent, line endings). Markdown files should stay readable and consistent.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
