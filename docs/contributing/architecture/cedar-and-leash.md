# Cedar policies + Leash enforcement

How saifctl decides what an agent in the sandbox is allowed to do, and how that decision is enforced inside the coder container.

> **Related:** the user-facing version of this material lives at [`docspec/products/saifctl/concepts/leash-access-control.md`](../../../docspec/products/saifctl/concepts/leash-access-control.md). This page is the *contributor* view — what's wired where in source.

## Two-layer model

- **[Leash](https://github.com/strongdm/leash)** — the runtime. A small Cedar-aware syscall interceptor that wraps the agent process inside the coder container. Every `open()`, `exec()`, `connect()` made by the agent (or anything it spawns) is checked against the active Cedar policy before the kernel sees it.
- **[Cedar](https://www.cedarpolicy.com/)** — the policy language. Saifctl ships three bundled `.cedar` files (described below) and accepts a custom one via `--cedar <path>`.

Cedar shape used by Leash (transpiler + linter): see [strongdm/leash CEDAR.md](https://github.com/strongdm/leash/blob/main/docs/design/CEDAR.md). The action vocabulary saifctl exercises:

| Action | What it gates |
|---|---|
| `Action::"FileOpen"` | Generic open (read or write) — used by Leash for permit-read-by-default rules. |
| `Action::"FileOpenReadOnly"` | Read-only file access. |
| `Action::"FileOpenReadWrite"` | Anything that writes / appends / truncates. |
| `Action::"ProcessExec"` | `exec*()` syscalls. |
| `Action::"NetworkConnect"` | Outbound TCP/UDP `connect()`. Resource is `Host::"..."` (DNS name or `*`). |

Resources are `Dir::"…/"` (trailing slash = directory coverage), `File::"/abs/path"`, or `Host::"domain"`. Forbid beats permit; missing rule = implicit deny.

## Bundled policies

In [`src/orchestrator/policies/`](../../../src/orchestrator/policies):

| File | Default for | Notable rules |
|---|---|---|
| `default.cedar` | `saifctl feat run` (the gauntlet) | Filesystem reads everywhere; writes restricted to `/workspace/` + `/tmp/`; **writes to `/workspace/saifctl/` are forbidden** (reward-hacking prevention — agents can't edit their own tests/specs); `.git/hooks/` + `.git/config` writes forbidden (sandbox-escape via host-side git operations); `ProcessExec` and `NetworkConnect` unrestricted. |
| `sandbox.cedar` | `saifctl sandbox` | Same as `default.cedar` minus the `/workspace/saifctl/` forbid — sandbox-mode users *want* to write into that dir as part of normal work. `.git/` write-deny stays. |
| `deny-network.cedar` | Opt-in (`--cedar src/orchestrator/policies/deny-network.cedar`) | Same filesystem rules as `default.cedar`; network is default-deny except `registry.npmjs.org`. Used by integration tests to exercise the `NetworkConnect` deny path. |

The bundled-policy override path:

```
sandbox.ts: --cedar <path>  →  cedarCli (CLI override)
config.json: defaults.cedarPolicyPath  →  config default
src/constants.ts:136 defaultCedarPolicyPath()  →  framework default (default.cedar)
```

Resolution priority is CLI > config > framework default. See [`src/cli/commands/sandbox.ts:192-218`](../../../src/cli/commands/sandbox.ts#L192-L218) and [`src/cli/commands/feat.ts:647-648`](../../../src/cli/commands/feat.ts#L647-L648).

## Wiring inside the engine

For `--engine docker` (the default), the flow is at [`src/engines/docker/index.ts`](../../../src/engines/docker/index.ts):

1. Saifctl resolves the policy path and reads the file once into `cedarScript`.
2. When provisioning the sandbox, the policy is materialized inside the coder workspace at `<saifctl>/<SANDBOX_CEDAR_POLICY_BASENAME>` (`policy.cedar`, see [`src/constants.ts:144`](../../../src/constants.ts#L144)).
3. The coder container is launched via `leash run --policy <path> -- <agent command>`. Leash takes care of:
   - Spawning the agent under the policy.
   - Acting as a network-attach proxy (workaround documented at `index.ts:701` — a predictable `TARGET_CONTAINER` name lets Docker network-attach the staging container alongside the agent's namespace).
4. Default Leash image is `ghcr.io/safe-ai-factory/leash:latest-h2patch` (see [`src/constants.ts:131`](../../../src/constants.ts#L131)). The `h2patch` tag exists because PR #71 hasn't been published upstream yet — see [`vendor/leash/`](../../../vendor/leash/) and decision **D-16 / VND-02** in the release-readiness specification for the path to retire the fork.

## Escape hatches

Two ways to opt out of the Leash+Cedar pair, both intentional and both documented as user-visible:

### `--dangerousNoLeash`

Set on a per-run basis. Skips the `leash` wrapper entirely; the agent runs as `docker run` directly, with the container's default security boundary (filesystem + Cedar protections **gone**). Used for:

- Orchestrator debugging where Leash itself is suspect.
- Narrowing a custom Cedar policy: run with no leash, observe what the agent tries to do, write the corresponding rules.
- Performance profiling (Leash adds syscall-interception overhead).

Wired at [`src/engines/docker/index.ts:525-639`](../../../src/engines/docker/index.ts#L525-L639) — when `dangerousNoLeash` is set, the engine takes a separate `docker run` codepath; otherwise it spawns Leash. Importantly, the **filesystem boundary still holds** (the workspace is a copy, not a mount), so reaching the host filesystem still requires breaking out of the Docker container itself, not just bypassing Cedar.

When *not* appropriate: anything with secrets in env, CI runs, unattended runs, runs whose diff will be committed without careful review — Cedar's reward-hacking guardrail is removed and the agent could overwrite its own tests/specs to fake a green run.

### `--engine local`

Skips Docker (and therefore Leash) entirely; the agent runs as a normal subprocess on the host. Used during inner-loop development of saifctl itself or when the host is the test target. Trades all isolation for fast iteration. **Never appropriate for unattended or CI runs against untrusted code.**

## Custom policy authoring

Recipe for tightening (rather than replacing) the default policy:

1. Copy `src/orchestrator/policies/default.cedar` to `<your-project>/saifctl/policies/strict.cedar`.
2. Add forbids before the existing permits — Cedar's "forbid beats permit" makes additive denials easy. Example: deny outbound network except `registry.npmjs.org` and your own API:
   ```cedar
   forbid (
       principal,
       action == Action::"NetworkConnect",
       resource
   ) when {
       !(resource in [ Host::"registry.npmjs.org", Host::"api.your-company.com" ])
   };
   ```
3. Run with `saifctl feat run --cedar saifctl/policies/strict.cedar`.

For looser policies (e.g. allow writes outside `/workspace/`), edit the existing `permit` resource lists rather than adding new permits — Cedar's resolution makes additive permits redundant since the framework default already permits broadly.

## Why the network is unrestricted by default

Per **Decision D-06** in the release-readiness specification: a maintainable allowlist that covers all of LLM APIs, npm + PyPI + crates.io + Go module proxy + apt + arbitrary distro repos, GitHub (clone, releases — Argus binary download path at [`src/orchestrator/sidecars/reviewer/argus.ts`](../../../src/orchestrator/sidecars/reviewer/argus.ts)), container registries, plus whatever documentation hosts the agent might fetch from, plus whatever each user project's dependencies pull at install time, **is intractable to define for arbitrary user projects**. The surface of "common usage domains" is large and hard to predict — every new agent run, every new dependency, every new tool can broaden it. A default-deny allowlist would either be useless (so loose that it permits exfiltration) or break ordinary first-run usage (so tight that `npm install` fails).

The trade-off saifctl makes: **the network is a known unmitigated exfiltration channel by default; filesystem isolation is what contains the blast radius.** This is documented openly in the user-facing [`security.md`](../../../docspec/products/saifctl/concepts/security.md). For users who *can* enumerate their allowlist (CI, compliance contexts, projects with a known dependency graph), the path is opt-in via `--cedar` pointing at a custom policy, or the bundled `deny-network.cedar` as a starting point.

The framing is **practicality, not security claim**: "we deny network because it's safe" would be wrong — the agent can read its own env vars and exfiltrate them over the network if it's exploited. The honest statement is "we permit network because the alternative is a maintainability mess".

## Threat-model context

The design-time security review (preserved at [`security-threats.md`](./security-threats.md)) drove specific Cedar rules:

- **Sandbox-escape via `.git/hooks/`** — hosts honour these on `git apply`. Mitigated by the `Dir::"/workspace/.git/hooks/"` forbid.
- **Sandbox-escape via `.git/config`** — host honours `core.fsmonitor`, `diff.external`. Mitigated by the `File::"/workspace/.git/config"` forbid.
- **Reward-hacking via test/spec edits** — agent rewrites the tests it's supposed to satisfy. Mitigated by the `Dir::"/workspace/saifctl/"` forbid in `default.cedar`.

The narrowing from the original blanket `Dir::"/workspace/.git/"` forbid (which broke the reviewer's commit step) to the two specifically-dangerous paths is documented inline in `default.cedar:55-64`.
