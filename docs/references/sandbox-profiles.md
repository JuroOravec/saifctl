# Sandbox Profiles

A sandbox profile defines the tech stack (language + package manager) for a coder container. It controls the default Docker image, startup script, stage script, and gate script used by the orchestrator. Every setting can be overridden individually via CLI flags.

**Default profile:** `node-pnpm-python`

---

## Selecting a profile

```bash
# Use a named profile
saifctl run --profile node-pnpm-python

# Use a custom image instead of a shipped profile
saifctl run --coder-image my-registry/my-image:tag
```

Pass `--profile <id>` to select any profile from the table below. To use a fully custom sandbox, supply `--startup-script`, `--stage-script`, and `--coder-image` without `--profile`.

---

## Profile inventory

| ID                               | Display name              | Default image tag                         |
| -------------------------------- | ------------------------- | ----------------------------------------- |
| `go`                             | Go                        | `saifctl-coder-go:latest`                 |
| `go-node`                        | Go + Node.js              | `saifctl-coder-go-node:latest`            |
| `go-node-python`                 | Go + Node.js + Python     | `saifctl-coder-go-node-python:latest`     |
| `go-python`                      | Go + Python               | `saifctl-coder-go-python:latest`          |
| `node-bun`                       | Node.js + Bun             | `saifctl-coder-node-bun:latest`           |
| `node-bun-python`                | Node.js + Bun + Python    | `saifctl-coder-node-bun-python:latest`    |
| `node-npm`                       | Node.js + npm             | `saifctl-coder-node-npm:latest`           |
| `node-npm-python`                | Node.js + npm + Python    | `saifctl-coder-node-npm-python:latest`    |
| `node-pnpm`                      | Node.js + pnpm            | `saifctl-coder-node-pnpm:latest`          |
| `node-pnpm-python` **(default)** | Node.js + pnpm + Python   | `saifctl-coder-node-pnpm-python:latest`   |
| `node-yarn`                      | Node.js + Yarn            | `saifctl-coder-node-yarn:latest`          |
| `node-yarn-python`               | Node.js + Yarn + Python   | `saifctl-coder-node-yarn-python:latest`   |
| `python-conda`                   | Python + Conda            | `saifctl-coder-python-conda:latest`       |
| `python-conda-node`              | Python + Conda + Node.js  | `saifctl-coder-python-conda-node:latest`  |
| `python-pip`                     | Python + pip              | `saifctl-coder-python-pip:latest`         |
| `python-pip-node`                | Python + pip + Node.js    | `saifctl-coder-python-pip-node:latest`    |
| `python-poetry`                  | Python + Poetry           | `saifctl-coder-python-poetry:latest`      |
| `python-poetry-node`             | Python + Poetry + Node.js | `saifctl-coder-python-poetry-node:latest` |
| `python-uv`                      | Python + uv               | `saifctl-coder-python-uv:latest`          |
| `python-uv-node`                 | Python + uv + Node.js     | `saifctl-coder-python-uv-node:latest`     |
| `rust`                           | Rust                      | `saifctl-coder-rust:latest`               |
| `rust-node`                      | Rust + Node.js            | `saifctl-coder-rust-node:latest`          |
| `rust-node-python`               | Rust + Node.js + Python   | `saifctl-coder-rust-node-python:latest`   |
| `rust-python`                    | Rust + Python             | `saifctl-coder-rust-python:latest`        |

---

## Profile file structure

Each profile ships five files used by the orchestrator:

| File               | Purpose                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `Dockerfile.coder` | Image for both the coder and staging containers                           |
| `startup.sh`       | Installs workspace dependencies (runs in both containers)                 |
| `stage.sh`         | Starts the app, or keeps the container alive for CLI-only projects        |
| `gate.sh`          | Validates the workspace after each agent round (language-specific checks) |
| `profile.ts`       | TypeScript metadata — `id`, `displayName`, `coderImageTag`                |

---

## Overriding profile settings

Individual profile settings can be overridden at runtime without changing the profile:

| CLI flag                  | Overrides                          |
| ------------------------- | ---------------------------------- |
| `--coder-image <tag>`     | Default image tag from the profile |
| `--startup-script <path>` | `startup.sh` from the profile      |
| `--stage-script <path>`   | `stage.sh` from the profile        |
| `--gate-script <path>`    | `gate.sh` from the profile         |

To use a fully custom sandbox not based on any shipped profile, supply all three flags together and omit `--profile`.

---

## Profile metadata

Each profile exposes three fields:

| Field           | Type                        | Description                                               |
| --------------- | --------------------------- | --------------------------------------------------------- |
| `id`            | `SupportedSandboxProfileId` | Profile identifier used in `--profile`                    |
| `displayName`   | `string`                    | Human-readable name                                       |
| `coderImageTag` | `string`                    | Default Docker image tag for coder and staging containers |
