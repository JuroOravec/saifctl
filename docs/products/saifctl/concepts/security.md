# Security model

saifctl runs AI agents inside an ephemeral Docker container and enforces boundaries through Cedar policies via Leash. This page explains what those boundaries cover, what they do not cover, and the reasoning behind the design choices — so you can decide whether saifctl's threat model is acceptable for your project.

> **Reporting vulnerabilities:** This page is the long-form threat model. To report a security vulnerability or CVE, see [/SECURITY.md](/SECURITY.md) (responsible-disclosure only).

## The five protections

**1. Host filesystem isolation.**
The container receives a copy of your workspace, not a bind mount. Writes inside the container cannot reach the host filesystem. Even if the agent deletes or corrupts every file it can see, your host is untouched.

**2. Agent process integrity (`/workspace/saifctl/` write-deny).**
The Cedar policy denies writes to `/workspace/saifctl/` inside the container. An agent cannot modify its own specs, gate rules, or phase definitions — it cannot rewrite the contract it is being evaluated against.

**3. Host secrets are not exposed.**
Credentials on your host (SSH keys, cloud tokens, shell history) are never copied into the container. Only what you explicitly pass in is available inside.

**4. Host-hook / `.git` escape prevention.**
Git hooks and other host-side scripts are not present in the copied workspace. An agent cannot plant a post-commit hook that executes on your host when you later run `git commit`.

**5. Ephemeral container teardown.**
When the run completes, the container is destroyed. No process, no filesystem layer, and no network socket from the agent persists on your host.

## What saifctl does not protect against

**Network exfiltration (by default).** The container has unrestricted outbound network access. An agent — or a package it installs — can make arbitrary outbound requests. This is a deliberate choice: blocking all egress would prevent `npm install`, `pnpm install`, `pip install`, `cargo build`, and similar operations, making the sandbox unusable for real development work. See [Why filesystem-as-boundary is the design choice](#why-filesystem-as-boundary-is-the-design-choice) below.

**Kernel exploits.** Container isolation is OS-level. A container escape via a kernel vulnerability is outside saifctl's threat model.

**Agent CLI supply-chain compromise.** If the agent CLI binary itself (e.g., the **OpenClaw** binary you reference) is malicious, saifctl does not inspect it. Vet the binaries you pass to `saifctl sandbox` the same way you would vet any third-party tool.

**Malicious LLM-induced typosquats.** The LLM can generate `pip install` or `npm install` commands targeting a misspelled or malicious package name. saifctl does not statically analyse generated code before execution. Review agent-produced dependency additions before accepting them.

## Why filesystem-as-boundary is the design choice

Think of the host filesystem as the lock and the network as an open window. saifctl locks the door: the host is fully isolated from the container. The window — outbound network — is left open because closing it would make the room uninhabitable. Agents need to fetch packages, clone dependencies, and call APIs to do useful work.

This is a deliberate threat-model contract. The contract covers: **what the agent can write to your host** (nothing, by default). It does not cover: **what the agent can send over the network**. Knowing the shape of the contract lets you decide what to trust.

## Controlling the network: `--cedar` and bundled policies

saifctl ships three bundled Cedar policies:

| Policy | Description |
|--------|-------------|
| `default` | Filesystem isolation on; network unrestricted. |
| `sandbox` | Filesystem isolation on; outbound network restricted to known registries. |
| `deny-network` | Filesystem isolation on; all outbound network denied. |

Pass `--cedar <policy-name-or-path>` to select a bundled policy or supply your own `.cedar` file. For authoring custom policies, see [concepts/leash-access-control](leash-access-control.md).

## `dangerousNoLeash` mode

`dangerousNoLeash` disables all Cedar/Leash enforcement. The agent runs inside the container without filesystem, process, or network constraints.

**When it is appropriate:**
- Debugging the Leash integration itself (confirming a policy allows the operations you expect).
- Performance profiling where policy evaluation overhead is a confounding variable.
- Iterating on a new Cedar policy — run without Leash first to establish a baseline, then layer constraints in.

**When it is not appropriate:**
- Any run where the workspace contains secrets or credentials.
- CI pipelines and shared runners.
- Unattended runs.
- Any run whose diff will be committed without careful human review.

## Credential injection: API keys vs `--claude-max`

`--claude-max` stages your Claude Max OAuth tokens into the container as a `0600` file owned by the unprivileged container user. The agent can use your Claude Max plan capacity without an API key.

Understand the trade-off before using it:

| | API key | `--claude-max` |
|---|---------|----------------|
| Scope | Workspace-scoped | Tied to your personal account |
| Revocation | Per-project, from Anthropic console | Requires manual account-level revocation |
| Rate limits | Separate quota | Shares your personal interactive quota |
| Compromise impact | Limited to that project's API budget | Full Claude Max plan access until revoked |

**Use API keys for CI, shared, and unattended runs.** Reserve `--claude-max` for personal local development where you are watching the run and can revoke immediately if something goes wrong.

## Auditing runs

Every saifctl run produces a structured audit log accessible through the Leash dashboard. If you need to verify what the agent wrote, what network calls it made, or which Cedar policy decisions fired, start there. For policy authoring and access-control concepts, see [concepts/leash-access-control](leash-access-control.md).
