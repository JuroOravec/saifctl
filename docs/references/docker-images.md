# Docker Images Reference

saifctl publishes pre-built container images to the GitHub Container Registry. This page documents the registry path, image families, tag conventions, multi-arch support, and the build tooling flags used to produce them.

---

## Registry

All images are published to:

```
ghcr.io/safe-ai-factory/saifctl/<image>:<tag>
```

---

## Tag Conventions

| Tag       | Meaning                                          |
| --------- | ------------------------------------------------ |
| `:latest` | Most recent published build                      |
| `:vX.Y.Z` | Pinned release (pushed via `--extra-tag vX.Y.Z`) |

Both tags are pushed in the same `docker buildx` invocation when `--extra-tag` is supplied.

---

## Image Families

### Coder Images

Coder images run the AI agent and the staging container. Each image corresponds to a sandbox profile.

**Local tag pattern:** `saifctl-coder-<profile-id>:latest`

| Profile ID           | Display Name                        | Local Tag                                 |
| -------------------- | ----------------------------------- | ----------------------------------------- |
| `go`                 | Go                                  | `saifctl-coder-go:latest`                 |
| `go-node`            | Go + Node.js                        | `saifctl-coder-go-node:latest`            |
| `go-node-python`     | Go + Node.js + Python               | `saifctl-coder-go-node-python:latest`     |
| `go-python`          | Go + Python                         | `saifctl-coder-go-python:latest`          |
| `node-bun`           | Node.js + Bun                       | `saifctl-coder-node-bun:latest`           |
| `node-bun-python`    | Node.js + Bun + Python              | `saifctl-coder-node-bun-python:latest`    |
| `node-npm`           | Node.js + npm                       | `saifctl-coder-node-npm:latest`           |
| `node-npm-python`    | Node.js + npm + Python              | `saifctl-coder-node-npm-python:latest`    |
| `node-pnpm`          | Node.js + pnpm                      | `saifctl-coder-node-pnpm:latest`          |
| `node-pnpm-python`   | Node.js + pnpm + Python _(default)_ | `saifctl-coder-node-pnpm-python:latest`   |
| `node-yarn`          | Node.js + Yarn                      | `saifctl-coder-node-yarn:latest`          |
| `node-yarn-python`   | Node.js + Yarn + Python             | `saifctl-coder-node-yarn-python:latest`   |
| `python-conda`       | Python + Conda                      | `saifctl-coder-python-conda:latest`       |
| `python-conda-node`  | Python + Conda + Node.js            | `saifctl-coder-python-conda-node:latest`  |
| `python-pip`         | Python + pip                        | `saifctl-coder-python-pip:latest`         |
| `python-pip-node`    | Python + pip + Node.js              | `saifctl-coder-python-pip-node:latest`    |
| `python-poetry`      | Python + Poetry                     | `saifctl-coder-python-poetry:latest`      |
| `python-poetry-node` | Python + Poetry + Node.js           | `saifctl-coder-python-poetry-node:latest` |
| `python-uv`          | Python + uv                         | `saifctl-coder-python-uv:latest`          |
| `python-uv-node`     | Python + uv + Node.js               | `saifctl-coder-python-uv-node:latest`     |
| `rust`               | Rust                                | `saifctl-coder-rust:latest`               |
| `rust-node`          | Rust + Node.js                      | `saifctl-coder-rust-node:latest`          |
| `rust-node-python`   | Rust + Node.js + Python             | `saifctl-coder-rust-node-python:latest`   |
| `rust-python`        | Rust + Python                       | `saifctl-coder-rust-python:latest`        |

### Test Runner Images

Test runner images execute the test suite inside an isolated container.

**Local tag pattern:** `saifctl-test-<profile-id>:latest`

| Profile ID                | Language   | Framework  | Local Tag                               |
| ------------------------- | ---------- | ---------- | --------------------------------------- |
| `node-vitest` _(default)_ | TypeScript | Vitest     | `saifctl-test-node-vitest:latest`       |
| `node-playwright`         | TypeScript | Playwright | `saifctl-test-node-playwright:latest`   |
| `python-pytest`           | Python     | pytest     | `saifctl-test-python-pytest:latest`     |
| `python-playwright`       | Python     | Playwright | `saifctl-test-python-playwright:latest` |
| `go-gotest`               | Go         | go test    | `saifctl-test-go-gotest:latest`         |
| `go-playwright`           | Go         | Playwright | `saifctl-test-go-playwright:latest`     |
| `rust-rusttest`           | Rust       | cargo test | `saifctl-test-rust-rusttest:latest`     |
| `rust-playwright`         | Rust       | Playwright | `saifctl-test-rust-playwright:latest`   |

---

## Multi-Arch Support

Images published via `--push` are built as multi-platform manifests using `docker buildx`. Supported platforms:

- `linux/amd64`
- `linux/arm64`

Pass both platforms with `--platforms linux/amd64,linux/arm64` when publishing.

---

## Pre-Pulling Images

Pull an image before running to avoid cold-start delays:

```bash
# Pull the default coder image
docker pull ghcr.io/safe-ai-factory/saifctl/saifctl-coder-node-pnpm-python:latest

# Pull a specific test runner image
docker pull ghcr.io/safe-ai-factory/saifctl/saifctl-test-node-vitest:latest
```

---

## Runtime Override Flags

Pass these flags to `saifctl feat run` to use a custom or locally built image instead of the default:

| Flag            | Type   | Description                          |
| --------------- | ------ | ------------------------------------ |
| `--coder-image` | string | Override the coder/staging image tag |
| `--test-image`  | string | Override the test runner image tag   |

```bash
# Use a locally built coder image
saifctl feat run --coder-image saifctl-coder-node-pnpm-python:latest

# Use a locally built test image
saifctl feat run --test-image saifctl-test-node-vitest:latest
```

---

## Build Tooling (`scripts/docker.ts`)

The `pnpm docker` script builds and manages factory images locally or pushes them to the registry.

### Usage

```
pnpm docker <action> [image] [options]
```

### Subcommands

#### `build test`

Build test runner image(s).

```bash
# Build the default test runner image (node-vitest)
pnpm docker build test

# Build all test runner images
pnpm docker build test --all

# Build a specific profile
pnpm docker build test --test-profile python-pytest

# Build with a custom local tag
pnpm docker build test --test-image my-test-runner:local
```

| Flag              | Type    | Default       | Description                                                                   |
| ----------------- | ------- | ------------- | ----------------------------------------------------------------------------- |
| `--all`           | boolean | false         | Build all test profiles                                                       |
| `--test-profile`  | string  | `node-vitest` | Test profile to build                                                         |
| `--test-image`    | string  | —             | Override the local image tag                                                  |
| `--skip-existing` | boolean | false         | Skip build if the tag already exists locally                                  |
| `--push`          | boolean | false         | Push to registry via buildx (multi-arch manifest)                             |
| `--platforms`     | string  | `linux/amd64` | Comma-separated platforms for `--push`                                        |
| `--image-prefix`  | string  | —             | Registry prefix, required with `--push`                                       |
| `--extra-tag`     | string  | —             | Additional tag pushed alongside `:latest`                                     |
| `--dry-run`       | boolean | false         | With `--push`: build for all platforms but skip the push and manifest inspect |

#### `build coder`

Build coder image(s).

```bash
# Build the default coder image (node-pnpm-python)
pnpm docker build coder

# Build all coder images
pnpm docker build coder --all

# Build a specific sandbox profile
pnpm docker build coder --profile node-npm

# Build with a custom local tag
pnpm docker build coder --coder-image my-coder:local
```

| Flag              | Type    | Default            | Description                                                                   |
| ----------------- | ------- | ------------------ | ----------------------------------------------------------------------------- |
| `--all`           | boolean | false              | Build all sandbox profiles                                                    |
| `--profile`       | string  | `node-pnpm-python` | Sandbox profile to build                                                      |
| `--coder-image`   | string  | —                  | Override the local image tag                                                  |
| `--skip-existing` | boolean | false              | Skip build if the tag already exists locally                                  |
| `--push`          | boolean | false              | Push to registry via buildx (multi-arch manifest)                             |
| `--platforms`     | string  | `linux/amd64`      | Comma-separated platforms for `--push`                                        |
| `--image-prefix`  | string  | —                  | Registry prefix, required with `--push`                                       |
| `--extra-tag`     | string  | —                  | Additional tag pushed alongside `:latest`                                     |
| `--dry-run`       | boolean | false              | With `--push`: build for all platforms but skip the push and manifest inspect |

#### `clear`

Remove factory containers, images, and networks. Scoped to the current project by default.

```bash
# Remove resources for the current project
pnpm docker clear

# Remove all factory resources (all projects)
pnpm docker clear --all

# Override the project name
pnpm docker clear --project my-project
```

| Flag        | Alias | Type    | Default             | Description                                      |
| ----------- | ----- | ------- | ------------------- | ------------------------------------------------ |
| `--all`     | —     | boolean | false               | Remove all factory resources across all projects |
| `--project` | `-p`  | string  | from `package.json` | Project name override                            |

### Publishing Example

Build and push all coder images for both architectures, tagging as `:latest` and `:v1.2.0`:

```bash
pnpm docker build coder --all \
  --push \
  --platforms linux/amd64,linux/arm64 \
  --image-prefix ghcr.io/safe-ai-factory/saifctl \
  --extra-tag v1.2.0
```

Validate the build without pushing (dry-run):

```bash
pnpm docker build coder --all \
  --push \
  --dry-run \
  --platforms linux/amd64,linux/arm64 \
  --image-prefix ghcr.io/safe-ai-factory/saifctl
```

### Constraints

- `--skip-existing` cannot be combined with `--push` (no local image is created when pushing).
- `--coder-image` / `--test-image` cannot be combined with `--push`; use the canonical tag instead.
- `--dry-run` requires `--push`; without it the flag has no effect.

---

## Publish Workflow

Images are published automatically by the CI/CD publish workflow. See `.github/workflows/publish-images.yml` for the workflow definition.
