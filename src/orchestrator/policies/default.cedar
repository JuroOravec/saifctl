// Default Leash Cedar policy for the Software Factory agent sandbox.
//
// Security model:
//   - Agent can read all files in the container.
//   - Writes are restricted to `/workspace/` (mounted sandbox copy) and `/tmp/` (tool state).
//   - Writes to `/workspace/saifctl/` are explicitly DENIED (reward-hacking prevention).
//   - Network is unrestricted. The agent needs to reach LLM APIs, npm/PyPI
//     registries, GitHub, and arbitrary CDNs during normal operation. The
//     real isolation boundary is the filesystem, not the network.
//
// Override with --cedar <path> to supply a project-specific policy.
//
// Cedar shape matches StrongDM Leash (transpiler + linter):
//   https://github.com/strongdm/leash/blob/main/docs/design/CEDAR.md
//   - Filesystem: Action::"FileOpen" | "FileOpenReadOnly" | "FileOpenReadWrite" with Dir::"/path/"
//     (trailing slash = directory coverage per Leash).
//   - ProcessExec: Dir:: paths (broader / for system binaries on PATH).
//   - Network: Action::"NetworkConnect" with Host::"name" or Host::"*" for allow-all.

// ── Filesystem ──────────────────────────────────────────────────────────────

// All to read all files on the system
permit (
    principal,
    action in [Action::"FileOpen", Action::"FileOpenReadOnly"],
    resource
) when {
    resource in [ Dir::"/" ]
};

// Allow write only inside the workspace and in /tmp/
permit (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/", Dir::"/tmp/" ]
};

// Disallow write to the dir with user's specs and tests (reward-hacking prevention).
forbid (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/saifctl/" ]
};

// Sandbox-escape prevention: forbid agent writes to the two .git/ paths that
// the host orchestrator's git operations (extractPatch, host-side `git apply`)
// would honour as code: `.git/hooks/*` and `.git/config`. A malicious agent
// could rewrite either to inject host-side command execution
// (e.g. `core.fsmonitor`, `diff.external`, pre-commit hooks).
//
// The rest of `.git/` (index, objects, refs, HEAD, logs, COMMIT_EDITMSG) is
// allowed: it's normal git plumbing, doesn't trigger code execution, and the
// reviewer (`reviewer.sh`) needs to commit uncommitted agent changes so it can
// diff `BASE_COMMIT..HEAD` regardless of whether the agent committed itself.
//
// Background: the original blanket forbid on `Dir::"/workspace/.git/"` was
// noted in the design-time security audit (architecture-history/security_assessment.md
// items #2 and #6) and broke the reviewer's commit step inside the container.
// Narrowing to the two specifically-dangerous paths keeps the sandbox-escape
// mitigation intact without over-restricting normal git plumbing.
forbid (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/.git/hooks/", File::"/workspace/.git/config" ]
};

// ── Process execution ───────────────────────────────────────────────────────
// Allow to call any process
// Match Leash bootstrap: agents need /bin/bash, /usr/bin/pnpm, node, python, etc.

permit (
    principal,
    action == Action::"ProcessExec",
    resource
) when {
    resource in [ Dir::"/" ]
};

// ── Network ─────────────────────────────────────────────────────────────────

// Allow all outbound network connections.
// The agent needs to reach LLM APIs, npm/PyPI/apt registries, GitHub, and
// arbitrary tool CDNs. Restricting network adds friction without meaningful
// security benefit given the filesystem sandbox already contains the blast radius.
permit (
    principal,
    action == Action::"NetworkConnect",
    resource
) when {
    resource in [ Host::"*" ]
};
