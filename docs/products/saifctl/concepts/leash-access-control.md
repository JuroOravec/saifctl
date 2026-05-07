# Leash access control

When SaifCTL runs an agent, the agent operates inside an ephemeral Docker container whose actions are governed by a Cedar policy enforced by **Leash**. You define exactly which files the agent may write, which hosts it may reach, and which processes it may spawn — nothing more.

For the broader threat model, see [Docker isolation in SaifCTL](./docker-isolation.md).

## Why access control matters for agents

Your agent running autonomously for dozens of iterations faces several failure modes that Docker namespace isolation alone does not prevent:

- **Reward hacking** — the easiest way to make a failing test pass is to rewrite the test. Without a write prohibition on the test directory, your agent will do this.
- **Data exfiltration** — with unrestricted outbound network access, your agent can POST your source code or secrets to any endpoint.
- **Malicious package pulls** — `npm install` on a hallucinated package name can execute arbitrary post-install scripts. Network allowlisting limits where those scripts can call out.
- **Paid-API hammering** — an agent stuck in a loop can exhaust rate limits or run up costs on external APIs it was never meant to call.

Cedar policies address all four by expressing the permitted surface as an explicit allowlist. What you do not permit is denied.

## How Leash enforces Cedar

Leash intercepts system calls and outbound network connections before they complete. It translates each intercepted action into a Cedar request — _"Is this principal allowed to perform this action on this resource?"_ — and either allows or blocks it. A blocked action returns an error to the agent immediately; it is not just logged.

This means the boundary holds even when the agent is actively trying to work around it. There is no race window between detection and enforcement.

## The Cedar action vocabulary

SaifCTL's bundled policies use the following actions from the Leash Cedar schema:

| Action                        | What it covers                      |
| ----------------------------- | ----------------------------------- |
| `Action::"FileOpen"`          | Any file open (read-only semantics) |
| `Action::"FileOpenReadOnly"`  | Explicit read-only open             |
| `Action::"FileOpenReadWrite"` | Any open that permits writing       |
| `Action::"ProcessExec"`       | Spawning a process                  |
| `Action::"NetworkConnect"`    | Outbound TCP/HTTP connection        |

Leash does not use `ReadFile` / `WriteFile` or `Directory::` — those map to the `FileOpen*` family and `Dir::` respectively. Consult the [upstream Leash Cedar spec](https://github.com/strongdm/leash/blob/main/docs/design/CEDAR.md) for the complete action and resource type reference, including `HttpRewrite` and `McpCall`.

## Policy syntax basics

A Cedar policy is a sequence of `permit` and `forbid` statements. Each statement matches a principal, an action, and a resource.

```cedar
// Allow read-only opens anywhere in the container
permit (
    principal,
    action in [Action::"FileOpen", Action::"FileOpenReadOnly"],
    resource
) when {
    resource in [ Dir::"/" ]
};

// Allow writes only under the workspace
permit (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/" ]
};

// Hard-deny writes to the spec directory regardless of any permit
forbid (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/saifctl/" ]
};
```

Three rules govern every policy:

- **Default deny** — if no `permit` matches, the action is blocked. You never need to enumerate what is forbidden; you only enumerate what is allowed.
- **`forbid` beats `permit`** — a matching `forbid` wins unconditionally. Use this for hard boundaries (spec directories, `.git/config`) that must hold even when broad `permit` statements exist.
- **Directory resources require a trailing slash** — `Dir::"/workspace/"` covers everything under `/workspace/`; `Dir::"/workspace"` without the slash does not match subdirectory paths. `File::"/workspace/package.json"` matches exactly one file. `Host::"registry.npmjs.org"` is the hostname form for network rules.

## Bundled policies

SaifCTL ships three Cedar files under `src/orchestrator/policies/`:

### `default.cedar`

Used by `saifctl feat run`. Filesystem-isolated, network-open:

- **Read** — `FileOpen` and `FileOpenReadOnly` permitted under `Dir::"/"` (the agent can read any file in the container, including system libraries and tooling).
- **Write** — `FileOpenReadWrite` permitted under `Dir::"/workspace/"` and `Dir::"/tmp/"`.
- **Write — forbidden** — `Dir::"/workspace/saifctl/"`, `Dir::"/workspace/.git/hooks/"`, and `File::"/workspace/.git/config"` are hard-denied. This prevents the agent from modifying the factory orchestrator, corrupting git hooks, or rewriting git configuration on the host after patch extraction.
- **Process** — `ProcessExec` permitted under `Dir::"/"`; agents can run any binary on `PATH`.
- **Network** — `NetworkConnect` permitted for `Host::"*"` (unrestricted outbound). Tighten this with `--cedar` when the filesystem boundary is not sufficient.

### `sandbox.cedar`

Used by default with `saifctl sandbox`. Has the same write surface (`Dir::"/workspace/"` and `Dir::"/tmp/"`) and the same unrestricted network (`Host::"*"`) as `default.cedar`, but removes the `forbid` on `Dir::"/workspace/saifctl/"`. This makes it slightly less restrictive than `default.cedar` for saifctl-directory paths — intentional for POC agent runs that need to write spec files. Use this when you want your agent to operate on the workspace copy, including saifctl directories.

### `deny-network.cedar`

A test/example policy that blocks all outbound network connections **except** `registry.npmjs.org`, which is permitted to allow npm package installs. Use this as a starting point when the task is largely local (refactoring, test fixing); extend the allowlist if your agent needs to reach other hosts. Do not rely on it as a production-hardened deny-all policy.

## Using a custom policy with `--cedar`

Pass an absolute path to any Cedar file to override the bundled policy:

```bash
saifctl feat run --feature my-feature --cedar /absolute/path/to/my-policy.cedar
saifctl sandbox --agent openhands --task "refactor auth module" --cedar /absolute/path/to/my-policy.cedar
```

The recommended workflow for authoring a custom policy:

1. Copy the bundled policy that is closest to your requirements (`default.cedar` for factory runs, `sandbox.cedar` for sandbox runs).
2. Add `permit` statements for any additional paths or hosts the agent needs.
3. Add `forbid` statements for directories that must be immutable (spec files, secret keystores, CI configuration).
4. Validate the policy against your Leash version before running at scale — Leash exposes a `/api/policies/validate` endpoint when the control UI is running at `http://localhost:18080`.

### Example: tightening the network allowlist

Starting from `default.cedar`, replace the open `Host::"*"` rule with an explicit allowlist:

```cedar
// Remove the broad Host::"*" permit and replace with:
permit (
    principal,
    action == Action::"NetworkConnect",
    resource
) when {
    resource in [
        Host::"registry.npmjs.org",
        Host::"github.com",
        Host::"api.anthropic.com"
    ]
};
```

The agent can now install npm packages, clone from GitHub, and call the Anthropic API — and nothing else.

## What the upstream Leash spec covers

The [Leash Cedar design document](https://github.com/strongdm/leash/blob/main/docs/design/CEDAR.md) is the authoritative reference for:

- The complete action type list (`FileOpen`, `FileOpenReadOnly`, `FileOpenReadWrite`, `ProcessExec`, `NetworkConnect`, `HttpRewrite`, `McpCall`).
- Resource type details — `Dir::`, `File::`, `Host::` (with and without port), `MCP::Server::`, `MCP::Tool::`.
- How Leash translates Cedar policies to eBPF kernel rules and MITM proxy rules, and where the two enforcement paths differ (e.g., hostname enforcement goes through the proxy; IP-level enforcement is kernel-path).

SaifCTL wires Leash via the `@strongdm/leash` npm package included as a dependency. The `--cedar` flag passes the policy file to Leash at startup; the policy is re-evaluated on every intercepted action for the lifetime of the run.

## Related pages

- [Docker isolation in SaifCTL](./docker-isolation.md) — how the container boundary and copy-not-mount workspace complement Cedar policies.
- [Security concepts](./security.md) — broader threat-model framing that contextualises the access-control guarantees described here.
- `sandbox` command reference — full flag reference including `--cedar` and `--extract` (page not yet generated).
- `feat run` command reference — factory-mode flags including `--cedar` and `--strict` (page not yet generated).
