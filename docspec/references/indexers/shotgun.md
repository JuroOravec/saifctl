---
source: src/indexer-profiles/shotgun/profile.ts
type: cli-command
---

[Shotgun](https://github.com/shotgun-sh/shotgun) is an **optional** codebase indexer. When `--indexer shotgun` is passed (typically with `saifctl init` and/or `saifctl feat design`), Shotgun parses the repository into a semantic graph so agents can answer questions like "where is auth handled?" or "what ORM does this project use?" with real file paths and code references instead of guesses. Requires Python 3.11+ and `shotgun-sh` (`pip install shotgun-sh` or `uv sync`). The index is built automatically by `saifctl init --indexer shotgun`. Note: Shotgun also serves as a spec designer (`--designer shotgun`); see `references/designers/shotgun.md` for that role.
