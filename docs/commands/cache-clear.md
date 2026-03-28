# saifctl cache clear

Remove sandbox entries for this project (--all: everything).

Deletes factory sandbox entries under `/tmp/saifctl/sandboxes/` by default (or a custom `--sandbox-base-dir`). Does not touch `/tmp/saifctl/bin/` or other siblings. By default removes only entries for the current project (from `package.json` name). Use `--all` to remove every entry in the sandbox base directory. If `--sandbox-base-dir` resolves to `/tmp/saifctl` (the temp root), `clear --all` is refused so shared caches are not wiped.

## Usage

```bash
saifctl cache clear [options]
```

## Arguments

| Argument             | Alias | Type    | Description                                              |
| -------------------- | ----- | ------- | -------------------------------------------------------- |
| `--all`              | —     | boolean | Remove entries for all projects                          |
| `--project`          | `-p`  | string  | Project name override (default: `package.json`)          |
| `--sandbox-base-dir` | —     | string  | Sandbox base directory (default: `/tmp/saifctl/sandboxes`) |

## Examples

Remove sandbox entries for the current project:

```bash
saifctl cache clear
```

Remove sandbox entries for all projects:

```bash
saifctl cache clear --all
```

Remove sandbox entries or specific project:

```bash
saifctl cache clear -p my-project
```

Use a custom sandbox base directory:

```bash
saifctl cache clear --sandbox-base-dir /var/cache/factory
```

## What it does

1. Resolves the sandbox base dir (default: `/tmp/saifctl/sandboxes`)
2. If `--all`: removes all entries in the base dir
3. Otherwise: removes only entries matching `<project>-*` (project from `package.json` or `--project`)
4. Prints each removed entry path
