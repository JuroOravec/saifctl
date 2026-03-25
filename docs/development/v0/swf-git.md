# Git Usage in the Software Factory

This document describes all the ways Git is used throughout the AI-Driven Software Factory workflow. It serves as the authoritative reference for developers maintaining the orchestrator and for anyone who needs to understand how patches flow from agent output to the host repository.

## Table of Contents

1. [Overview](#1-overview)
2. [Sandbox Creation](#2-sandbox-creation)
3. [Patch extraction (incremental rounds)](#3-patch-extraction-incremental-rounds)
4. [Patch Exclude Rules (Reward-Hacking Prevention)](#4-patch-exclude-rules-reward-hacking-prevention)
5. [Sandbox Reset Between Attempts](#5-sandbox-reset-between-attempts)
6. [Patch Application for Tests](#6-patch-application-for-tests)
7. [Iterative loop: commit, then verify](#7-iterative-loop-commit-then-verify)
8. [Success Path: Apply Patch to Host via Worktree](#8-success-path-apply-patch-to-host-via-worktree)
   - [Sandbox vs. worktree source asymmetry](#sandbox-vs-worktree-source-asymmetry)
9. [Push Target Resolution and GITHUB_TOKEN](#9-push-target-resolution-and-github_token)
10. [Security Considerations](#10-security-considerations)

---

## 1. Overview

The Software Factory uses Git in three distinct phases:

| Phase       | Where                                                     | Purpose                                                                                                                                                                |
| ----------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sandbox** | Isolated `code/` directory inside `/tmp/saifac/sandboxes/` | A _fresh_ Git repo (not a clone) used solely for diffing agent changes against a baseline. The host's `.git` is never mounted or copied, to avoid exposing git history |
| **Tests**   | Same sandbox                                              | **`feat run` / `run resume`:** after each round, `extractIncrementalRoundPatch` leaves `code/` at a new commit — staging/tests run on that tree (no extra `git apply` of the round diff). **`run test`:** same sandbox layout as resume (base snapshot + replayed `runPatchSteps`); **`runIterativeLoop`** runs in **test-only** mode (no coding agent) and reuses the same staging / test-retry / vague-specs path. |
| **Success** | Host repository                                           | A Git worktree is used to create a feature branch, apply the patch, commit, and optionally push/PR—_without ever changing the main working tree's checked-out branch_. |

The host repository's working directory is **never** modified during the loop. All agent edits happen in the sandbox. Only after tests pass does the orchestrator create a separate worktree, apply the patch there, commit it, and optionally push. The user's current branch and uncommitted work remain untouched—enabling safe parallel runs of multiple agents.

---

## 2. Sandbox Creation

**Location:** `src/orchestrator/sandbox.ts` → `createSandbox()`

**Directory structure produced:**

```
{sandboxBaseDir}/{projectName}-{featureName}-{runId}/
  tests.full.json     ← Full test catalog (public + hidden) for the Test Runner
  code/               ← rsync copy of the repo; workspace for OpenHands
    .git/             ← Fresh git repo (git init), NOT a clone of the host
    saifac/features/
      (all hidden/ dirs removed — agent cannot see holdout tests from any feature)
      {featureName}/tests/tests.json  ← Public-only tests
    ...rest of repo...
```

### Key Git-related steps

1. **rsync** copies the repo into `code/`, honoring `.gitignore` and **excluding** the host's `.git`:

   ```bash
   rsync -a --filter=':- .gitignore' --exclude='.git' "${projectDir}/" "${codePath}/"
   ```

   The sandbox starts with no Git history from the host.

2. **Remove all `hidden/` dirs** under `saifac/features/` from the code copy. This strips holdout tests from _every_ feature (not just the current one), so the agent cannot read or infer them. The Test Runner later mounts the real `hidden/` dirs from the host when verifying the patch.

3. **Fresh Git repo inside `code/`:**

   ```bash
   git init
   git add .
   git commit -m "Base state"
   ```

   Uses fixed author/committer (`saifac`, `saifac@safeaifactory.com`) for reproducibility.

4. **Why a fresh repo?** The sandbox is a _pure file copy_ used for diffing. The agent (OpenHands) writes files; we need a clean baseline to compute per-round diffs. Cloning the host repo would bring along its history and remotes—unnecessary and potentially confusing when we later apply the patch to a different branch.

**Resume / `run test`:** `createSandbox()` may set `codeSourceDir` to a **base snapshot** directory (tree before `runPatchSteps`) and pass `runPatchSteps` to **replay** each step as its own commit after `"Base state"`. The sandbox is still built with **rsync**, not `git clone --local`.

---

## 3. Patch extraction (incremental rounds)

**Location:** `src/orchestrator/sandbox.ts` → `extractIncrementalRoundPatch()`

After each agent round, the orchestrator walks the **first-parent** chain from `preRoundHeadSha` to `HEAD` and emits **one `RunPatchStep` per commit** (message and author from that commit; diff `parent..commit`, with exclude rules applied). Any **leftover staged** work (including “only uncommitted” rounds) gets **one** extra commit with `saifac: coding attempt <n>` and a matching step.

### Sequence

1. **`git rev-list --reverse --first-parent preRoundHead..HEAD`** — ordered commit SHAs for this round.

2. **Per commit:** `git diff parent..sha`, `%B` / `%an <%ae>` for message and author, then **filter** excluded paths (see [§4](#4-patch-exclude-rules-reward-hacking-prevention)). Empty diffs after filtering are skipped.

3. **`git add`**, unstage `.saifac/`. If the index is non-empty, **commit** with the round default message/author, then append the WIP step (`git diff` from tip-before-WIP to `HEAD`). If the filtered WIP diff is empty, the capture commit is undone with `git reset --soft HEAD~1` so excluded-only staging does not advance `HEAD` without a recorded step.

4. **Write** combined **`patch.diff`** beside `code/` and append all new steps to **`run-patch-steps.json`** (callers merge into the accumulator).

The sandbox **is not** reset before tests: staging runs against `code/` at `HEAD`. On test failure, the loop **pops every step from this round** from the accumulator, updates `run-patch-steps.json`, and **resets** to `preRoundHeadSha` (see [§5](#5-sandbox-reset-between-attempts)).

---

## 4. Patch Exclude Rules (Reward-Hacking Prevention)

**Location:** `src/orchestrator/modes.ts` (patchExclude), `sandbox.ts` (filterPatchHunks)

The agent must not be able to "cheat" by modifying tests or specs to fake a pass. Before any patch is applied to the host, certain file sections are stripped from the unified diff.

### Always-excluded paths

| Pattern         | Purpose                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `saifac/**`     | The agent must not modify its own test specifications or test cases.             |
| `.git/hooks/**` | A malicious patch could install a git hook that runs arbitrary code on the host. |

### How filtering works

- A unified diff consists of file sections, each starting with `diff --git a/<path> b/<path>`.
- The patch is split on those headers; each section is tested against the exclude rules (glob or regex).
- Matching sections are dropped. A warning is logged listing dropped files.

---

## 5. Sandbox reset between attempts

**Location:** `loop.ts` → iterative loop failure path (`gitResetHard` / `gitClean`)

After **failed** tests (or when the agent must retry), the orchestrator **drops the whole outer attempt** from the artifact: it removes **all** `runPatchSteps` entries recorded for that attempt (one entry per sandbox commit on the first-parent chain, plus an optional WIP step — see [§3](#3-patch-extraction-incremental-rounds)), then resets `code/` to **`preRoundHeadSha`**, the commit that was `HEAD` at the **start** of that attempt (includes any commits from earlier successful rounds in the same run, and seed steps when resuming).

### Commands

```bash
git reset --hard "${preRoundHeadSha}"
git clean -fd
```

- `git reset --hard`: Restores the tree to the state before **this attempt’s** commits (all of them), i.e. back to `preRoundHeadSha`.
- `git clean -fd`: Removes untracked files and directories.

**Ralph Wiggum technique:** Each OpenHands run starts from this clean state. The agent has no memory of previous attempts beyond what we explicitly feed back (e.g., sanitized error hints). State is persisted via the file system and **`runPatchSteps`** — not via chat history.

---

## 6. Patch application for tests

**`saifac feat run` / `run resume` (inner loop):** **Location:** `loop.ts` — after `extractIncrementalRoundPatch`, `code/` is already at the round commit; staging mounts that tree. There is **no** `git apply` of `patch.diff` for verification in this path.

**`saifac run test`:** **Location:** `modes.ts` → `runFromStoredRunCore({ testOnly: true })` → `runStartCore` → `loop.ts` → `runIterativeLoop` with **`OrchestratorOpts.testOnly`**. Worktree and sandbox setup match **`run resume`**: `resume.ts` → `createResumeWorktree()`, then `sandbox.ts` → `createSandbox()` with the resume worktree as **`sandboxSourceDir`**, **base snapshot** as **`codeSourceDir`**, and **`seedRunPatchSteps`** replayed into `code/`.

The stored `basePatchDiff` (tracked/staged vs `HEAD` **plus untracked files**) is applied in the **temporary resume worktree**, then **`saifac: base patch`** is committed, then each **`runPatchStep`** is applied and committed in order (**same reconstruction as `run resume`**). The sandbox is built by **rsync** from a **base snapshot** (before run steps) plus **replay** of `runPatchSteps` inside `code/` — not via `git clone --local`. There is **no** second code path such as a separate `runTestsCore`: the orchestrator writes **`run-patch-steps.json`** in the sandbox from the stored steps, runs **`runStagingTestVerification`** (staging + test retries + optional vague-specs handling), and persists outcomes through the same **`cleanupAndSaveRun`** path as **`run resume`**.

**Host apply:** **`applyPatchToHost`** is called with **`projectDir`** set to the **CLI project directory** (the user’s repo root), **not** the ephemeral resume worktree. `git worktree add` for the success path therefore starts from the host repo’s `HEAD` without the stored patch already present, so each incremental step applies cleanly. Using the resume worktree as `projectDir` here would replay steps onto a tree that already contains them and can produce errors such as *already exists in working directory* (see [§8](#8-success-path-apply-patch-to-host-via-worktree)).

---

## 7. Iterative loop: commit, then verify

**Location:** `modes.ts` → `runStartCore` → `runIterativeLoop()` (`loop.ts`)

In **saifac feat run** and **saifac run resume**, the flow is:

1. Remember `preRoundHeadSha` (current `HEAD` in `code/` before the agent runs).
2. OpenHands runs and modifies files in the sandbox.
3. `extractIncrementalRoundPatch` records **one `RunPatchStep` per agent commit** (first-parent chain) plus an optional WIP step, and appends them to **`run-patch-steps.json`** (see [§3](#3-patch-extraction-incremental-rounds)).
4. The Staging container uses the **`code/`** tree **as committed** — no separate `git apply` step before tests.
5. If tests fail, the last step is removed, `code/` is reset to `preRoundHeadSha`, feedback is sent to OpenHands, and the loop repeats.

**`saifac run test`** enters the same `runIterativeLoop` with **`testOnly`**: steps 1–2 and 5 are skipped (no agent, no reset-and-retry outer loop). The sandbox already reflects replayed **`runPatchSteps`**; the loop writes **`run-patch-steps.json`**, runs **`runStagingTestVerification`** once, then success/failure handling matches the normal path (including **`applyPatchToHost`** when tests pass). **Hatchet:** `feat-run` → `convergence-loop` branches the same way when **`testOnly`** is set on serialized opts.

---

## 8. Success Path: Apply Patch to Host via Worktree

**Location:** `src/orchestrator/phases/apply-patch.ts` → `applyPatchToHost()` (invoked from `loop.ts` / Hatchet `apply-patch` task)

When all tests pass, the orchestrator applies the winning patch to the **host** repository. To avoid mutating the user's checked-out branch (and to support parallel agent runs), we use **Git worktrees**.

### Design goals

- **Never touch the main working tree.** The user may have multiple agents running; each must be able to create its own branch without conflicting.
- **Branch visibility.** The new branch `saifac/<featureName>-<runId>` appears in `git branch` immediately and persists after the worktree is removed.
- **Optional push and PR.** The user can supply `--push` and `--pr` to push the branch and open a GitHub Pull Request.

### Flow

1. **Read `run-patch-steps.json`** from `sandboxBasePath` (ordered `{ message, diff, author? }[]`). A combined **`patch.diff`** may be written beside it for the PR summarizer (concatenated step diffs).

2. **Security check:** Reject patches that touch `.git/hooks/` (see [§10](#10-security-considerations)).

3. **Create a worktree** at `{sandboxBasePath}/worktree` on a new branch:

   ```bash
   git worktree add "${sandboxBasePath}/worktree" -b "saifac/${featureName}-${runId}"
   ```

   - Branch name includes `runId` to avoid collisions when multiple agents run in parallel.
   - The worktree lives inside the sandbox so it is removed when `destroySandbox` runs.
   - The main repo's `HEAD` is never changed.

4. **Apply host-base snapshot** (if any) so the worktree matches the sandbox baseline, then **for each step**: `git apply` the step diff, `git add .`, `git commit` with that step’s **message** and **author** (see `applyPatchToHost` in `phases/apply-patch.ts`).

5. **Optional push:** If `--push` is set, resolve the push target (see [§9](#9-push-target-resolution-and-github_token)) and:

   ```bash
   git push "${pushUrl}" "${branchName}"
   ```

6. **Optional PR:** If `--pr` is set (and `--push` was provided), call the GitHub REST API to create a Pull Request. Base branch is the branch the user had checked out when the command started.

7. **Remove the worktree:**
   ```bash
   git worktree remove --force "${wtPath}"
   ```
   This deregisters the worktree from Git's internal registry. The branch remains in the repo. The sandbox directory (including the worktree path) is then deleted by `destroySandbox`.

### Sandbox vs. worktree source asymmetry

The sandbox and the worktree are populated from different sources. This asymmetry has important consequences.

| Location            | How it is created                  | What it contains                                                 |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| **Sandbox `code/`** | `rsync` from the main working tree | Full working tree state: committed + UNCOMMITTED + **untracked** |
| **Worktree**        | `git worktree add` from `HEAD`     | Only **COMMITTED** files at `HEAD`                               |

- **Sandbox:** When `createSandbox()` runs, it uses `rsync -a --filter=':- .gitignore' --exclude='.git' "${projectDir}/" "${codePath}/"`. This copies everything from the main working tree that is not gitignored, including untracked files and directories. The agent (OpenHands) therefore sees and can rely on paths like `saifac/features/<featureName>/` even if they have never been committed.

- **Worktree:** When `git worktree add "${wtPath}" -b "${branchName}"` runs, Git creates a new working tree for the branch starting at the current `HEAD` commit. A worktree contains only what is in that commit. Untracked and uncommitted files from the main working tree are not present.

### CLI options

| Option            | Description                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--push <target>` | Push the feature branch after success. Accepts a Git URL, provider slug (`owner/repo`), or remote name.                              |
| `--pr`            | Create a Pull Request after pushing. Requires `--push` and the provider token env var.                                               |
| `--git-provider`  | Git hosting provider: `github` (default), `gitlab`, `bitbucket`, `azure`, `gitea`. See [swf-git-provider.md](./swf-git-provider.md). |

---

## 9. Push Target Resolution and GITHUB_TOKEN

**Location:** `src/git/` — see [swf-git-provider.md](./swf-git-provider.md) for the provider abstraction. Push resolution and PR creation are implemented by pluggable providers (e.g. `GitHubProvider`).

### Push target formats

| Format       | Example                             | How it is resolved                               |
| ------------ | ----------------------------------- | ------------------------------------------------ |
| Full Git URL | `https://github.com/owner/repo.git` | Used as-is (with token injection for github.com) |
| GitHub slug  | `owner/repo`                        | Expanded to `https://github.com/owner/repo.git`  |
| Remote name  | `origin`                            | Resolved via `git remote get-url origin`         |

### Provider tokens

Each git provider reads its token from an environment variable. For GitHub:

```
https://x-access-token:${GITHUB_TOKEN}@github.com/owner/repo.git
```

- Required for: `--push` via HTTPS to the provider's host, and for `--pr`.
- Not required for: SSH URLs, or remotes that use other auth (deploy keys, credential helpers).

See [swf-git-provider.md](./swf-git-provider.md) for provider-specific env vars.

### Repo slug extraction

When creating a PR, we derive the repository identifier from:

- The push target (if it is already a slug).
- The push URL (resolved from a remote name or full URL).

Each provider defines its own slug format (e.g. `owner/repo` for GitHub).

---

## 10. Security Considerations

### .git/hooks rejection

Patches that modify `.git/hooks/` are **rejected** before application. A malicious agent could otherwise inject a hook that runs arbitrary code on the host (e.g. on `git commit`). The check is a regex over the patch content:

```
/^diff --git.*\.git\/hooks\//m
```

### Parallel-run safety

- **Worktree:** The main working tree is never checked out to a different branch. Multiple agents can run simultaneously; each creates its own worktree and branch.
- **Branch naming:** `saifac/<featureName>-<runId>` ensures that two runs for the same change (e.g. retries or different attempt numbers) do not collide.
- **Sandbox isolation:** Each run has its own sandbox directory. Canonical steps live in `sandboxBasePath/run-patch-steps.json` (and a combined `patch.diff` may be written for summarization), not in a shared location.

### Patch exclude rules

By stripping `saifac/**` and `.git/hooks/**` from every patch, we prevent:

- **Reward hacking:** The agent cannot modify tests to force a pass.
- **Hook injection:** The agent cannot install git hooks on the host.

---

## Summary: Git Command Reference

| Phase             | Command                                           | Context      |
| ----------------- | ------------------------------------------------- | ------------ |
| Sandbox creation  | `git init`                                        | `codePath`   |
| Sandbox creation  | `git add .`                                       | `codePath`   |
| Sandbox creation  | `git commit -m "Base state"`                      | `codePath`   |
| Patch extraction  | `git add` / commit (one round)                     | `codePath`   |
| Patch extraction  | `git diff "${preRoundHeadSha}" HEAD`              | `codePath`   |
| Failure reset     | `git reset --hard "${preRoundHeadSha}"`           | `codePath`   |
| Failure reset     | `git clean -fd`                                   | `codePath`   |
| Success: worktree | `git branch --show-current`                       | `projectDir` |
| Success: worktree | `git worktree add "${wtPath}" -b "${branchName}"` | `projectDir` |
| Success: commit   | per-step `git apply` + `git commit` (from JSON) | `wtPath`     |
| Success: push     | `git push "${pushUrl}" "${branchName}"`           | `wtPath`     |
| Success: cleanup  | `git worktree remove --force "${wtPath}"`         | `projectDir` |
| Success: fallback | `git worktree prune`                              | `projectDir` |
| Push resolution   | `git remote get-url ${remote}`                    | `projectDir` |
