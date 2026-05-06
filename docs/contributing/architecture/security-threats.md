# Threat model — design-time findings & mitigations

This page is the contributor view of saifctl's security posture: the **specific threats** that drove **specific code paths**, with file:line anchors so you can verify the mitigation is still wired.

> **User-facing companion**: [`docspec/products/saifctl/concepts/security.md`](../../../docspec/products/saifctl/concepts/security.md) (the threat-model long-form). That page frames the boundaries; this one is the implementation audit trail.

## Scope

The orchestrator runs untrusted code (the agent's output). The agent runs untrusted code (whatever it pulls in via `npm install`, `pip install`, etc.). The threat model assumes both are hostile and asks: what can each one do to the **host machine running `saifctl`**?

The boundary is designed around two principles:

1. **The agent never controls what the host process executes.** Anything the agent writes that the host then *honours* (git config, hooks, patches, raw stderr fed back into shell) is a potential escape vector. The findings below are all variations on this theme.
2. **Network egress is intentionally permitted by default — for practicality, not security.** A maintainable allowlist that covers npm, PyPI, crates.io, Go's module proxy, GitHub, container registries, LLM providers, plus arbitrary documentation hosts the agent might fetch from, plus arbitrary CDNs the language toolchains pull from, plus whatever each user project's dependencies need is **intractable to define for arbitrary user projects** (per **Decision D-06** in the release-readiness specification). Saifctl ships `default.cedar` with `permit ... NetworkConnect` and a `deny-network.cedar` opt-in for users who can enumerate their own allowlist. **Filesystem isolation is what actually contains the blast radius**; the network is a known unmitigated exfiltration channel by default. The user-facing security concept is explicit about this trade-off.

## Defense-in-depth layers

The **website's saifctl page** ([`web/src/app/saifctl/page.tsx`](../../../web/src/app/saifctl/page.tsx) `SECURITY_ROWS`) presents these as five independent layers; from the contributor's POV they map to specific code paths:

1. **Container + policy enforcement.** The agent runs inside a Docker container; Leash (a Cedar-aware syscall interceptor) wraps the agent process with a default-deny policy. See [`cedar-and-leash.md`](./cedar-and-leash.md).
2. **Copy-not-mount workspace.** The agent receives a *copy* of the project tree at `/workspace/`, not a mount of the host's working directory. Host secrets, `~/.aws`, SSH keys, the host's `.git/`, and hidden test files (under `<feature>/tests/hidden/`) are **never staged into the copy** ([`src/orchestrator/sandbox.ts:16`](../../../src/orchestrator/sandbox.ts#L16): `tests.json ← test catalog (public cases only; hidden/ dir stripped)`). The agent's container can't see the host filesystem at all.
3. **Patch as plain-text git diff.** The agent's output reaches the host as a *string*, not a process. After every round, [`extractIncrementalRoundPatch`](../../../src/orchestrator/sandbox.ts#L1045) reads the per-round diff from the sandbox repo, applies the `patchExclude` rules ([`filterPatchHunks`](../../../src/orchestrator/sandbox.ts#L1194)) to strip dangerous file sections (e.g. `.git/hooks/**`, `saifctl/tests/**`), and stores the result as a `RunCommit`. The host orchestrator never `exec`s anything written by the agent — the only host-side action on the patch is `git apply`, gated by [`assertRunCommitsSafeForHost`](../../../src/orchestrator/phases/apply-patch.ts#L75).
4. **Per-iteration container teardown.** The coder container, the staging container, and any ephemeral services are destroyed at the end of each iteration. There is no latent process or in-memory state that can carry over to the next round; if the agent installs a daemon, opens a socket, or seeds `cron`, it disappears. Resource bookkeeping lives in [`LiveInfra`](../infra.md) so teardown is deterministic even when a run crashes mid-setup.
5. **Two-container test architecture.** The test runner does *not* run inside the agent's container. It lives in a **separate** container that talks to the staging container (where the agent's code is deployed) over **HTTP only**, via a Go sidecar at [`src/orchestrator/sidecars/cli-over-http/main.go`](../../../src/orchestrator/sidecars/cli-over-http/main.go). The sidecar accepts `POST /exec { cmd, args, env, timeout }` and returns `{ stdout, stderr, exitCode }` as JSON. The test runner asserts on those JSON strings — there is **no shared memory, no Docker socket access, and no inter-process trust** between the agent's environment and the test runner. See [`test-runner.md`](./test-runner.md) for the full sidecar protocol.

These five layers are independent: defeating any one of them does not defeat the others.

## Additional hardening mechanisms

Beyond the five layers, several specific mechanisms harden particular paths:

- **Saifctl env-var stripping** ([`src/orchestrator/loop.ts:268`](../../../src/orchestrator/loop.ts#L268)). `SAIFCTL_*`, `LLM_*`, and `REVIEWER_LLM_*` env vars are stripped from the agent's env before invocation. The agent can't read saifctl's own LLM credentials or run-internal coordination vars, even though it inherits other host env (which is the trade-off — see #4 below).
- **Secret-env redaction** (same code path). Vars listed via `--agent-secret KEY` (or `config.defaults.agentSecretKeys`) are passed to the agent but never logged as values and never persisted to run storage. Used for passing API keys without baking them into the run record.
- **Drop-privileges contract** ([`src/orchestrator/scripts/saifctl-agent-helpers.sh`](../../../src/orchestrator/scripts/saifctl-agent-helpers.sh), [`drop-privileges-contract.test.ts`](../../../src/agent-profiles/drop-privileges-contract.test.ts)). Each agent profile's `agent.sh` invokes `saifctl_drop_privs_init` then runs the agent CLI as `$SAIFCTL_UNPRIV_USER` (uid != 0). Even with `--dangerousNoLeash`, the agent's CLI doesn't have root inside its own container.
- **Prompt-injection isolation.** The agent's output (code changes, test failures) is **never forwarded** to saifctl's internal AI agents (vague-specs-checker, design agents). Test runner output reaches the orchestrator as raw JSON which never gets concatenated into another agent's prompt. The only AI that reads agent-controlled bytes is the **Reviewer** (Argus), which lives inside the agent's own container and whose verdict is one of three independent checks (gate, reviewer, holdout — see [`gate-and-reviewer.md`](./gate-and-reviewer.md)). Bypassing the Reviewer doesn't pass the holdout tests.
- **Reward-hacking via test/spec edits.** Cedar `forbid` rules block writes under `/workspace/saifctl/` (the dir holding `specification.md` + visible tests) — see #6 + the user-facing `concepts/leash-access-control.md` page. Agent-written test files would also be stripped from the patch via `patchExclude` even if the Cedar layer were bypassed.
- **Hidden tests are hidden.** Files under `<feature>/tests/hidden/` are kept in the host's authoritative tree and not staged into the sandbox copy ([`sandbox.ts:16`](../../../src/orchestrator/sandbox.ts#L16)). The agent has no observation of what the hidden tests check.
- **Agent identity in commits.** Every commit produced by `feat run` is signed with a dedicated git-author identity (`saifctl-agent[<run-id>]`), so the agent's commits are distinguishable from human commits in `git log`. Audit-trail benefit; documented in the website's `RELIABILITY_ROWS`.

## Original design-time findings

The original audit (Feb 2026) identified seven critical/high/low items in the design. All resolved; this section documents what was fixed and where.

### #1. Host command injection via unsanitized `stderr` feedback

**Severity:** CRITICAL · **Status:** ✅ Resolved

**Original flaw**: The orchestrator fed raw test-runner stderr back to the agent via a synchronous `execSync` call with shell string interpolation, allowing a malicious agent (writing tests that emit shell-special bytes) to inject arbitrary commands on the host.

**Mitigation**:

- Raw test-runner output is **never** forwarded to the agent. The orchestrator emits a deliberately vague message instead: `"An external service attempted to use this project and failed."` The Vague Specs Checker may append a sanitized behavioural hint (see [`spec-pipeline.md`](./spec-pipeline.md)), but never raw stderr.
- All agent invocations go through `spawn(cmd, args, …)` with the task prompt as an array element, not a shell-interpolated string. Shell injection via the task string is structurally impossible.
- Verify: `grep -rln execSync src/orchestrator/` returns nothing (intentional).

### #2. Arbitrary code execution via malicious patch (`.git/hooks/` injection)

**Severity:** CRITICAL · **Status:** ✅ Resolved

**Original flaw**: Agent crafts a patch containing `.git/hooks/pre-commit`. Host applies the patch, runs `git commit`, and the injected hook executes on the host.

**Two-layer mitigation**:

1. **Patch filter at sandbox boundary** ([`src/orchestrator/modes.ts:1480-1554`](../../../src/orchestrator/modes.ts#L1480)). `buildPatchExcludeRules` includes `.git/hooks/**` in the default `patchExclude` set. The exclude list is applied during `extractIncrementalRoundPatch()` so the hook never reaches the recorded `RunCommit` diff.
2. **Last-resort guard before host apply** ([`src/orchestrator/phases/apply-patch.ts:75-262`](../../../src/orchestrator/phases/apply-patch.ts#L75)). `assertRunCommitsSafeForHost(commits)` scans combined diffs for `^diff --git.*\.git/hooks/` and throws hard if any match. The same check fires inside `runApplyCore` before `saifctl run apply` reconstructs the branch ([`modes.ts:1710`](../../../src/orchestrator/modes.ts#L1710)).

**Why two layers**: covers the path where commits reach the host without going through the sandbox filter — externally supplied or replayed run-storage data, for example.

**Note**: `.github/` is intentionally **not** excluded. Agents are permitted to create PR templates, workflows, and other GitHub-facing files as part of legitimate feature work.

### #3. Root privilege escalation via Docker socket mount

**Severity:** CRITICAL · **Status:** ✅ Resolved

**Original flaw**: An early design suggested mounting `/var/run/docker.sock` so the test runner could test CLI containers. Mounting the socket gives any container root-equivalent control over the host Docker daemon (it can spawn privileged containers, mount the host filesystem, etc.).

**Mitigation**: The Docker socket is **never** mounted. The test runner talks to the staging container exclusively over HTTP via an injected sidecar — see [`src/orchestrator/sidecars/cli-over-http/`](../../../src/orchestrator/sidecars/cli-over-http/) (a small Go binary). The sidecar is compiled to a self-contained executable and injected into the staging container via `putArchive` — no socket, no `docker exec`, no daemon access.

See [`test-runner.md`](./test-runner.md) for the full sidecar protocol.

### #4. Path traversal & shell injection via `featureName`

**Severity:** HIGH · **Status:** ✅ Resolved

**Original flaw**: `featureName` was passed directly into shell commands and file paths without sanitization, enabling path traversal (`../../../etc`) or shell injection (`my-feature; rm -rf /`).

**Mitigation**: `validateFeatureName()` at [`src/cli/utils.ts:227`](../../../src/cli/utils.ts#L227) enforces kebab-case / safe path segments at the CLI boundary. Any name containing path-traversal characters, spaces, or shell metacharacters is rejected immediately with a clear error, *before* any shell command is constructed.

Applied at every entry point: `--name`/`-n` flag (`utils.ts:245`), the `saifctl feat new` interactive prompt, and any internal call sites that construct paths from user input.

Defense-in-depth: shell commands that *do* use `featureName` quote paths (`"${sandboxBasePath}"`), but the primary control is the boundary regex.

### #5. Default container capabilities (root, unrestricted privileges)

**Severity:** HIGH · **Status:** ✅ Resolved

**Original flaw**: Containers were created without restricting the default root user or Linux capabilities, enabling privilege-escalation attempts and ambient resource theft from inside the container.

**Mitigation** — at [`src/engines/docker/index.ts:285-286`](../../../src/engines/docker/index.ts#L285) (staging container) and `:410-411` (test runner container):

```ts
HostConfig: {
  SecurityOpt: ['no-new-privileges'],   // blocks setuid/setgid escalation
  CapDrop: ['ALL'],                     // drops all Linux capabilities
}
```

Plus `User: 'node'` (uid 1000, ships in all official Node images) so processes run as a non-root user.

The `--dangerousNoLeash` codepath ([`index.ts:604`](../../../src/engines/docker/index.ts#L604)) keeps `--security-opt=no-new-privileges` on the `docker run` command — the kernel-side hardening doesn't depend on Leash.

**Auxiliary containers** (postgres, redis, etc. spawned via the services layer) get `SecurityOpt: ['no-new-privileges']` but **not** `CapDrop: ['ALL']` — database images legitimately need certain capabilities and they don't run agent-controlled code.

**Accepted trade-off**: outbound network access is preserved on the staging and test-runner containers. The agent needs npm/pip/cargo registries; the test runner needs to reach the staging container over the shared Docker network. Documented limitation, mitigated by the filesystem boundary doing the actual exfiltration prevention.

### #6. Host command injection via malicious `.git/config` in sandbox

**Severity:** CRITICAL · **Status:** ✅ Resolved

**Original flaw**: The sandbox's `.git` directory is initialized by the orchestrator, but the agent has write access to `/workspace/`. If the agent could modify `/workspace/.git/config` — e.g. setting `core.fsmonitor` or `diff.external` to a malicious script — those settings would be honoured when the **orchestrator process** (running on the host) invokes `git` with `cwd` pointing into the sandbox's `code/` tree (per-round `extractIncrementalRoundPatch()`, host-side `git apply`, etc.). That's arbitrary code execution outside the agent container's intended trust boundary.

**Mitigation**: A `forbid` rule in [`src/orchestrator/policies/default.cedar:65-71`](../../../src/orchestrator/policies/default.cedar#L65) (and matching rules in `sandbox.cedar`, `deny-network.cedar`):

```cedar
forbid (
    principal,
    action == Action::"FileOpenReadWrite",
    resource
) when {
    resource in [ Dir::"/workspace/.git/hooks/", File::"/workspace/.git/config" ]
};
```

Belt-and-suspenders: even with the patch filter (#2), the policy enforces the boundary at the kernel-syscall level inside the sandbox. The sandbox's `.git` directory is owned by the orchestrator and must not be writable by the agent regardless of which git invocation is involved.

**Narrowing history (2026-05-06)**: the original mitigation was a blanket forbid on `Dir::"/workspace/.git/"`, which broke the reviewer's commit step inside the container — the reviewer needs to commit uncommitted agent changes before diffing `BASE_COMMIT..HEAD`. Verified via [`vendor/leash/docs/design/CEDAR.md`](../../../vendor/leash/docs/design/CEDAR.md) that Leash supports exact-file matching via `File::"…"`, so the policy was narrowed to the two paths that actually trigger host-side code execution. The threat model for #2 (hooks) and #6 (config) is unchanged; everything else under `.git/` (index, objects, refs, HEAD, logs, COMMIT_EDITMSG) is now allowed for normal git plumbing inside the container.

### #7. Shell injection via CLI image flags

**Severity:** LOW · **Status:** ✅ Resolved

**Original flaw**: Early designs interpolated user-supplied image tags from `--test-image` / `--coder-image` into shell one-liners (`execSync(\`docker build -t "${tag}"\`)`). A malicious flag containing double quotes and shell metacharacters could execute arbitrary commands on the user's own host. Because it requires user self-sabotage, the severity is low — but it violates defense-in-depth.

**Two-layer mitigation**:

1. **CLI boundary** — `validateImageTag()` at [`src/utils/docker.ts`](../../../src/utils/docker.ts) (imported in [`src/cli/utils.ts:48`](../../../src/cli/utils.ts#L48)) enforces `^[a-zA-Z0-9_.\-:/@]+$` — covers all valid Docker image-reference characters. Wired at every CLI entry point: `coder-image` ([`utils.ts:1122`](../../../src/cli/utils.ts#L1122)), `test-image` ([`utils.ts:1142`](../../../src/cli/utils.ts#L1142)).
2. **Library boundary** — `assertSafeImageTag()` (same regex) is called before starting the test-runner container, so callers that bypass the CLI (tests, direct API usage) are also protected.

## Summary

| # | Finding | Severity | Mitigation |
|---|---|---|---|
| 1 | `stderr` → shell injection via sync `exec` | CRITICAL | `spawn()` + sanitized feedback (`modes.ts`) |
| 2 | `git apply` `.git/hooks/` injection | CRITICAL | patch filter (`modes.ts:1480`) + pre-apply guard (`apply-patch.ts:75`) |
| 3 | Docker socket → host root | CRITICAL | HTTP sidecar (`sidecars/cli-over-http/`); no socket mount |
| 4 | Path traversal via `featureName` | HIGH | `validateFeatureName` regex at CLI boundary (`utils.ts:227`) |
| 5 | Default container capabilities | HIGH | `User: 'node'`, `CapDrop: ['ALL']`, `no-new-privileges` (`engines/docker/index.ts:285,410`) |
| 6 | `.git/config` host command injection | CRITICAL | Cedar `forbid` write to `Dir::"/workspace/.git/hooks/"` + `File::"/workspace/.git/config"` (`policies/default.cedar:65`) |
| 7 | Shell injection via CLI image flags | LOW | `validateImageTag` at CLI + library boundaries (`utils/docker.ts`) |

## Living-document notes

- **New findings** discovered during development should be added here with the same template (severity, original flaw, mitigation with file:line anchors).
- **Regressions**: if a mitigation is removed or weakened, update the `Status` here AND open a corresponding security item in the release-readiness specification.
- **Cross-references**: the user-facing security concept ([`docspec/products/saifctl/concepts/security.md`](../../../docspec/products/saifctl/concepts/security.md)) is generated from docspec; if the threat model changes, update both.
- **Policy changes**: any narrowing or expansion of Cedar policies in [`src/orchestrator/policies/`](../../../src/orchestrator/policies/) should reference the relevant threat number here so future readers can trace why a `forbid` rule exists.
