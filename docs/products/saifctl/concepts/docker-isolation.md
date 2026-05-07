# Docker isolation in SaifCTL

When SaifCTL runs an agent — whether via `saifctl sandbox` or `saifctl feat run` — the agent operates inside an ephemeral Docker container, not directly on your machine. Your host working tree is never modified unless you explicitly opt in.

## What the agent sees

At startup, SaifCTL copies your workspace into the container. The agent reads and writes that copy. The original files on your host are untouched for the duration of the run.

This copy-not-mount approach means:

- Uncommitted local changes stay safe — the agent cannot overwrite them.
- Experiments that go wrong disappear when the container exits.
- By default, nothing persists back to the host.

To apply the agent's changes, pass `--extract` to `saifctl sandbox` (or let `saifctl feat run` handle promotion via its gate and PR step). Without that flag, the container exits and all modifications are discarded.

## How the boundary is enforced

Docker alone provides process and filesystem namespace separation. SaifCTL adds a second layer: **Leash**, a Cedar policy engine that enforces fine-grained rules at the kernel level — filesystem paths the agent may read or write, outbound network destinations it may reach, and process operations it may perform.

Cedar policies are evaluated before system calls complete, not after. A policy violation is blocked, not just logged. This means the boundary holds even if the agent is actively trying to work around it.

The default Cedar policy for sandbox runs is `sandbox.cedar`. You can substitute a stricter or more permissive policy with `--cedar <absolute-path>` (the path must be absolute).

## The shared kernel: sandbox vs. feat run

Both modes use the same isolation foundation:

|                            | `saifctl sandbox`   | `saifctl feat run` |
| -------------------------- | ------------------- | ------------------ |
| Ephemeral container        | yes                 | yes                |
| Cedar/Leash policies       | yes                 | yes                |
| Copy-not-mount workspace   | yes                 | yes                |
| Reviewer (Argus)           | no                  | yes                |
| Gate and test pipeline     | no (noop gate)      | yes                |
| Multi-run convergence loop | no (fixed at 1 run) | yes                |

The difference between the two modes is not the isolation — it is whether the agent's output is also subject to a correctness gauntlet (gate script, holdout tests, reviewer) before changes are promoted.

## What Cedar policies cover

A Cedar policy for a SaifCTL run can express rules across three domains:

- **Filesystem** — which paths inside the container the agent may read, write, or execute.
- **Network** — which external hosts or IP ranges the agent may contact.
- **Process** — which binaries the agent may spawn and with which arguments.

The default sandbox policy constrains writes to the workspace copy; consult `sandbox.cedar` for the exact rules in each domain. In `feat run`, the `--strict` flag (enabled by default) additionally prevents the agent from modifying the spec and test directories, so the agent cannot change the rules it is being evaluated against. This is a patch-level constraint, not a Cedar policy rule.

## Opting in to host writes

Isolation is the default. To bring changes back:

- `saifctl sandbox --extract` — after the run, applies the agent's git diff to your host working tree via `git apply`.
- `--extract-include <path>` — limits extraction to a specific subdirectory.
- `saifctl feat run` — on success, promotes the patch to a branch and optionally opens a PR; your working tree is never written directly.

See the [`sandbox` command reference](../../../references/commands/sandbox.md) and [`feat run` command reference](../../../references/commands/feat.md) for full flag details.

## Running OpenClaw safely

If you use OpenClaw, `saifctl sandbox` gives you a single command to run openclaw inside a Cedar-enforced container without touching your host:

```bash
saifctl sandbox --agent openhands --task "your task here"
```

The agent has full access to the workspace copy and can install packages, run tests, and write code — all within the container boundary. When the run ends, the container is destroyed. Add `--extract` only when you want to keep the result.

For more on the OpenClaw agent profile, see the [OpenClaw agent reference](../../../references/agents/openhands.md).
