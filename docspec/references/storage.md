---
source: src/storage/index.ts
type: config-schema
---

Run storage backends. A run's metadata, patches, and sandbox state are persisted to a backend so users can inspect, resume, fork, or apply later. Backends:

- **`local`** (default) — `.saifctl/runs/` under the project root. Zero setup, single-developer use.
- **`file://<path>`** — local filesystem at an arbitrary path. Useful for shared NFS mounts.
- **`s3://<bucket>/<prefix>`** — S3 (or compatible). Requires AWS credentials in env.
- **`none`** — disable run storage entirely. `saifctl sandbox` defaults to this; useful for ephemeral / single-shot runs.

Reference page documents URI parsing, env-var auth, the per-backend feature support matrix (e.g. which backends support `run inspect` reattach), and the `--storage` CLI flag. The `runs=…` shorthand is also accepted (saifdocs should disambiguate from `--storage`).
