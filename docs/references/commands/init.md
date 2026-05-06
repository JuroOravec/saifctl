# `saifctl init`

Bootstrap SaifCTL metadata in a consumer repo (e.g. `saifctl/` directory). Run once when adopting the tool in a new project.

## Synopsis

```
saifctl init [options]
saifctl init tests [options]
```

## Description

`saifctl init` scaffolds `saifctl/config.ts` (when absent) and `saifctl/tests/` from the resolved test profile's templates (when absent), then optionally runs the codebase indexer.

`saifctl init tests` re-scaffolds **only** `saifctl/tests/`. Use this when switching test profile, refreshing after a template upgrade, or initialising tests in an existing repo where `saifctl/config.ts` is already present.

### Idempotency

- `config.{ts,js,cjs,mjs,json,yaml,yml}` is skipped when any existing variant is found. `--force` rewrites to `config.ts`.
- Helper, infra, and example files are skipped per-file when present. `--force` overwrites.

### Cross-language guard (`init tests`)

If `saifctl/tests/` already contains another profile's helpers (e.g. `helpers.py` when `--test-profile=node-vitest`), the command refuses without `--force`. This prevents mixed-language test directories that no single test runner can handle.

## Options

### `saifctl init`

| Flag | Alias | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `--project` | `-p` | string | No | `package.json` `name` | Project name override for the indexer. |
| `--project-dir` | | string | No | current directory | Project directory. |
| `--saifctl-dir` | | string | No | `saifctl` | Path to the saifctl config directory. |
| `--indexer` | | string | No | none | Indexer profile. Pass `shotgun` to use Shotgun, or `none` to disable. |
| `--test-profile` | | string | No | `node-vitest` | Test profile id. |
| `--force` | `-f` | boolean | No | `false` | Overwrite existing config / helpers / infra / example files. |

### `saifctl init tests`

| Flag | Alias | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `--project` | `-p` | string | No | `package.json` `name` | Accepted for CLI consistency; not used by `init tests`. |
| `--project-dir` | | string | No | current directory | Project directory. |
| `--saifctl-dir` | | string | No | `saifctl` | Path to the saifctl config directory. |
| `--test-profile` | | string | No | `node-vitest` | Test profile id. |
| `--force` | `-f` | boolean | No | `false` | Overwrite existing helpers / infra / example files. |

### Test profile resolution

`--test-profile <id>` → `config.defaults.testProfile` → `node-vitest`

## Examples

**Bootstrap a new project** (creates `saifctl/config.ts` and `saifctl/tests/`):

```bash
saifctl init
```

**Bootstrap with a specific test profile**:

```bash
saifctl init --test-profile node-vitest
```

**Bootstrap and index the codebase with Shotgun**:

```bash
saifctl init --indexer shotgun
```

**Force-overwrite an existing config and test scaffold**:

```bash
saifctl init --force
```

**Re-scaffold tests only** (useful after switching profile):

```bash
saifctl init tests --test-profile node-vitest
```

**Force-switch an existing tests dir to a different profile**:

```bash
saifctl init tests --test-profile node-vitest --force
```
