// Sandbox Leash Cedar policy
//
// Used exclusively by 'saifctl sandbox' runs. Identical to default.cedar except
// the write-deny on /workspace/saifctl/ is removed.
//
// Security model:
//   - Agent can read all files in the container.
//   - Writes are restricted to `/workspace/` and `/tmp/`.
//   - Writes to `/workspace/saifctl/` ARE permitted (intentional for POC).
//   - Writes to `.git/` are still denied (sandbox-escape prevention).

// ── Filesystem ──────────────────────────────────────────────────────────────

permit (
    principal,
    action in [Action::"FileOpen", Action::"FileOpenReadOnly"],
    resource
) when {
    resource in [ Dir::"/" ]
};

permit (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/", Dir::"/tmp/" ]
};

// NOTE: No forbid for /workspace/saifctl/ — the POC agent is allowed to write
//       spec files (specification.md, plan.md, poc-findings.md, etc.).

// Sandbox-escape prevention: forbid the two .git/ paths that the host's
// git operations would honour as code (.git/hooks/*, .git/config). Other
// .git/ writes are allowed for normal git plumbing — see default.cedar
// for the full rationale.
forbid (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/.git/hooks/", File::"/workspace/.git/config" ]
};

// ── Process execution ───────────────────────────────────────────────────────

permit (
    principal,
    action == Action::"ProcessExec",
    resource
) when {
    resource in [ Dir::"/" ]
};

// ── Network ─────────────────────────────────────────────────────────────────

permit (
    principal,
    action == Action::"NetworkConnect",
    resource
) when {
    resource in [ Host::"*" ]
};
