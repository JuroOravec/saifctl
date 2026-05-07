# `run rules`

Manage **user-feedback rules** attached to a run. Rules are injected into the agent task prompt, letting you steer a coding agent live — rules added during execution are picked up on the next inner round.

This is a subcommand of `run` (`saifctl run rules …`) that operates on live (executing) runs rather than stored run history.

## Synopsis

```
saifctl run rules <subcommand> [flags]
```

## Subcommands

| Subcommand | Alias | Description                          |
| ---------- | ----- | ------------------------------------ |
| `create`   | —     | Append a user rule to a run          |
| `list`     | `ls`  | List all rules for a run             |
| `get`      | —     | Print a single rule as JSON          |
| `update`   | —     | Update a rule's content and/or scope |
| `remove`   | `rm`  | Remove a rule from a run             |

---

## Common flags

All subcommands accept these storage flags:

| Flag            | Type   | Description                                                                                                                                                                                                    |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project-dir` | string | Path to the project directory (default: current directory)                                                                                                                                                     |
| `--saifctl-dir` | string | Path to the saifctl directory (default: `saifctl`)                                                                                                                                                             |
| `--storage`     | string | Storage backend: `local` \| `s3` \| `s3://bucket/prefix` (global), or per-DB `runs=local,tasks=s3` style, or mixed. Comma-separated; duplicate keys and combining a global value with per-DB keys are invalid. |

---

## `create`

Append a new rule to a run. Exactly one of `--content` or `--content-file` is required.

```
saifctl run rules create <runId> --content <text> [--scope once|always]
saifctl run rules create <runId> --content-file <path> [--scope once|always]
```

### Arguments

| Name    | Type       | Required | Description                  |
| ------- | ---------- | -------- | ---------------------------- |
| `runId` | positional | yes      | Run ID to attach the rule to |

### Flags

| Flag             | Type   | Required | Default | Description                                                                   |
| ---------------- | ------ | -------- | ------- | ----------------------------------------------------------------------------- |
| `--content`      | string | one of   | —       | Rule text shown to the agent (mutually exclusive with `--content-file`)       |
| `--content-file` | string | one of   | —       | Path to a file containing the rule text (mutually exclusive with `--content`) |
| `--scope`        | string | no       | `once`  | `once` (next coding round only) or `always` (every round)                     |

### Example

```sh
# Add a one-shot instruction
saifctl run rules create run_abc123 --content "Use tabs, not spaces."

# Add a standing instruction from a file
saifctl run rules create run_abc123 --content-file ./rules/style.txt --scope always
```

---

## `list` / `ls`

Print all rules for a run in a table.

```
saifctl run rules list <runId>
saifctl run rules ls <runId>
```

### Arguments

| Name    | Type       | Required | Description              |
| ------- | ---------- | -------- | ------------------------ |
| `runId` | positional | yes      | Run ID to list rules for |

A header line is printed first reporting total rules and how many are active for the next prompt round (e.g. `3 rule(s) (2 active in next prompt):`), followed by a table with columns: **ID**, **SCOPE**, **CONSUMED** (`yes` / `no`), **CONTENT** (truncated to 64 characters — shown as 61 chars + `...` when the content exceeds 64 characters).

### Example

```sh
saifctl run rules ls run_abc123
```

---

## `get`

Print a single rule as JSON.

```
saifctl run rules get <runId> <ruleId> [--pretty]
```

### Arguments

| Name     | Type       | Required | Description |
| -------- | ---------- | -------- | ----------- |
| `runId`  | positional | yes      | Run ID      |
| `ruleId` | positional | yes      | Rule ID     |

### Flags

| Flag       | Type    | Default | Description                  |
| ---------- | ------- | ------- | ---------------------------- |
| `--pretty` | boolean | `true`  | Pretty-print the JSON output |

### Example

```sh
saifctl run rules get run_abc123 rule_xyz --pretty=false
```

---

## `update`

Update a rule's content and/or scope. At least one of `--content`, `--content-file`, or `--scope` is required.

```
saifctl run rules update <runId> <ruleId> [--content <text>] [--content-file <path>] [--scope once|always]
```

### Arguments

| Name     | Type       | Required | Description       |
| -------- | ---------- | -------- | ----------------- |
| `runId`  | positional | yes      | Run ID            |
| `ruleId` | positional | yes      | Rule ID to update |

### Flags

| Flag             | Type   | Description                                                           |
| ---------------- | ------ | --------------------------------------------------------------------- |
| `--content`      | string | New rule text (mutually exclusive with `--content-file`)              |
| `--content-file` | string | Path to file with new rule text (mutually exclusive with `--content`) |
| `--scope`        | string | New scope: `once` or `always`                                         |

### Example

```sh
# Change scope of an existing rule
saifctl run rules update run_abc123 rule_xyz --scope always

# Replace content
saifctl run rules update run_abc123 rule_xyz --content "Prefer async/await over callbacks."
```

---

## `remove` / `rm`

Remove a rule from a run.

```
saifctl run rules remove <runId> <ruleId>
saifctl run rules rm <runId> <ruleId>
```

### Arguments

| Name     | Type       | Required | Description       |
| -------- | ---------- | -------- | ----------------- |
| `runId`  | positional | yes      | Run ID            |
| `ruleId` | positional | yes      | Rule ID to remove |

### Example

```sh
saifctl run rules rm run_abc123 rule_xyz
```

---

## Rule scopes

| Scope    | Behaviour                                                       |
| -------- | --------------------------------------------------------------- |
| `once`   | Injected into the next agent prompt round, then marked consumed |
| `always` | Injected into every agent prompt round until removed            |
