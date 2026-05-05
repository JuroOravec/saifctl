---
source: scripts/docker.ts
type: cli-command
---

Inventory of saifctl-published Docker images on `ghcr.io/safe-ai-factory/saifctl/<image>:<tag>`. Reference page documents: registry path, tag conventions (`:latest` vs `:vX.Y.Z`), full per-family image list (coder + test), multi-arch support (linux/amd64, linux/arm64), pre-pull commands, override flags (`--coder-image`, `--test-image`), and a pointer to the publish workflow. Build-tooling source: `scripts/docker.ts` (handles `--push`, `--platforms`, `--image-prefix`, `--extra-tag`).
