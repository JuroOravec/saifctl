# saifctl init

Initialize Saifctl config. Optionally builds a codebase index. One-time setup.

If you're using a codebase indexer, pass `--indexer <id>` to initialize it. See [Indexers](../indexer/README.md) for available profiles.

## Usage

```bash
saifctl init [options]
```

## Arguments

| Argument        | Alias | Type   | Description                                                                 |
| --------------- | ----- | ------ | --------------------------------------------------------------------------- |
| `--project`     | `-p`  | string | Project name override (default: `package.json` "name")                    |
| `--saifctl-dir`  | —     | string | Path to saifctl directory (default: `saifctl`)                              |
| `--project-dir` | —     | string | Project directory (default: current directory)                              |
| `--indexer`     | —     | string | Indexer profile. Omit or `none` → no indexing. `shotgun` → Shotgun setup + index. |

## Examples

Basic init (uses `package.json` name as project):

```bash
saifctl init
```

Override project name:

```bash
saifctl init -p my-project
```

Init and build the [Shotgun](../indexer/shotgun.md) codebase index:

```bash
saifctl init --indexer shotgun
```

Use a custom project directory:

```bash
saifctl init --project-dir ./packages/my-app
```

## Environment variables

When using the [Shotgun](../indexer/shotgun.md) indexer:

| Variable           | Required | Description                                                                                                      |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `SHOTGUN_PYTHON`   | no       | Path to the Python binary that has `shotgun-sh` installed (default: `python`). Example: `$(uv run which python)` |
| `CONTEXT7_API_KEY` | no       | API key for Context7 documentation lookup inside Shotgun.                                                       |

## What it does

1. Scaffolds `saifctl/config.ts` (if no config exists).
2. Initializes codebase indexer if specified. See [Indexers](../indexer/README.md) for more details.

## Generated config

When no config exists, `saifctl init` creates `saifctl/config.ts`. Example:

```typescript
import type { SaifctlConfig } from 'safe-ai-factory';

const config: SaifctlConfig = {
  defaults: {
    // project: 'my-app',
    // indexerProfile: 'shotgun',
  },
  environments: {
    coding: {
      provider: 'none',
      agentEnvironment: {},
    },
    staging: {
      provider: 'none',
      app: {
        sidecarPort: 8080,
        sidecarPath: '/exec',
        // baseUrl: 'http://staging:3000',
        // build: { dockerfile: './Dockerfile.staging' },
      },
      appEnvironment: {},
    },
  },
};

export default config;
```
