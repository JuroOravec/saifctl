# Command: cache

Manage disposable sandbox workspace directories under `/tmp/saifctl/sandboxes/`.

The temp root `/tmp/saifctl/` is shared with other saifctl state (e.g. `/tmp/saifctl/bin/` for Argus). The `cache` command only touches the sandboxes subdirectory and never modifies the temp root itself.

```
saifctl cache <list|clear> [options]
```

## Subcommands

### `cache list`

List sandbox entries in the sandbox base directory. By default, results are scoped to the current project (derived from `package.json` in the project directory).

```
saifctl cache list [options]
```

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--all` | | boolean | `false` | List entries for all projects instead of only the current one |
| `--project` | `-p` | string | _(from package.json)_ | Override the project name used for filtering. Ignored when `--all` is set. |
| `--project-dir` | | string | `process.cwd()` | Directory containing `package.json`. Ignored when `--all` is set. |
| `--sandbox-base-dir` | | string | `/tmp/saifctl/sandboxes` | Directory to list entries from |

### `cache clear`

Remove sandbox entries from the sandbox base directory. By default, only entries for the current project are removed.

```
saifctl cache clear [options]
```

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--all` | | boolean | `false` | Remove all entries in the base directory, not just the current project's |
| `--project` | `-p` | string | _(from package.json)_ | Override the project name used for filtering. Ignored when `--all` is set. |
| `--project-dir` | | string | `process.cwd()` | Directory containing `package.json`. Ignored when `--all` is set. |
| `--sandbox-base-dir` | | string | `/tmp/saifctl/sandboxes` | Directory to remove entries from |

**Safety guard:** `cache clear --all` is refused when `--sandbox-base-dir` resolves to `/tmp/saifctl/` (the temp root). This prevents accidentally wiping shared state such as `bin/`. Pass `--sandbox-base-dir` pointing at a sandboxes directory, not the temp root.

## Usage examples

**List sandbox entries for the current project:**

```bash
saifctl cache list
```

**List all sandbox entries across all projects:**

```bash
saifctl cache list --all
```

**List entries for a named project in a custom directory:**

```bash
saifctl cache list --project my-project --sandbox-base-dir /mnt/scratch/sandboxes
```

**Remove sandbox entries for the current project:**

```bash
saifctl cache clear
```

**Remove all sandbox entries:**

```bash
saifctl cache clear --all
```

**Remove entries for a specific project:**

```bash
saifctl cache clear --project my-project
```
