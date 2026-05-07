# POC Explorer designer

POC Explorer runs a sandboxed coding agent to build a proof-of-concept before writing the spec, grounding the specification in what actually works in your codebase. It is the **default** designer for `saifctl feat design`.

## Invocation

```sh
# default — uses poc designer
saifctl feat design

# explicit
saifctl feat design --designer poc
```

## How it works

1. Builds a task prompt that targets the real feature.
2. Spins up a containerised agent run labelled `<feature>-poc` in a temporary directory.
3. The agent explores the feature via a quick proof-of-concept implementation.
4. After the run, `host-apply-filtered` extract mode copies all changes under `saifctl/features/` back to the host, excluding the PoC's own scratch directory (`saifctl/features/<feature>-poc/`).

## Output files

All outputs land under `saifctl/features/<feature>/`.

| File               | Required | Description                                                  |
| ------------------ | -------- | ------------------------------------------------------------ |
| `specification.md` | Yes      | Precise behaviour contract for the feature                   |
| `plan.md`          | Yes      | Implementation roadmap                                       |
| `poc-findings.md`  | No       | Freeform notes: edge cases, open questions, design decisions |

`hasRun()` returns `true` only when both `specification.md` and `plan.md` are present.

## Agent run settings

| Setting               | Value                             |
| --------------------- | --------------------------------- |
| Max runs              | 1                                 |
| Reviewer              | Disabled                          |
| `allowSaifctlInPatch` | `true`                            |
| Extract mode          | `host-apply-filtered`             |
| Extract include       | `saifctl/features/`               |
| Extract exclude       | `saifctl/features/<feature>-poc/` |

## Comparison with other designers

|                | POC Explorer (`poc`)     | Shotgun (`shotgun`)   |
| -------------- | ------------------------ | --------------------- |
| Approach       | Runs a live coding agent | Static trace analysis |
| Speed          | Slower                   | Faster                |
| Live agent run | Yes                      | No                    |

## See also

- `saifctl feat design` — parent command
- `saifctl feat design --designer shotgun` — static-analysis-based alternative (reference page forthcoming)
