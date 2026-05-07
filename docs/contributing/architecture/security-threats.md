# Threat model — design-time findings & mitigations

Specific threats that drove specific code paths, with file:line anchors so you can verify the mitigation is still wired.

> User-facing companion: [`docspec/products/saifctl/concepts/security.md`](../../../docspec/products/saifctl/concepts/security.md). This page is the implementation audit trail.

## Threat model in two sentences

The agent (its CLI + anything it `pip install`s / `npm install`s) is hostile. The host process running saifctl is the target.

Two design principles fall out:

1. **The agent never controls what the host executes.** Anything the agent writes that the host then _honours_ — git config, hooks, patches, stderr piped into a shell — is an escape vector. All seven findings below are variations on this.
2. **Network egress is permitted by default — pragmatic, not principled.** A network allowlist for arbitrary user projects (npm, PyPI, crates, GitHub, doc hosts, per-project deps, …) is intractable. Filesystem isolation is what actually contains the blast radius; the network is a known unmitigated exfiltration channel. Per Decision release-readiness/D-06 in the release-readiness specification.

## Defense-in-depth layers

Five independent layers (defeating one does not defeat the others). Each maps to specific code paths:

1. **Container + policy enforcement** — agent runs in Docker; Leash wraps the process with a default-deny Cedar policy. See [`cedar-and-leash.md`](./cedar-and-leash.md).
2. **Copy-not-mount workspace** — `/workspace/` is a copy of the project tree, not a host bind-mount. Host secrets, `~/.aws`, SSH keys, the host's `.git/`, and `<feature>/tests/hidden/` files are never staged in ([`src/orchestrator/sandbox.ts:16`](../../../src/orchestrator/sandbox.ts#L16)).
3. **Patch as plain-text git diff** — agent output reaches the host as a string, not a process. [`extractIncrementalRoundPatch`](../../../src/orchestrator/sandbox.ts#L1045) extracts → [`filterPatchHunks`](../../../src/orchestrator/sandbox.ts#L1194) strips `.git/hooks/**` + `saifctl/tests/**` → `RunCommit` storage. The only host-side action on a patch is `git apply`, gated by [`assertRunCommitsSafeForHost`](../../../src/orchestrator/phases/apply-patch.ts#L75).
4. **Per-iteration container teardown** — coder, staging, ephemeral services destroyed each iteration. Latent processes can't carry over. [`LiveInfra`](../infra.md) tracks every resource for deterministic teardown even on crash.
5. **Two-container test architecture** — test runner is a separate container, talks to staging over HTTP only via the Go sidecar at [`src/orchestrator/sidecars/cli-over-http/main.go`](../../../src/orchestrator/sidecars/cli-over-http/main.go) (`POST /exec {cmd, args, env, timeout}` → `{stdout, stderr, exitCode}`). No shared memory, no Docker socket. See [`test-runner.md`](./test-runner.md).

The user-facing version of these five lives at [`web/src/app/saifctl/page.tsx`](../../../web/src/app/saifctl/page.tsx) `SECURITY_ROWS`.

## Additional hardening mechanisms

| Mechanism                      | Where                                                                                                                                                                                                                  | What it blocks                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saifctl env-var stripping      | [`src/orchestrator/loop.ts:268`](../../../src/orchestrator/loop.ts#L268)                                                                                                                                               | Agent can't read `SAIFCTL_*` / `LLM_*` / `REVIEWER_LLM_*` vars (saifctl's own credentials, coordination state).                                                                                                                                      |
| Secret-env redaction           | same                                                                                                                                                                                                                   | `--agent-secret KEY` env vars are forwarded but never logged as values, never persisted to run storage.                                                                                                                                              |
| Drop-privileges contract       | [`src/orchestrator/scripts/saifctl-agent-helpers.sh`](../../../src/orchestrator/scripts/saifctl-agent-helpers.sh) + [`drop-privileges-contract.test.ts`](../../../src/agent-profiles/drop-privileges-contract.test.ts) | Each agent profile's `agent.sh` runs the CLI as `$SAIFCTL_UNPRIV_USER` (uid != 0). Even `--dangerousNoLeash` keeps non-root.                                                                                                                         |
| Prompt-injection isolation     | (design invariant; no single file)                                                                                                                                                                                     | Agent output never reaches saifctl's internal AI agents (vague-specs-checker, design agents). Only Argus reads agent bytes; bypassing it doesn't pass holdout tests — three independent gates. See [`gate-and-reviewer.md`](./gate-and-reviewer.md). |
| Reward-hacking forbid          | `default.cedar` + patchExclude                                                                                                                                                                                         | Cedar forbids writes under `/workspace/saifctl/`; even if bypassed, the patch filter strips agent-written test files before storage. See #6 below.                                                                                                   |
| Hidden tests physically absent | [`sandbox.ts:16`](../../../src/orchestrator/sandbox.ts#L16)                                                                                                                                                            | `<feature>/tests/hidden/` is not staged into the sandbox copy. The agent has no observation of what hidden tests check.                                                                                                                              |
| Agent-identity commits         | git author signing                                                                                                                                                                                                     | Every `feat run` commit signed `saifctl-agent[<run-id>]`. Distinguishable from human commits in `git log`. Audit trail.                                                                                                                              |

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

**Mitigation**: `validateFeatureName()` at [`src/cli/utils.ts:227`](../../../src/cli/utils.ts#L227) enforces kebab-case / safe path segments at the CLI boundary. Any name containing path-traversal characters, spaces, or shell metacharacters is rejected immediately with a clear error, _before_ any shell command is constructed.

Applied at every entry point: `--name`/`-n` flag (`utils.ts:245`), the `saifctl feat new` interactive prompt, and any internal call sites that construct paths from user input.

Defense-in-depth: shell commands that _do_ use `featureName` quote paths (`"${sandboxBasePath}"`), but the primary control is the boundary regex.

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

| #   | Finding                                    | Severity | Mitigation                                                                                                               |
| --- | ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `stderr` → shell injection via sync `exec` | CRITICAL | `spawn()` + sanitized feedback (`modes.ts`)                                                                              |
| 2   | `git apply` `.git/hooks/` injection        | CRITICAL | patch filter (`modes.ts:1480`) + pre-apply guard (`apply-patch.ts:75`)                                                   |
| 3   | Docker socket → host root                  | CRITICAL | HTTP sidecar (`sidecars/cli-over-http/`); no socket mount                                                                |
| 4   | Path traversal via `featureName`           | HIGH     | `validateFeatureName` regex at CLI boundary (`utils.ts:227`)                                                             |
| 5   | Default container capabilities             | HIGH     | `User: 'node'`, `CapDrop: ['ALL']`, `no-new-privileges` (`engines/docker/index.ts:285,410`)                              |
| 6   | `.git/config` host command injection       | CRITICAL | Cedar `forbid` write to `Dir::"/workspace/.git/hooks/"` + `File::"/workspace/.git/config"` (`policies/default.cedar:65`) |
| 7   | Shell injection via CLI image flags        | LOW      | `validateImageTag` at CLI + library boundaries (`utils/docker.ts`)                                                       |

## Living-document notes

- **New findings** discovered during development should be added here with the same template (severity, original flaw, mitigation with file:line anchors).
- **Regressions**: if a mitigation is removed or weakened, update the `Status` here AND open a corresponding security item in the release-readiness specification.
- **Cross-references**: the user-facing security concept ([`docspec/products/saifctl/concepts/security.md`](../../../docspec/products/saifctl/concepts/security.md)) is generated from docspec; if the threat model changes, update both.
- **Policy changes**: any narrowing or expansion of Cedar policies in [`src/orchestrator/policies/`](../../../src/orchestrator/policies/) should reference the relevant threat number here so future readers can trace why a `forbid` rule exists.
