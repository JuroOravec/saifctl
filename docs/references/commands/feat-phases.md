# Command: feat phases

Inspect or validate a feature's phase compilation without running it. Requires the feature to have a `phases/` subdirectory.

```
saifctl feat phases <compile|validate> [options]
```

> **Note:** the `list` subcommand is not yet available in this release.

## Subcommands

### `feat phases validate`

Validate a phased feature without running anything. Runs the same schema validation, file-existence checks, and mutability resolution that `feat run` performs as a pre-flight. Prints warnings (non-blocking) and errors; exits 1 on errors.

```
saifctl feat phases validate [options]
```

| Flag            | Alias | Type   | Default               | Description                                                 |
| --------------- | ----- | ------ | --------------------- | ----------------------------------------------------------- |
| `--feature`        | `-e`  | string | _(prompted)_          | Feature name (kebab-case). Prompts with a list if omitted.  |
| `--project-dir` |       | string | `(current directory)` | Project directory.                                          |
| `--saifctl-dir` |       | string | `saifctl`             | Path to the saifctl directory relative to the project root. |

### `feat phases compile`

Compile a phased feature to a deterministic `RunSubtaskInput[]` array and write it to `.saifctl/features/<feature>/phases.compiled.json`. Runs validation first and exits 1 if validation fails.

The compiled JSON is a **review artifact** — it documents the prompts and structure the orchestrator would dispatch, but is not intended to be fed to `feat run --subtasks`. The embedded `gateScript` is a fail-loud placeholder (`exit 1`) unless `--gate-script` is passed.

```
saifctl feat phases compile [options]
```

| Flag            | Alias | Type   | Default               | Description                                                                                                                                             |
| --------------- | ----- | ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--feature`        | `-e`  | string | _(prompted)_          | Feature name (kebab-case). Prompts with a list if omitted.                                                                                              |
| `--project-dir` |       | string | `(current directory)` | Project directory.                                                                                                                                      |
| `--saifctl-dir` |       | string | `saifctl`             | Path to the saifctl directory relative to the project root.                                                                                             |
| `--gate-script` |       | string | _(placeholder)_       | Path to a gate script to embed on every subtask. When omitted, a fail-loud placeholder is used so the artifact cannot silently bypass gates if misused. |

**Output path:** `<projectDir>/.saifctl/features/<feature>/phases.compiled.json`

The artifact normalises `testScope.include` paths to project-relative POSIX form so two developers compiling the same project produce byte-identical JSON.

## Usage examples

**Validate a phased feature:**

```bash
saifctl feat phases validate --feature my-feature
```

**Validate, prompting to select the feature:**

```bash
saifctl feat phases validate
```

**Compile a feature to review the subtask list:**

```bash
saifctl feat phases compile --feature my-feature
```

**Compile with a real gate script baked in:**

```bash
saifctl feat phases compile --feature my-feature --gate-script ./scripts/gate.sh
```

**Compile for a project in a non-default directory:**

```bash
saifctl feat phases compile --feature my-feature --project-dir /path/to/project
```
