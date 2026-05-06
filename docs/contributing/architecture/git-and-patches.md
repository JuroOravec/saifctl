# Git and patches

The agent's changes flow as plain-text git diffs through three repos:

1. **Sandbox repo** at `/tmp/saifctl/sandboxes/<proj>-<feat>-<runId>/code/` — fresh `git init`, not a clone of the host. Where the agent edits and commits.
2. **Run artifact** — `RunCommit[]` records: per-round filtered diffs persisted to run storage. Source of truth for resume / fork / apply.
3. **Host worktree** at `/tmp/saifctl/worktrees/<runId>/` — temporary, applied on success. Branch `saifctl/<feat>-<runId>` is what gets pushed.

The user's working directory is never modified during the loop.

> **Related:** [`sandbox-isolation.md`](./sandbox-isolation.md) · [`security-threats.md`](./security-threats.md) · [`extension-points.md`](./extension-points.md#git-providers) · [`orchestrator.md`](./orchestrator.md).

## Three Git phases

| Phase | Where | Purpose |
|---|---|---|
| **Sandbox** | `/tmp/saifctl/sandboxes/<proj>-<feat>-<runId>/code/` | Fresh git repo (not a clone). Host's `.git` is never mounted or copied. Diff agent changes against a baseline. |
| **Tests** | Same sandbox | [`extractIncrementalRoundPatch`](../../../src/orchestrator/sandbox.ts#L1045) leaves `code/` at a new commit; staging reads from there directly (no extra `git apply`). `run test` mode reuses the same layout. |
| **Success** | Host repo | Git **worktree** creates a feature branch, applies the patch, commits, optionally pushes + PRs — without changing the main working tree's checked-out branch. |

The host's working directory is **never modified** during the convergence loop. Worktree apply happens only after gate + reviewer + holdout all pass. User's current branch + uncommitted work stay untouched → safe parallel runs.

## Working tree contract

Default: saifctl assumes a clean, committed state at `HEAD`. Sandbox is filled with `git archive HEAD` — the tree git knows about, not what's on disk.

`--include-dirty` (or `defaults.includeDirty`): `rsync` of the working tree instead (committed + staged + unstaged + untracked, `.gitignore`-respected).

| Mode | Pro | Con |
|---|---|---|
| `git archive HEAD` (default) | Baseline aligns with git; what-the-agent-sees = what's-committed | WIP not visible to the agent |
| `--include-dirty` | WIP visible to the agent | Host-apply can bake WIP paths into feature-branch history |

For dirty trees needing fine control: `saifctl run export` + manual `git apply` (staged for review). **CI / unattended runs should stay on the default.**

## Sandbox creation

[`createSandbox()`](../../../src/orchestrator/sandbox.ts) at [`src/orchestrator/sandbox.ts`](../../../src/orchestrator/sandbox.ts) provisions the per-run directory:

```
{sandboxBaseDir}/{projectName}-{featureName}-{runId}/
├── policy.cedar         ← Cedar policy (cedar-and-leash.md)
├── gate.sh              ← Gate script bind-mounted into coder container
├── tests.full.json      ← Full test catalog (public + hidden) for the test runner
└── code/
    ├── .git/            ← Fresh git repo (not a clone; not the host's .git)
    │
    ├── (project tree from `git archive HEAD` or rsync)
    │
    ├── saifctl/features/<feat>/tests/
    │   ├── tests.json   ← Public-only catalog (visible to agent)
    │   ├── public/      ← Public specs
    │   └── (hidden/ dir removed)
    │
    └── saifctl/features/<other-feat>/
        └── tests/
            └── (hidden/ dir removed for ALL features)
```

Sequence:

1. Create `sandboxBasePath/code/` and copy the project (git archive or rsync per `--include-dirty`).
2. **Recursively delete every `hidden/` dir under `saifctl/features/`** — not just current feature, every feature. Belt-and-suspenders against agents reading holdout tests from other features.
3. Re-filter `tests.json` to public-only.
4. `git init` in `code/`; `git add .`; `git commit -m "saifctl baseline"` with author `saifctl <saifctl@safeaifactory.com>` ([`SAIFCTL_DEFAULT_AUTHOR`](../../../src/orchestrator/patch.ts#L9)).
5. Write `policy.cedar`, `gate.sh`, helper scripts to `sandboxBasePath/`.

The `.git` directory inside `code/` is the **agent's working git history**. It is wholly separate from the host's `.git` — the host's commits, branches, and remotes are never visible to the agent.

## Patch extraction (incremental rounds)

After every agent round (post-`agent.sh`, pre-gate), [`extractIncrementalRoundPatch`](../../../src/orchestrator/sandbox.ts#L1045) converts in-container files to plain-text diffs the host can persist:

1. Read pre-round HEAD + current HEAD.
2. Walk first-parent chain from pre-round HEAD → current HEAD. Per commit, `git diff --binary` → unified diff.
3. Capture leftover staged work (if any) as one extra patch — covers "agent edited, didn't commit".
4. Filter each through [`filterPatchHunks`](../../../src/orchestrator/sandbox.ts#L1194) (strips `patchExclude` paths).
5. Persist as `RunCommit[]` on the run artifact (filtered diff + commit message + author + parent SHA).

Why this shape:

- **Per-commit granularity** → `run start` / `run resume` can replay commit-by-commit. Single big patch would lose order.
- **First-parent walk** → ignores merge commits the agent might create. Only linear progression matters.
- **Filtered before storage** → run artifact never contains forbidden paths. A leaked storage backend doesn't expose `.git/hooks/` injection vectors.

### Patch-exclude rules

Default set from [`buildPatchExcludeRules`](../../../src/orchestrator/loop.ts#L111):

| Pattern | Why |
|---|---|
| `.git/hooks/**` | Host `git apply` would honour these — see [`security-threats.md` #2](./security-threats.md#2-arbitrary-code-execution-via-malicious-patch-githooks-injection). |
| `saifctl/tests/**` | Project-immutable; reward-hacking prevention. |
| `<saifctl-dir>/.saifctl/**` | Factory-internal workspace state (task file, stats, etc.). Not product code. |
| Custom `--patch-exclude` rules | Project-specific (e.g. `dist/`, `*.snap`). |

Two-layer enforcement: `filterPatchHunks` strips hunks before storage; `assertRunCommitsSafeForHost` throws if a `.git/hooks/` path slips through (last-resort guard before host `git apply`).

## Sandbox reset between attempts

The sandbox repo is **not reset** when a round fails the gate. Agent commits stack up; each retry can build on (or reverse) previous commits. Per-round patches still extract incrementally, so the run record reflects what changed between rounds.

`--max-runs` exhausted → sandbox is the artifact; `saifctl run inspect` to step in at the latest state.

`run start` from a saved run → orchestrator replays `RunCommit[]` onto a fresh sandbox baseline. Same semantics as if the original run had completed up to that point.

## Patch application for tests

After patch extraction, the **staging container reads `code/` directly** — no `git apply` step, no extra copy. The staging container's `/workspace/` mount points at the same `code/` directory the agent edited. The test runner reaches the staging container over HTTP via the sidecar ([`test-runner.md`](./test-runner.md)).

Why no `git apply` for the staging container: the agent's commits *are* the post-patch state. Applying the diff back on top would be a no-op. Saves the round-trip.

## Iterative loop: commit, then verify

Per round:

1. Agent edits files in `/workspace/` (mounted sandbox `code/`).
2. Agent commits before exiting. (Aider with `--no-auto-commits` is the exception — saifctl auto-commits on the agent's behalf.)
3. `extractIncrementalRoundPatch` captures committed work + leftover staged + unstaged.
4. Gate + Reviewer run inside the container ([`gate-and-reviewer.md`](./gate-and-reviewer.md)).
5. Test runner runs in a separate container against staging.

The test runner sees exactly what the agent committed plus leftover edits. **No host-side mutation between commit and test.**

## Success path: apply patch to host via worktree

All gates pass → [`src/orchestrator/phases/apply-patch.ts`](../../../src/orchestrator/phases/apply-patch.ts) applies the work to the host:

1. [`assertRunCommitsSafeForHost`](../../../src/orchestrator/phases/apply-patch.ts#L75) scans combined `RunCommit` diffs for `^diff --git.*\.git/hooks/`; throws on match. Last-resort guard for commits that reach the host without the sandbox filter (externally-supplied data, replayed run-storage).
2. Create worktree at `/tmp/saifctl/worktrees/<runId>/` pointing at branch `saifctl/<feature>-<runId>`. User's working tree untouched.
3. Apply each `RunCommit` in order: `git apply` then `git commit` with stored author + message (or [`SAIFCTL_DEFAULT_AUTHOR`](../../../src/orchestrator/patch.ts#L9) if missing). `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` set for attribution.
4. Optionally push + PR (next sections).
5. Worktree torn down on success or failure.

### Sandbox vs. worktree asymmetry

Sandbox `code/` ≠ worktree `<feature-branch>`. Two separate physical dirs because:

- Sandbox `.git` history starts at the saifctl baseline commit, not user's `main`. Host commits need to thread off user's actual branch base.
- `--include-dirty` may have rsync'd files the user didn't mean to commit. Worktree apply replays only the recorded `RunCommit` diffs, not working-tree state.
- Sandbox is ephemeral; worktree commits to host's `.git/` for user review.

## Push target resolution

`--push` (or `defaults.push`) → orchestrator pushes the feature branch. Provider-aware ([`extension-points.md` Git providers](./extension-points.md#git-providers)):

| Source | Behaviour |
|---|---|
| `--push <target>` | Explicit URL or named remote; provider auto-detected from URL. |
| `defaults.push.url` in config | Same. |
| `defaults.push: true` (no flag) | Push to resolved `origin`. |

Auth: each provider's `resolvePushUrl()` injects the matching `*_TOKEN` env var into the push URL. Tokens are env-only, never passed as arguments, URL-with-token only lives for the `git push` invocation, never logged or persisted.

GitHub example: `GITHUB_TOKEN=… → https://x-access-token:${GITHUB_TOKEN}@github.com/owner/repo.git`. Username is provider-specific (`x-access-token` for GitHub fine-grained tokens).

## PR creation

`--pr` (or `defaults.pr`) → after push, orchestrator calls provider's `createPullRequest()`:

- Title + body templated from `specification.md` + `plan.md`. Optionally summarized via [`src/git/agents/pr-summarizer.ts`](../../../src/git/agents/pr-summarizer.ts) (small Mastra agent that builds a structured summary from spec + diff).
- Base branch: `defaults.pr.base` (default `main`).
- Head branch: the just-pushed `saifctl/<feature>-<runId>`.

PR/MR URL surfaced in the run summary. Saifctl does **not** auto-merge — user reviews.

## Security considerations

Five mitigations on the agent → host → remote-host trust path. All cross-link [`security-threats.md`](./security-threats.md):

| # | Layer | Where | Threat |
|---|---|---|---|
| 1 | Patch filter before storage | [`filterPatchHunks`](../../../src/orchestrator/sandbox.ts#L1194) strips `.git/hooks/`, `saifctl/tests/` before `RunCommit` persists | #2 |
| 2 | Pre-apply guard on host | [`assertRunCommitsSafeForHost`](../../../src/orchestrator/phases/apply-patch.ts#L75) re-scans before `git apply` | #2 |
| 3 | Cedar `forbid` writes | `/workspace/.git/hooks/` + `File::"/workspace/.git/config"` blocked at syscall level | #2, #6 |
| 4 | Worktree isolation | Host apply uses separate physical dir; user's branch + uncommitted work untouched | — |
| 5 | Token handling | Read from env, injected only for `git push`, never logged or persisted | — |

Defense-in-depth: even if Cedar were bypassed (it isn't — Leash enforces at syscall level), the patch filter strips it; even past the filter, the pre-apply guard catches it; even if applied, the worktree is a temp dir, not the user's working tree.

## Parallel-run safety

Multiple `feat run` invocations on the same project run concurrently. Each run gets a unique:

| Resource | Path |
|---|---|
| Sandbox dir | `/tmp/saifctl/sandboxes/<proj>-<feat>-<runId>/` |
| Worktree dir | `/tmp/saifctl/worktrees/<runId>/` |
| Docker network | `saifctl-net-<proj>-<feat>-<runId>` |
| Branch name | `saifctl/<feature>-<runId>` |
| Run-storage key | `<runId>` |

The user's working directory is never modified. The only shared state is the host's `.git/` (under `.git/saifctl/<runId>/`-prefixed worktrees); git's worktree mechanism handles concurrent operations as long as branches are unique — saifctl ensures uniqueness via `<feature>-<runId>` naming.

## See also

- [`sandbox-isolation.md`](./sandbox-isolation.md) — copy-not-mount workspace; why the sandbox `code/` is a fresh git repo.
- [`security-threats.md` #2 + #6](./security-threats.md#2-arbitrary-code-execution-via-malicious-patch-githooks-injection) — the threats that drove the patch filter + pre-apply guard + Cedar forbid.
- [`orchestrator.md`](./orchestrator.md) — when each git phase fires within the convergence loop.
- [`extension-points.md` Git providers](./extension-points.md#git-providers) — adding a new git host.
- [`docspec/products/saifctl/concepts/source-control.md`](../../../docspec/products/saifctl/concepts/source-control.md) — user-facing concept (push/PR pipeline).
