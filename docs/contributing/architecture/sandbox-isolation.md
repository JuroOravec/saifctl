# Sandbox isolation — the three-container architecture

Three containers per run, isolated on a single Docker network:

- **Coder** — the agent writes code here. Wrapped by Leash with the active Cedar policy.
- **Staging** — the agent's app runs here for the test runner to hit. Per-iteration fresh.
- **Test runner** — runs tests against staging over HTTP. Separate container by design.

The agent's changes flow out as a plain-text git diff; nothing else crosses the process boundary into the test runner.

> **Related:** [`cedar-and-leash.md`](./cedar-and-leash.md) · [`test-runner.md`](./test-runner.md) · [`security-threats.md`](./security-threats.md) · [`installation-scripts.md`](./installation-scripts.md).

## Why three containers — reward hacking and same-memory test runners

"Make this test pass" + an LLM = the LLM cheats. Two failure modes drive the three-container split:

### Same-language test runners (Vitest, Jest, pytest in-process)

Test harness and production code share a memory space → agent rewrites the harness from inside production code:

```ts
// Inside the agent's "production" code:
vi.mock('fs', () => ({ readFile: () => 'expected output' }));
Object.defineProperty(global, 'fetch', { value: () => Promise.resolve(...fakeResponse) });
```

The test runner imports the production module, which hijacks `vi.mock` / `global.fetch`, forces the assertion to pass. **Same-process test execution is unsafe for autonomous agent loops.**

### Same-OS test runners

Test runner runs on the same OS → agent rewrites the `pytest` binary in `$PATH`, hijacks `stdout` at OS level, swaps shell aliases, replaces system commands with ones returning the expected output.

### Fix: HTTP serialization air-gap

Test runner and agent's app cross-communicate via HTTP only — JSON, exit codes, HTML. The agent can't pass memory references, mock objects, or OS overrides across a network boundary; it has to serialize real responses. Test runner asserts on the bytes.

## The three containers

| Container                | Image                                                                                                                                                                                                                                                                  | Lives where                                                                                                                          | What runs in it                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Coder**                | `saifctl-coder-<profile>:latest` (default `node-pnpm-python`); see [`docs/contributing/docker.md`](../docker.md) for the inventory                                                                                                                                     | Wrapped by Leash with the active Cedar policy ([`cedar-and-leash.md`](./cedar-and-leash.md))                                         | The agent CLI (Claude/Codex/Aider/etc.) and its inner gate loop ([`gate-and-reviewer.md`](./gate-and-reviewer.md)). Workspace at `/workspace/` is a **copy** of the project tree, not a mount.                                                                                                                                     |
| **Staging**              | Ephemeral image `saifctl-stage-<proj>-<feat>-img-<runId>` built per-iteration from the same `Dockerfile.coder` (workspace mounted, deps installed at runtime via `startup.sh`); see [`src/engines/docker/index.ts:253-254`](../../../src/engines/docker/index.ts#L253) | Joined to a per-run bridge network `saifctl-net-<proj>-<feat>-<runId>` ([`index.ts:161`](../../../src/engines/docker/index.ts#L161)) | The application the agent built — a web server (port 3000), a CLI wrapped in the Go sidecar, or both. **No test code, no test runner.** Runs `staging-start.sh` → `startup.sh` → sidecar → `stage.sh` (same script the coder uses for deps; the profile-specific `stage.sh` then starts the app or `wait`s for CLI-only profiles). |
| **Test runner**          | Pre-built per profile (e.g. `saifctl-test-node-vitest:latest`); see [`docs/contributing/docker.md`](../docker.md) for the full profile list                                                                                                                            | Same per-run bridge network as staging                                                                                               | Profile-specific test harness (Vitest, pytest, Go test, Rust test, Playwright). Reads tests from a bind-mount; reaches the staging container only via HTTP. Writes JUnit XML to `SAIFCTL_OUTPUT_FILE`.                                                                                                                             |
| **Auxiliary** (optional) | User-defined (postgres, redis, …)                                                                                                                                                                                                                                      | Same network                                                                                                                         | Digital twins for the staging app to talk to. Defined via the services layer ([`services-and-iac.md`](./services-and-iac.md)).                                                                                                                                                                                                     |

All containers share **only the network namespace**. No shared memory, no shared filesystems beyond the explicit mounts, no Docker socket access, no `docker exec` between them.

## Why no Docker socket — ever

Mounting `/var/run/docker.sock` into the test-runner + `docker exec`-ing into staging would work — and would grant the test runner (and anyone compromising it) root-equivalent control over the host Docker daemon. Critical security antipattern.

Saifctl's answer: HTTP sidecar. A Go binary ([`src/orchestrator/sidecars/cli-over-http/main.go`](../../../src/orchestrator/sidecars/cli-over-http/main.go)) is injected into the staging container via `putArchive`, listens on a port, accepts `POST /exec {cmd, args, env, timeout}`, returns `{stdout, stderr, exitCode}` as JSON. Test runner posts to that endpoint — same as testing a web app.

Net effect: test runner is a black-box HTTP client of staging. No memory state injection, no process-internals reading, no host escape. Same protection for web-app and CLI tests. See [security-threats.md #3](./security-threats.md#3-root-privilege-escalation-via-docker-socket-mount).

## Copy-not-mount workspace

`/workspace/` is a copy at `/tmp/saifctl/sandboxes/<proj>-<feat>-<runId>/code/`, not a bind-mount of the host's working dir ([`src/orchestrator/sandbox.ts`](../../../src/orchestrator/sandbox.ts)).

Copy mode ([`sandbox.ts:213-229`](../../../src/orchestrator/sandbox.ts#L213)):

- **`git archive HEAD`** (default) — committed files only. Local uncommitted edits stay on the host.
- **`rsync`** (`--include-dirty`) — working tree copied in, `.gitignore` respected. For "agent picks up where I left off" workflows.

After copy, before the agent runs:

1. **Recursively remove every `hidden/` dir under `saifctl/features/`** — every feature's, not just the current one. Agent has no observation of holdout tests anywhere.
2. **Re-filter `tests.json`** to public-only ([`sandbox.ts:16`](../../../src/orchestrator/sandbox.ts#L16)).
3. **Fresh `git init` + initial commit** so per-round diffs are clean.

Host's `.git`, secrets, `~/.aws`, SSH keys — unreachable, because they're not in the copy. Cedar still belt-and-suspenders forbids writes to `/workspace/.git/hooks/` and `File::"/workspace/.git/config"` ([security-threats.md #6](./security-threats.md#6-host-command-injection-via-malicious-gitconfig-in-sandbox)).

## Output as plain-text patch

After every round, [`extractIncrementalRoundPatch`](../../../src/orchestrator/sandbox.ts#L1045) walks first-parent from `preRoundHead` to `HEAD` and records one filtered unified diff per commit (+ one more for leftover staged work). Each diff goes through [`filterPatchHunks`](../../../src/orchestrator/sandbox.ts#L1194) — strips `.git/hooks/**`, `saifctl/tests/**`, etc. before storage. Dropped paths logged.

Filtered diffs land in `RunCommit[]` on the run artifact. **The host never `exec`s anything written by the agent.** Host's only action on a patch is `git apply` during reconstruction, gated by [`assertRunCommitsSafeForHost`](../../../src/orchestrator/phases/apply-patch.ts#L75) as a final no-`.git/hooks/` check.

Defense-in-depth layer #3 in [security-threats.md](./security-threats.md#defense-in-depth-layers).

## Per-iteration container freshness

Staging container destroyed at end of each test iteration. [`LiveInfra`](../infra.md) tracks every provisioned resource (containers, networks, volumes, ephemeral images) for deterministic teardown even on crash.

If the agent installs a daemon, opens a socket, seeds `cron`, anything → none of it survives to iteration N+1. State persisting between iterations is limited to:

- Sandbox repo under the coder workspace (the agent's actual code).
- Files explicitly captured in the per-round patch.
- `/tmp/` writes inside the coder container — also destroyed; ephemeral scratch.

Iteration 14 hangs the sidecar / corrupts a digital-twin DB / crashes staging? Iteration 15 starts clean.

## Telemetry & network observation

Leash (default-on) is both the syscall interceptor AND a local HTTP MITM proxy on Linux ([`vendor/leash/docs/MACOS.md`](../../../vendor/leash/docs/MACOS.md) — macOS uses Network Extension only, no MITM). Every outbound `connect()` runs through Cedar `NetworkConnect` rules; HTTP traffic can be inspected/logged.

Default Cedar policy permits all outbound — see [`cedar-and-leash.md`](./cedar-and-leash.md#why-the-network-is-unrestricted-by-default) for the rationale. Custom Cedar can deny by domain; bundled `deny-network.cedar` is a starting point.

Leash dashboard surfaces the observation when enabled — see [Leash docs](../../../vendor/leash/README.md).

## `--engine local` — opting out of coder isolation

Runs the agent's CLI directly on the host instead of in a coder container. **No Cedar, no Leash, no copy-not-mount, no isolation.** Trade: fast iteration vs zero isolation.

The staging + test-runner containers are still containerized in `--engine local`; only the _coder_ slot is host-direct. **Never appropriate** for unattended runs against untrusted code. See [`cedar-and-leash.md`](./cedar-and-leash.md#-engine-local) for full caveats.

## Why this isn't 1:1 with SWE-bench

|               | SWE-bench                               | Saifctl                                                                                                      |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Languages     | Hardcoded to Python (`pytest`, `tox`)   | POSIX exit codes from arbitrary bash; `--profile` picks runtime; same orchestration drives TS/Python/Go/Rust |
| Test runner   | Same container as agent                 | Separate container, HTTP-only access to staging                                                              |
| Holdout tests | Hidden test file injected at grade time | Recursively stripped from sandbox copy; never reachable by the agent                                         |

## See also

- [`cedar-and-leash.md`](./cedar-and-leash.md) — the policy enforcement that wraps the coder container.
- [`test-runner.md`](./test-runner.md) — full sidecar protocol; how the test runner exercises the staging container.
- [`gate-and-reviewer.md`](./gate-and-reviewer.md) — what each gate (gate / reviewer / holdout) checks; outer ↔ inner loop split.
- [`installation-scripts.md`](./installation-scripts.md) — `startup.sh` / `gate.sh` / `stage.sh` lifecycles.
- [`security-threats.md`](./security-threats.md) — full threat model including the seven design-time findings.
- [`../docker.md`](../docker.md) — image inventory, build commands, GHCR publishing.
- [`../infra.md`](../infra.md) — `LiveInfra` resource tracker (deterministic teardown).
