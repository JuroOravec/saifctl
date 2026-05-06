# Cedar policies + Leash enforcement

The agent runs under [Leash](https://github.com/strongdm/leash) — a Cedar-aware syscall interceptor wrapping the agent process inside the coder container. Every `open()`, `exec()`, `connect()` is checked against the active [Cedar](https://www.cedarpolicy.com/) policy before the kernel sees it.

Saifctl ships three bundled policies and accepts a custom one via `--cedar <path>`:

- `default.cedar` — used by `feat run`. Reads anywhere; writes only to `/workspace/` + `/tmp/`; forbids writes to `/workspace/saifctl/` (reward-hacking) + `/workspace/.git/{hooks/,config}` (sandbox-escape); network unrestricted.
- `sandbox.cedar` — used by `saifctl sandbox`. Same as default, minus the `/workspace/saifctl/` forbid.
- `deny-network.cedar` — opt-in via `--cedar`. Same filesystem rules; network default-deny except `registry.npmjs.org`.

> User-facing companion: [`docspec/products/saifctl/concepts/leash-access-control.md`](../../../docspec/products/saifctl/concepts/leash-access-control.md). This page is what's wired where in source.

## Cedar action vocabulary

Cedar shape used by Leash (transpiler + linter): see [strongdm/leash CEDAR.md](https://github.com/strongdm/leash/blob/main/docs/design/CEDAR.md). The action vocabulary saifctl exercises:

| Action | What it gates |
|---|---|
| `Action::"FileOpen"` | Generic open (read or write) — used by Leash for permit-read-by-default rules. |
| `Action::"FileOpenReadOnly"` | Read-only file access. |
| `Action::"FileOpenReadWrite"` | Anything that writes / appends / truncates. |
| `Action::"ProcessExec"` | `exec*()` syscalls. |
| `Action::"NetworkConnect"` | Outbound TCP/UDP `connect()`. Resource is `Host::"..."` (DNS name or `*`). |

Resources are `Dir::"…/"` (trailing slash = directory coverage), `File::"/abs/path"`, or `Host::"domain"`. Forbid beats permit; missing rule = implicit deny.

## Policy resolution

Priority: CLI flag > project config > framework default.

```
--cedar <path>                     ← per-run override
defaults.cedarPolicyPath           ← saifctl/config.ts
defaultCedarPolicyPath()           ← src/constants.ts:136 → default.cedar
```

Code: [`src/cli/commands/sandbox.ts:192-218`](../../../src/cli/commands/sandbox.ts#L192-L218), [`src/cli/commands/feat.ts:647-648`](../../../src/cli/commands/feat.ts#L647-L648). Bundled policies live at [`src/orchestrator/policies/`](../../../src/orchestrator/policies).

## Wiring inside the engine

For `--engine docker` (default), at [`src/engines/docker/index.ts`](../../../src/engines/docker/index.ts):

1. Saifctl resolves the policy path, reads the file once into `cedarScript`.
2. Materializes the policy at `<saifctl>/<SANDBOX_CEDAR_POLICY_BASENAME>` (`policy.cedar`, [`src/constants.ts:144`](../../../src/constants.ts#L144)) inside the coder workspace.
3. Launches the coder container via `leash run --policy <path> -- <agent command>`. Leash spawns the agent under the policy and acts as a network-attach proxy (workaround at `index.ts:701` — predictable `TARGET_CONTAINER` name lets Docker network-attach the staging container alongside the agent's namespace).

Default Leash image: `ghcr.io/safe-ai-factory/leash:latest-h2patch` ([`src/constants.ts:131`](../../../src/constants.ts#L131)). The `h2patch` tag exists because upstream PR #71 hasn't shipped — see decision **D-16 / VND-02** in the release-readiness specification for the path to retire the fork.

## Escape hatches

### `--dangerousNoLeash`

Skips Leash entirely; agent runs via `docker run`. Cedar protections are **gone**, but the **filesystem boundary still holds** (the workspace is a copy, not a mount).

Use for: orchestrator debugging where Leash is suspect, narrowing a custom Cedar policy (observe what the agent tries to do without rules to deny), Leash perf profiling.

**Don't use** for: anything with secrets in env, CI, unattended runs, runs whose diff will be committed without review — Cedar's reward-hacking guardrail is removed; the agent could overwrite its own tests/specs.

Wired at [`src/engines/docker/index.ts:525-639`](../../../src/engines/docker/index.ts#L525-L639).

### `--engine local`

Skips Docker entirely; agent runs as a host subprocess. **Never appropriate** for CI or unattended runs against untrusted code. Use for fast inner-loop development of saifctl itself.

## Custom policy authoring

Tightening the default — Cedar's "forbid beats permit" makes additive denials easy:

1. `cp src/orchestrator/policies/default.cedar <your-project>/saifctl/policies/strict.cedar`
2. Add `forbid` rules before the existing permits. Example — network allowlist:
   ```cedar
   forbid (
       principal,
       action == Action::"NetworkConnect",
       resource
   ) when {
       !(resource in [ Host::"registry.npmjs.org", Host::"api.your-company.com" ])
   };
   ```
3. `saifctl feat run --cedar saifctl/policies/strict.cedar`.

Loosening (e.g. allow writes outside `/workspace/`): edit the existing `permit` resource lists rather than adding new permits. The framework default already permits broadly, so additive permits would be redundant.

## Why the network is unrestricted by default

Per **Decision D-06**: an allowlist covering LLM APIs + npm/PyPI/crates/Go-module-proxy/apt + GitHub clone/releases + container registries + doc hosts + per-project deps is intractable to maintain for arbitrary projects. Either too loose (permits exfiltration) or too tight (breaks `npm install`).

Saifctl's trade-off: **filesystem isolation contains the blast radius; the network is a known unmitigated exfiltration channel by default.** Users who can enumerate their allowlist opt in via `--cedar` (custom) or bundled `deny-network.cedar`.

Framing matters: not "we deny network because it's safe" (false — the agent can exfil env vars over an open connection) but "we permit network because the alternative is unmaintainable".

## Threat-model context

Specific Cedar rules trace to specific findings in [`security-threats.md`](./security-threats.md):

| Finding | Cedar rule |
|---|---|
| Sandbox-escape via `.git/hooks/` (host honours these on `git apply`) | `forbid` writes to `Dir::"/workspace/.git/hooks/"` |
| Sandbox-escape via `.git/config` (host honours `core.fsmonitor`, `diff.external`) | `forbid` writes to `File::"/workspace/.git/config"` |
| Reward-hacking via test/spec edits | `forbid` writes to `Dir::"/workspace/saifctl/"` (`default.cedar` only) |

The narrowing from the original blanket `Dir::"/workspace/.git/"` forbid (which broke the in-container reviewer's commit step) to the two specific paths is documented inline at `default.cedar:55-64`.
