/**
 * Sandbox management for the Software Factory Orchestrator.
 *
 * Creates an isolated copy of the repository in a sandbox base directory
 * (default: /tmp/saifctl/sandboxes/) so the agent can work without touching
 * the host's .git history or files.
 *
 * Directory structure produced:
 *   {sandboxBaseDir}/{proj}-{feat}-{runId}/
 *     policy.cedar           ← Cedar policy for Leash; same dir as gate.sh (host path passed as --policy)
 *     gate.sh                ← user-supplied or default gate script; mounted :ro at /saifctl/gate.sh
 *     code/                  ← copy of repo (git archive HEAD or rsync); workspace for the AI agent
 *                              for staging container (Container A) during tests
 *       .git/                ← fresh git repo for diffing
 *       saifctl/features/{feat}/tests/
 *         tests.json         ← test catalog (public cases only; hidden/ dir stripped)
 *         public/            ← public spec files (from rsync, unchanged)
 *         helpers.ts         ← shared transport helpers
 *         infra.spec.ts      ← infra health checks
 *         (hidden/ removed)  ← ALL hidden/ dirs under saifctl/features/ deleted so agent
 *                             cannot see holdout tests from any feature (current or others)
 *       ...rest of repo...
 */

import { chmod, copyFile, mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { minimatch } from 'minimatch';

import {
  getSaifctlRoot,
  SANDBOX_CEDAR_POLICY_BASENAME,
  subtaskDonePath,
  subtaskExitPath,
  subtaskNextPath,
  subtaskRetriesPath,
} from '../constants.js';
import type { TestCatalog } from '../design-tests/schema.js';
import { consola, ensureStdoutNewline } from '../logger.js';
import type { RunCommit } from '../runs/types.js';
import type { Feature } from '../specs/discover.js';
import { git, gitAdd, gitCommit, gitDiff, gitInit } from '../utils/git.js';
import { pathExists, readUtf8, spawnAsync, spawnWait, writeUtf8 } from '../utils/io.js';
import { isErrnoCode, retryWithBackoff } from '../utils/retry.js';
import { replayRunCommits, SAIFCTL_DEFAULT_AUTHOR } from './patch.js';
import { type SubtaskEnvMap, writeSubtaskEnvFile } from './per-subtask-env.js';

/** `fs.rm` can throw these while the agent or pnpm still touches a bind-mounted sandbox tree. */
const RETRIABLE_RM_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EAGAIN', 'EMFILE', 'ENFILE']);

/** Recursively removes all directories named "hidden" under baseDir. Exported for testing. */
export async function removeAllHiddenDirs(baseDir: string): Promise<number> {
  let removed = 0;
  if (!(await pathExists(baseDir))) return removed;

  const entries = await readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(baseDir, entry.name);
    if (entry.name === 'hidden') {
      await rm(fullPath, { recursive: true, force: true });
      removed++;
    } else {
      removed += await removeAllHiddenDirs(fullPath);
    }
  }
  return removed;
}

/**
 * Materialized sandbox handle returned by {@link createSandbox}: paths to
 * `code/`, `saifctl/`, and the host base patch, plus the run id used as the
 * sandbox directory suffix.
 */
export interface Sandbox {
  /** Run ID suffix used in the sandbox directory name */
  runId: string;
  /** The revision to use for optimistic locking on final run saves. */
  runningArtifactRevision?: number;
  /** e.g. /tmp/saifctl/sandboxes/{proj}-{feat}-{runId} */
  sandboxBasePath: string;
  /** sandboxBasePath/code — copy of the repo (committed tree or working tree) */
  codePath: string;
  /**
   * sandboxBasePath/saifctl — orchestration scripts; mounted :ro at /saifctl in staging and coder containers.
   */
  saifctlPath: string;
  /**
   * sandboxBasePath/host-base.patch — unified diff of the host repo's uncommitted changes
   * (staged + unstaged) captured at sandbox creation time via `git diff HEAD`.
   *
   * Applied to the git worktree in applyPatchToHost *before* the agent's patch so that the
   * worktree's base state matches the sandbox's base state, regardless of any branch switches
   * or working-tree changes the user may have made while the agent was running.
   *
   * Empty string when the host had no uncommitted changes at creation time (no-op).
   */
  hostBasePatchPath: string;
}

/** Rebuild {@link Sandbox} from the artifact field `pausedSandboxBasePath` after `run pause`. */
export function sandboxFromPausedBasePath(opts: {
  runId: string;
  sandboxBasePath: string;
}): Sandbox {
  const { runId, sandboxBasePath } = opts;
  return {
    runId,
    sandboxBasePath,
    codePath: join(sandboxBasePath, 'code'),
    saifctlPath: join(sandboxBasePath, 'saifctl'),
    hostBasePatchPath: join(sandboxBasePath, 'host-base.patch'),
  };
}

/**
 * Host root for factory temp files (e.g. Argus under `{SAIFCTL_TEMP_ROOT}/bin/`).
 * Not the sandbox directory — use {@link DEFAULT_SANDBOX_BASE_DIR} for disposable run copies.
 */
export const SAIFCTL_TEMP_ROOT = join('/tmp', 'saifctl');

/** Disposable rsync sandboxes; `cache list` / `cache clear` use this path by default. */
export const DEFAULT_SANDBOX_BASE_DIR = join(SAIFCTL_TEMP_ROOT, 'sandboxes');

const SAIFCTL_SCRIPTS_DIR = join(getSaifctlRoot(), 'src', 'orchestrator', 'scripts');

/** Options for {@link createSandbox}. */
export interface CreateSandboxOpts {
  /** Resolved feature (name, absolutePath, relativePath). */
  feature: Feature;
  /** Absolute path to the project directory */
  projectDir: string;
  /**
   * Project name prefix for the sandbox directory (e.g. 'crawlee-one').
   *
   * The directory is named `{proj}-{feat}-{runId}`.
   */
  projectName: string;
  /** Caller-supplied runId; defaults to a random short id */
  runId?: string;
  /**
   * Path to the saifctl directory, relative to project directory.
   */
  saifctlDir: string;
  /**
   * Base directory where sandbox entries are created.
   * Defaults to `/tmp/saifctl/sandboxes` (see {@link DEFAULT_SANDBOX_BASE_DIR}).
   */
  sandboxBaseDir: string;
  /**
   * Content of the gate script to write into the sandbox as `saifctl/gate.sh`.
   * The script is mounted read-only at `/saifctl/gate.sh` inside the coder container
   * and called by `coder-start.sh` after each OpenHands run. It must exit 0 to pass,
   * non-zero to fail (stdout+stderr are fed back to the agent as task feedback).
   *
   * Defaults to the gate.sh from the resolved sandbox profile when not provided.
   */
  gateScript: string;
  /**
   * Content of the startup script to write into the sandbox as `saifctl/startup.sh`.
   * The script is mounted read-only at `/saifctl/startup.sh` inside the coder container
   * and executed once by `coder-start.sh` before the agent loop begins.
   *
   * Use for workspace setup that must run after the workspace is mounted:
   * `pnpm install`, `pip install -r requirements.txt`, `cargo fetch`, etc.
   *
   * Set via --profile or --startup-script. When neither is provided, the profile's
   * installation script is used (e.g. pnpm install for node-pnpm-python).
   */
  startupScript: string;
  /**
   * Content of the agent setup script to write into the sandbox as `saifctl/agent-install.sh`.
   * The script is mounted read-only at `/saifctl/agent-install.sh` inside the coder container
   * and executed once by `coder-start.sh` after the startup script and before the agent loop.
   *
   * Use to install the coding agent at runtime (e.g. `pipx install aider-chat`).
   * When the script is empty or not provided, the step is skipped.
   *
   * Defaults to the agent profile's agent-install.sh.
   */
  agentInstallScript: string;
  /**
   * Content of the agent script to write into the sandbox as `saifctl/agent.sh`.
   * The script is mounted read-only at `/saifctl/agent.sh` inside the coder container
   * and invoked by `coder-start.sh` once per inner round.
   *
   * The script must read the task from `$SAIFCTL_TASK_PATH` and run the desired
   * coding agent (OpenHands, Aider, Claude Code, Codex, etc.).
   *
   * Resolved from the agent profile's agent.sh (openhands by default).
   */
  agentScript: string;
  /**
   * Content of the staging script to write into the sandbox as `saifctl/stage.sh`.
   * Mounted read-only in the staging container (Container A) at /saifctl/stage.sh and
   * invoked by staging-start.sh after startup.sh and the sidecar have run.
   *
   * The script is responsible for app startup (e.g. `npm run start`) or keeping
   * the container alive (`wait`) for CLI-only projects.
   *
   * Defaults to the profile's stage.sh when not provided.
   */
  stageScript: string;
  /**
   * Cedar policy text persisted with the run and written to `saifctl/{@link SANDBOX_CEDAR_POLICY_BASENAME}`.
   */
  cedarScript: string;
  /**
   * When true, `git commit` omits `-q` so per-file summaries are printed.
   * When false/omitted, commits use `-q` for quieter output.
   */
  verbose?: boolean;
  /**
   * When set, rsync the code tree from this directory instead of {@link projectDir}.
   * Used for from-artifact runs: base snapshot (before `runCommits`) so the sandbox can replay commits.
   */
  codeSourceDir?: string;
  /**
   * Run commits to replay after the initial "Base state" commit (from-artifact / test-from-run).
   */
  runCommits?: RunCommit[];
  /**
   * When false (default), copy only `git archive HEAD` from {@link projectDir} into `code/`.
   * When true, rsync the working tree (respecting `.gitignore`).
   * Ignored when {@link codeSourceDir} is set (from-artifact): always rsync from that directory.
   */
  includeDirty: boolean;
  /**
   * When true, if `{project}-{feature}-{runId}` already exists under {@link sandboxBaseDir}, reuse it:
   * refresh `host-base.patch`, public `tests.json`, and mounted scripts — no rsync and no `git init`
   * in `code/`. Used when `run resume` rebuilds from artifact but the paused sandbox tree is still
   * on disk (e.g. Docker infra gone, directory left behind).
   */
  reuseExistingSandbox?: boolean;
}

/**
 * Materialize the tree at `HEAD` into `destDir` (no `.git`). Requires a repo with at least one commit.
 */
async function copyCommittedGitTreeToDir(repoDir: string, destDir: string): Promise<void> {
  await spawnAsync({
    command: 'sh',
    // NOTE: git archive already excludes .git by default; no extra settings needed.
    //       Also, by principle, git should contain only files NOT in .gitignore.
    args: [
      '-c',
      'git -C "$SAIFCTL_GIT_ARCHIVE_REPO" archive HEAD | tar -x -C "$SAIFCTL_GIT_ARCHIVE_DEST"',
    ],
    cwd: repoDir,
    env: {
      ...process.env,
      SAIFCTL_GIT_ARCHIVE_REPO: repoDir,
      SAIFCTL_GIT_ARCHIVE_DEST: destDir,
    },
    stdio: 'inherit',
  });
}

/**
 * Builds one combined patch for **untracked** files so host-base.patch (and from-artifact runs) can
 * recreate the working tree faithfully.
 *
 * Git does not include untracked paths in `git diff HEAD`, so we list them with
 * `ls-files --others --exclude-standard`, skip directories, and turn each file (or symlink)
 * into a normal "new file" unified diff via `git diff --no-index /dev/null <path>` (with
 * `--binary` where needed). Concatenated result is meant for `git apply` alongside tracked diffs.
 */
export async function diffUntrackedFilesVersusDevNull(projectDir: string): Promise<string> {
  const lsRaw = await git({
    cwd: projectDir,
    args: ['ls-files', '-z', '--others', '--exclude-standard'],
  });
  const listOut = lsRaw
    .split('\0')
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const rel of listOut) {
    const abs = join(projectDir, rel);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    if (!st.isFile() && !st.isSymbolicLink()) continue;

    const r = await spawnWait({
      command: 'git',
      cwd: projectDir,
      args: ['diff', '--no-index', '--binary', '--', '/dev/null', rel],
    });
    if (r.code !== 0 && r.code !== 1) {
      consola.warn(
        `[sandbox] git diff --no-index for untracked ${rel} exited ${r.code}: ${r.stderr.trim()}`,
      );
      continue;
    }
    if (r.code === 1 && r.stdout.trim()) {
      chunks.push(r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`);
    }
  }

  return chunks.join('');
}

export interface RefreshSandboxScriptsOpts {
  projectDir: string;
  copyWorkingTree: boolean;
  hostBasePatchPath: string;
  codePath: string;
  saifctlPath: string;
  feature: Feature;
  gateScript: string;
  startupScript: string;
  agentInstallScript: string;
  agentScript: string;
  stageScript: string;
  cedarScript: string;
  gatePath: string;
  startupPath: string;
  agentInstallPath: string;
  agentPath: string;
  stagePath: string;
  cedarPolicyPath: string;
}

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5e — convenience wrapper that derives the script
// paths from a {@link Sandbox} so callers (loop.ts) don't have to hand-build
// the `gatePath` / `startupPath` / etc. set every time. Mirrors the path
// derivation in `createSandbox`'s reuse branch so the two stay aligned by
// construction.
// ---------------------------------------------------------------------------

/** Inputs to {@link refreshSandboxScriptsForSandbox}: the live sandbox + per-subtask script content + run-level state. */
export interface RefreshSandboxScriptsForSandboxOpts {
  sandbox: Sandbox;
  projectDir: string;
  copyWorkingTree: boolean;
  feature: Feature;
  gateScript: string;
  startupScript: string;
  agentInstallScript: string;
  agentScript: string;
  stageScript: string;
  cedarScript: string;
}

/**
 * Refresh the bind-mounted scripts in an existing sandbox dir using a
 * {@link Sandbox} handle (path derivation handled internally). Thin
 * wrapper around {@link refreshSandboxScripts} for callers that already
 * hold a `Sandbox`.
 */
export async function refreshSandboxScriptsForSandbox(
  opts: RefreshSandboxScriptsForSandboxOpts,
): Promise<void> {
  const { sandbox } = opts;
  const saifctlPath = sandbox.saifctlPath;
  await refreshSandboxScripts({
    projectDir: opts.projectDir,
    copyWorkingTree: opts.copyWorkingTree,
    hostBasePatchPath: sandbox.hostBasePatchPath,
    codePath: sandbox.codePath,
    saifctlPath,
    feature: opts.feature,
    gateScript: opts.gateScript,
    startupScript: opts.startupScript,
    agentInstallScript: opts.agentInstallScript,
    agentScript: opts.agentScript,
    stageScript: opts.stageScript,
    cedarScript: opts.cedarScript,
    gatePath: join(saifctlPath, 'gate.sh'),
    startupPath: join(saifctlPath, 'startup.sh'),
    agentInstallPath: join(saifctlPath, 'agent-install.sh'),
    agentPath: join(saifctlPath, 'agent.sh'),
    stagePath: join(saifctlPath, 'stage.sh'),
    cedarPolicyPath: join(saifctlPath, SANDBOX_CEDAR_POLICY_BASENAME),
  });
}

/**
 * Refresh the mutable parts of an existing sandbox without touching the code tree or git history.
 *
 * Called on the `run resume` path when the sandbox directory is still on disk but the coder/leash
 * containers have been removed (they will be recreated by the engine). Updates:
 * - `host-base.patch`   — recaptures the host's current working-tree diff so `applyPatchToHost`
 *                         stays accurate if the user edited files between pause and resume.
 * - `tests.json`        — re-filters the catalog so the agent only sees public tests.
 * - shell scripts       — gate.sh, startup.sh, agent-install.sh, agent.sh, stage.sh, cedar policy,
 *                         and the factory-provided coder-start.sh / staging-start.sh / reviewer.sh.
 *
 * This function is intentionally separate from `createSandbox` so the reuse branch remains easy to
 * reason about and test in isolation. Per-phase-config phase 7.5d exposes it (via the
 * {@link refreshSandboxScriptsForSandbox} wrapper) so `loop.ts` can call it from
 * `phase-transition.ts:completeControlledRestart` (the post-teardown half of a controlled
 * Level-2/3 restart, plus the resume-recovery branch when an artifact loaded from disk
 * carries `transitionInProgress`). Applies Level-2 script content from the new active
 * subtask before the next outer attempt boots a fresh coder container.
 */
export async function refreshSandboxScripts(opts: RefreshSandboxScriptsOpts): Promise<void> {
  const {
    projectDir,
    copyWorkingTree,
    hostBasePatchPath,
    codePath,
    saifctlPath,
    feature,
    gateScript,
    startupScript,
    agentInstallScript,
    agentScript,
    stageScript,
    cedarScript,
    gatePath,
    startupPath,
    agentInstallPath,
    agentPath,
    stagePath,
    cedarPolicyPath,
  } = opts;

  if (!(await pathExists(projectDir))) {
    throw new Error(
      `[sandbox] Source directory does not exist (cannot refresh host-base.patch). Path: ${projectDir}`,
    );
  }

  // Re-capture host working-tree diff so applyPatchToHost stays accurate after pause/resume.
  if (!copyWorkingTree) {
    await writeUtf8(hostBasePatchPath, '');
    consola.log('[sandbox] host-base.patch empty (sandbox matches HEAD; no uncommitted snapshot)');
  } else {
    const trackedPatch = await gitDiff({ cwd: projectDir, args: ['--binary', 'HEAD'] });
    const untrackedPatch = await diffUntrackedFilesVersusDevNull(projectDir);
    const parts: string[] = [];
    if (trackedPatch.trim()) {
      parts.push(trackedPatch.endsWith('\n') ? trackedPatch : `${trackedPatch}\n`);
    }
    if (untrackedPatch.trim()) {
      parts.push(untrackedPatch.endsWith('\n') ? untrackedPatch : `${untrackedPatch}\n`);
    }
    const hostBasePatch = parts.join('');
    await writeUtf8(hostBasePatchPath, hostBasePatch);
    if (hostBasePatch.trim()) {
      const lineCount = hostBasePatch.split('\n').length;
      consola.log(
        `[sandbox] Captured ${lineCount} lines of host uncommitted + untracked changes to host-base.patch`,
      );
    } else {
      consola.log('[sandbox] Host working tree is clean — host-base.patch is empty');
    }
  }

  // Re-filter tests.json so the agent only sees public test cases after resume.
  // Skipped for pure sandbox runs that have no feature test catalog.
  const testsJsonPath = join(feature.absolutePath, 'tests', 'tests.json');
  if (await pathExists(testsJsonPath)) {
    const catalog = JSON.parse(await readUtf8(testsJsonPath)) as TestCatalog;
    const inCodeTestsDir = join(codePath, feature.relativePath, 'tests');
    const publicCatalog: TestCatalog = {
      ...catalog,
      testCases: catalog.testCases.filter((tc) => tc.visibility === 'public'),
    };
    await mkdir(inCodeTestsDir, { recursive: true });
    await writeUtf8(join(inCodeTestsDir, 'tests.json'), JSON.stringify(publicCatalog, null, 2));
    const hiddenCount = catalog.testCases.filter((tc) => tc.visibility === 'hidden').length;
    const publicCount = publicCatalog.testCases.length;
    consola.log(
      `[sandbox] ${publicCount} public test cases visible to agent, ${hiddenCount} hidden`,
    );
  }

  // Overwrite all mounted scripts so that changes between pause and resume are picked up.
  await writeUtf8(gatePath, gateScript);
  await chmod(gatePath, 0o755);
  await writeUtf8(startupPath, startupScript);
  await chmod(startupPath, 0o755);
  await writeUtf8(agentInstallPath, agentInstallScript);
  await chmod(agentInstallPath, 0o755);
  await writeUtf8(agentPath, agentScript);
  await chmod(agentPath, 0o755);
  await writeUtf8(stagePath, stageScript);
  await chmod(stagePath, 0o755);
  await writeUtf8(cedarPolicyPath, cedarScript);
  // per-phase-config phase 7.4: write an empty per-subtask env file at
  // sandbox creation so the bind-mount has the file present from boot
  // (avoids any "file appeared after boot" race in coder-start.sh's
  // `[ -f ... ]` check). The first subtask transition rewrites it with
  // any per-phase overrides.
  await writeSubtaskEnvFile({ saifctlPath, env: {} });
  for (const name of [
    'coder-start.sh',
    'sandbox-start.sh',
    'staging-start.sh',
    'reviewer.sh',
    // Shared drop-privileges helpers; sourced by per-profile agent.sh /
    // agent-install.sh. See release-readiness/X-08-P7/P8.
    'saifctl-agent-helpers.sh',
  ] as const) {
    const dest = join(saifctlPath, name);
    await copyFile(join(SAIFCTL_SCRIPTS_DIR, name), dest);
    await chmod(dest, 0o755);
  }
  consola.log(`[sandbox] Factory scripts refreshed in ${saifctlPath}`);
}

/**
 * Creates an isolated sandbox for the feature.
 *
 * 1. Populate sandboxBasePath/code/ — `git archive HEAD` (default) or rsync when {@link CreateSandboxOpts#includeDirty}
 *    or when {@link CreateSandboxOpts#codeSourceDir} is set (from-artifact snapshot)
 * 2. Remove ALL hidden/ dirs under saifctl/features/ so the coder agent cannot see holdout
 *    tests from any feature (current or others)
 * 3. git init + "Base state" commit, then replay {@link CreateSandboxOpts#runCommits}
 * 4. Create sandboxBasePath/saifctl/ and write gate.sh, startup.sh, agent-install.sh, agent.sh, stage.sh
 * 5. Copy factory scripts into saifctl/: coder-start.sh, staging-start.sh, reviewer.sh
 *
 * If `{projectName}-{feature}-{runId}` already exists under {@link CreateSandboxOpts#sandboxBaseDir}:
 * - {@link CreateSandboxOpts#reuseExistingSandbox} true → refresh scripts/patch only (resume path).
 * - Otherwise → remove the directory (full teardown via {@link destroySandbox}) and create a fresh sandbox.
 */
export async function createSandbox(opts: CreateSandboxOpts): Promise<Sandbox> {
  const {
    feature,
    projectDir,
    saifctlDir,
    projectName,
    sandboxBaseDir,
    gateScript,
    startupScript,
    agentInstallScript,
    agentScript,
    stageScript,
    cedarScript,
    verbose,
    runCommits = [],
    includeDirty,
    reuseExistingSandbox,
  } = opts;
  const codeRsyncSource = opts.codeSourceDir ?? projectDir;
  const copyWorkingTree = !!opts.codeSourceDir || includeDirty;
  const runId = opts.runId ?? Math.random().toString(36).substring(2, 9);

  const dirName = `${projectName}-${feature.name}-${runId}`;
  const sandboxBasePath = `${sandboxBaseDir}/${dirName}`;
  const codePath = join(sandboxBasePath, 'code');
  const saifctlPath = join(sandboxBasePath, 'saifctl');
  const gatePath = join(saifctlPath, 'gate.sh');
  const startupPath = join(saifctlPath, 'startup.sh');
  const agentInstallPath = join(saifctlPath, 'agent-install.sh');
  const agentPath = join(saifctlPath, 'agent.sh');
  const stagePath = join(saifctlPath, 'stage.sh');
  const cedarPolicyPath = join(saifctlPath, SANDBOX_CEDAR_POLICY_BASENAME);
  const hostBasePatchPath = join(sandboxBasePath, 'host-base.patch');

  const dirAlreadyThere = await pathExists(sandboxBasePath);
  const reuse = !!reuseExistingSandbox && dirAlreadyThere;

  if (dirAlreadyThere && !reuse) {
    consola.warn(`[sandbox] Removing stale sandbox directory (new run): ${sandboxBasePath}`);
    await destroySandbox(sandboxBasePath);
  }

  // Case: Reusing existing sandbox (resume path from pause).
  if (reuse) {
    if (!(await pathExists(codePath)) || !(await pathExists(saifctlPath))) {
      throw new Error(
        `[sandbox] Cannot reuse sandbox at ${sandboxBasePath}: expected code/ and saifctl/ directories.`,
      );
    }
    consola.log(
      `[sandbox] Reusing existing sandbox at ${sandboxBasePath} (refresh scripts + host-base.patch only)`,
    );

    await refreshSandboxScripts({
      projectDir,
      copyWorkingTree,
      hostBasePatchPath,
      codePath,
      saifctlPath,
      feature,
      gateScript,
      startupScript,
      agentInstallScript,
      agentScript,
      stageScript,
      cedarScript,
      gatePath,
      startupPath,
      agentInstallPath,
      agentPath,
      stagePath,
      cedarPolicyPath,
    });

    return {
      sandboxBasePath,
      codePath,
      saifctlPath,
      hostBasePatchPath,
      runId,
    };
  }

  // Case: Creating a new sandbox (start path from run).
  consola.log(`[sandbox] Creating isolated sandbox at ${sandboxBasePath}`);
  // Explicit 0o755 — Node's default `mkdir` mode is 0o777 minus process umask.
  // GitHub Linux runners use umask 077 for the runner user (a deliberate
  // hardening), which produces mode 0o700. The staging + test-runner
  // containers run with the host owner UID (set in src/engines/docker/
  // index.ts), so they don't need world-traverse, but defensively keeping
  // these dirs at 0o755 avoids regressions if someone later wires up a
  // container whose UID doesn't match the host (e.g. an image-baked
  // saifctl-1000 vs runner-1001). Tracked: release-readiness/X-08-P9.
  await mkdir(codePath, { recursive: true, mode: 0o755 });
  await mkdir(saifctlPath, { recursive: true, mode: 0o755 });
  // Recursive mkdir doesn't re-chmod existing parent dirs. The run-specific
  // `sandboxBasePath` was just created by recursive mkdir above, so it's
  // already 0o755; the chmod here is belt-and-braces in case sandboxBasePath
  // pre-existed (reuse path) or a future caller passes a sandboxBaseDir that
  // already exists with restrictive perms.
  await chmod(sandboxBasePath, 0o755);

  // Capture any uncommitted host changes (staged + unstaged) before rsync so that
  // applyPatchToHost can reconstruct the exact host state the sandbox was based on,
  // regardless of branch switches or working-tree edits made while the agent runs.
  if (!(await pathExists(projectDir))) {
    throw new Error(
      `[sandbox] Source directory does not exist (cannot run git here). ` +
        `From-artifact worktree path may be stale — try \`saifctl run start\` again. Path: ${projectDir}`,
    );
  }

  // host-base.patch: only needed when the sandbox tree can differ from baseCommitSha (dirty or from-artifact).
  if (!copyWorkingTree) {
    // Case: Copying codebase from git archive HEAD (no uncommitted changes). No patch needed.
    await writeUtf8(hostBasePatchPath, '');
    consola.log('[sandbox] host-base.patch empty (sandbox matches HEAD; no uncommitted snapshot)');
  } else {
    // Capture tracked + untracked changes so applyPatchToHost can faithfully reconstruct the
    // host's working tree in the worktree before applying the agent's patch.
    // `git diff HEAD` only covers tracked files; untracked files (e.g. a new CHANGELOG.md that
    // exists on the host but is not committed) must be included separately, otherwise the agent's
    // modification diff will fail with "No such file or directory" in the worktree when it's applied.
    // Always use projectDir — from-artifact uses a snapshot dir without .git for the tree copy.
    const trackedPatch = await gitDiff({ cwd: projectDir, args: ['--binary', 'HEAD'] });
    const untrackedPatch = await diffUntrackedFilesVersusDevNull(projectDir);
    const parts: string[] = [];
    if (trackedPatch.trim()) {
      parts.push(trackedPatch.endsWith('\n') ? trackedPatch : `${trackedPatch}\n`);
    }
    if (untrackedPatch.trim()) {
      parts.push(untrackedPatch.endsWith('\n') ? untrackedPatch : `${untrackedPatch}\n`);
    }
    const hostBasePatch = parts.join('');
    await writeUtf8(hostBasePatchPath, hostBasePatch);
    if (hostBasePatch.trim()) {
      const lineCount = hostBasePatch.split('\n').length;
      consola.log(
        `[sandbox] Captured ${lineCount} lines of host uncommitted + untracked changes to host-base.patch`,
      );
    } else {
      consola.log('[sandbox] Host working tree is clean — host-base.patch is empty');
    }
  }

  // Copy user's workspace into code/.
  // Either use `git archive HEAD` (copying state as it was at the latest commit), or
  // if `--include-dirty`, rsync the working tree as it is now (incl all uncommited or untracked changes).
  // In both cases we respect .gitignore (to skip node_modules etc) and exclude .git.
  if (copyWorkingTree) {
    await spawnAsync({
      command: 'rsync',
      args: [
        '-a',
        '--filter=:- .gitignore',
        '--exclude=.git',
        `${codeRsyncSource}/`,
        `${codePath}/`,
      ],
      cwd: codeRsyncSource,
      stdio: 'inherit',
    });
  } else {
    consola.log(`[sandbox] Populating code/ from git archive HEAD at ${projectDir}`);
    await copyCommittedGitTreeToDir(projectDir, codePath);
  }

  // Strip holdout tests from the sandbox code tree — only applicable when a feature test catalog
  // exists (i.e. `feat run` / from-artifact paths). Pure `saifctl sandbox` runs have no feature
  // directory and no tests.json, so this block is skipped for them.
  const testsJsonPath = join(feature.absolutePath, 'tests', 'tests.json');
  if (await pathExists(testsJsonPath)) {
    const catalog = JSON.parse(await readUtf8(testsJsonPath)) as TestCatalog;

    // Remove ALL hidden/ dirs from saifctl/features so the agent
    // cannot see holdout tests from any feature (current or others).
    const saifctlBase = join(codePath, saifctlDir);
    const featuresHidden = await removeAllHiddenDirs(join(saifctlBase, 'features'));
    if (featuresHidden > 0) {
      consola.log(
        `[sandbox] Removed ${featuresHidden} hidden/ dir(s) from code copy (agent cannot see holdout tests)`,
      );
    }

    // Overwrite the current feature's tests.json to contain only public tests.
    const inCodeTestsDir = join(codePath, feature.relativePath, 'tests');
    const publicCatalog: TestCatalog = {
      ...catalog,
      testCases: catalog.testCases.filter((tc) => tc.visibility === 'public'),
    };
    await mkdir(inCodeTestsDir, { recursive: true });
    await writeUtf8(join(inCodeTestsDir, 'tests.json'), JSON.stringify(publicCatalog, null, 2));

    const hiddenCount = catalog.testCases.filter((tc) => tc.visibility === 'hidden').length;
    const publicCount = publicCatalog.testCases.length;
    consola.log(
      `[sandbox] ${publicCount} public test cases visible to agent, ${hiddenCount} hidden`,
    );
  } else {
    consola.log('[sandbox] No tests.json — skipping holdout-test filtering (pure sandbox run)');
  }

  // Initialize a fresh git repo inside code/ for patch extraction
  await gitInit({ cwd: codePath, stdio: 'inherit' });
  await gitAdd({ cwd: codePath, stdio: 'inherit' });
  await gitCommit({
    cwd: codePath,
    message: 'Base state',
    verbose,
    stdio: 'inherit',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'saifctl',
      GIT_AUTHOR_EMAIL: 'saifctl@safeaifactory.com',
      GIT_COMMITTER_NAME: 'saifctl',
      GIT_COMMITTER_EMAIL: 'saifctl@safeaifactory.com',
    },
  });
  consola.log(`[sandbox] git init + initial commit done in ${codePath}`);

  const replayGitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'saifctl',
    GIT_AUTHOR_EMAIL: 'saifctl@safeaifactory.com',
    GIT_COMMITTER_NAME: 'saifctl',
    GIT_COMMITTER_EMAIL: 'saifctl@safeaifactory.com',
  };

  // Apply all commits that have been made to the sandbox since the initial commit.
  if (runCommits.length > 0) {
    await replayRunCommits({
      cwd: codePath,
      commits: runCommits,
      gitEnv: replayGitEnv,
      verbose: !!verbose,
    });
    consola.log(`[sandbox] Replayed ${runCommits.length} run commit(s) in ${codePath}`);
  }

  // Write gate.sh: user-supplied content or the built-in pnpm check default.
  // Mounted read-only at /saifctl/gate.sh inside the coder container.
  await writeUtf8(gatePath, gateScript);
  await chmod(gatePath, 0o755);
  consola.log(`[sandbox] Gate script written to ${gatePath}`);

  // Write startup.sh — always present; mounted read-only at /saifctl/startup.sh.
  // Set via --profile or --startup-script.
  await writeUtf8(startupPath, startupScript);
  await chmod(startupPath, 0o755);
  consola.log(`[sandbox] Startup script written to ${startupPath}`);

  // Write agent-install.sh — mounted read-only at /saifctl/agent-install.sh.
  // Run once after project startup, before the agent loop. Used to install the agent.
  await writeUtf8(agentInstallPath, agentInstallScript);
  await chmod(agentInstallPath, 0o755);
  consola.log(`[sandbox] Agent install script written to ${agentInstallPath}`);

  // Write agent.sh — mounted read-only at /saifctl/agent.sh.
  // Defaults to the agent profile's agent.sh (OpenHands). Override with --agent-script.
  await writeUtf8(agentPath, agentScript);
  await chmod(agentPath, 0o755);
  consola.log(`[sandbox] Agent script written to ${agentPath}`);

  // Write stage.sh — mounted read-only in the staging container at /saifctl/stage.sh.
  // Set via --profile or --stage-script.
  await writeUtf8(stagePath, stageScript);
  await chmod(stagePath, 0o755);
  consola.log(`[sandbox] Stage script written to ${stagePath}`);

  // per-phase-config phase 7.4: empty per-subtask env file (see createSandbox above).
  await writeSubtaskEnvFile({ saifctlPath, env: {} });

  await writeUtf8(cedarPolicyPath, cedarScript);
  consola.log(`[sandbox] Cedar policy written to ${cedarPolicyPath}`);

  for (const name of [
    'coder-start.sh',
    'sandbox-start.sh',
    'staging-start.sh',
    'reviewer.sh',
    // Shared drop-privileges helpers; sourced by per-profile agent.sh /
    // agent-install.sh. See release-readiness/X-08-P7/P8.
    'saifctl-agent-helpers.sh',
  ] as const) {
    const dest = join(saifctlPath, name);
    await copyFile(join(SAIFCTL_SCRIPTS_DIR, name), dest);
    await chmod(dest, 0o755);
  }
  consola.log(`[sandbox] Factory scripts copied to ${saifctlPath}`);

  return {
    sandboxBasePath,
    codePath,
    saifctlPath,
    hostBasePatchPath,
    runId,
  };
}

/**
 * Removes the disposable sandbox directory.
 * Safe to call even if the directory does not exist.
 *
 * On Unix, retries up to 15 times on transient errors (e.g. ENOTEMPTY when the container or pnpm
 * is still writing into the bind-mounted path), then falls back to the system `rm -rf` shell
 * command if all retries are exhausted. Windows has no shell fallback, so it just retries.
 */
export async function destroySandbox(sandboxBasePath: string): Promise<void> {
  consola.log(`[sandbox] Removing sandbox ${sandboxBasePath}`);

  const rmIfExists = async (): Promise<void> => {
    try {
      await rm(sandboxBasePath, { recursive: true, force: true });
    } catch (err) {
      if (isErrnoCode(err, new Set(['ENOENT']))) return;
      throw err;
    }
  };

  if (process.platform === 'win32') {
    // No `rm -rf` fallback on Windows — just retry with backoff.
    await retryWithBackoff({
      fn: rmIfExists,
      isRetriable: (err) => isErrnoCode(err, RETRIABLE_RM_CODES),
      maxAttempts: 15,
      backoffMs: (i) => Math.min(800, 40 * 2 ** Math.min(i, 4)),
    });
    ensureStdoutNewline();
    return;
  }

  // Unix: retry with backoff, then fall back to the shell `rm -rf`.
  try {
    await retryWithBackoff({
      fn: rmIfExists,
      isRetriable: (err) => isErrnoCode(err, RETRIABLE_RM_CODES),
      maxAttempts: 15,
      backoffMs: (i) => Math.min(800, 40 * 2 ** Math.min(i, 4)),
    });
  } catch {
    try {
      await spawnAsync({
        command: 'rm',
        args: ['-rf', '--', sandboxBasePath],
        cwd: '/',
        stdio: 'pipe',
      });
    } catch (shellErr) {
      consola.warn('[sandbox] rm -rf fallback failed:', shellErr);
      // Re-attempt once more after shell failure so that the outer caller gets a real error.
      await rmIfExists();
    }
  }

  ensureStdoutNewline();
}

// ---------------------------------------------------------------------------
// Subtask signaling (host ↔ coder-start.sh via workspace .saifctl/)
// ---------------------------------------------------------------------------

/** Options for {@link updateSandboxSubtaskScripts}. */
export interface UpdateSandboxSubtaskScriptsOpts {
  /** Absolute path to the sandbox saifctl directory (sandboxBasePath/saifctl). */
  saifctlPath: string;
  /**
   * Gate script content to write as saifctl/gate.sh.
   * Always provided — callers pass the subtask override when present, otherwise
   * the run-level default.
   */
  gateScript: string;
  /**
   * Agent script content to write as saifctl/agent.sh.
   *
   * Always provided — the compile/runtime layer resolves the per-subtask
   * value (per-phase `agent.script` override when set, else run-level
   * fallback) before reaching this function. Always-write means a
   * transition from a phase that overrode `agent.script` to a phase that
   * didn't correctly restores the run-level script, instead of leaking
   * the previous phase's content. See per-phase-config phase 7.2.
   */
  agentScript: string;
  /**
   * Stage script content to write as saifctl/stage.sh.
   *
   * Always provided — the compile/runtime layer resolves the per-subtask
   * value (per-phase `runner.stage-script` override when set, else
   * run-level fallback) before reaching this function. Always-write means
   * a transition from a phase that overrode `runner.stage-script` to a
   * phase that didn't correctly restores the run-level script, instead of
   * leaking the previous phase's content. The staging container reads
   * `stage.sh` from the bind-mount fresh each `runStagingTestVerification`
   * call (per subtask, not per outer attempt), so the file MUST hold the
   * right content per subtask. See per-phase-config phase 7.3.
   */
  stageScript: string;
  /**
   * Per-subtask env file content to write as saifctl/subtask-env.sh
   * (per-phase-config phase 7.4 — Level 1.5 fast path).
   *
   * Optional. When omitted, the on-disk file (if any) is left in place
   * — back-compat for legacy callers and the inspect / sandbox-only
   * paths that don't have phased subtasks.
   *
   * Resolved per-subtask {@link import('./per-subtask-env.js').SubtaskEnvMap}.
   *
   * **Always provided** — the caller must compute the full resolved env
   * (run-level baseline + active overrides + `unset` directives for
   * shadow keys not in the active subtask) via `computeSubtaskEnv`
   * with a shadow-keys set built from the whole run. The host always
   * rewrites the file; the runtime guarantee depends on the file being
   * an authoritative snapshot of the active subtask's env, not just
   * the per-phase delta. Without this, phase-only-added env keys
   * silently leak across phase boundaries (per-phase-config 7.4
   * review F-A).
   *
   * Mode is `0o600` (may contain secret values from `agent.secrets`);
   * callers don't need to chmod separately.
   */
  subtaskEnv: SubtaskEnvMap;
}

/**
 * Overwrites per-subtask scripts in the sandbox saifctl directory between subtasks.
 *
 * `gate.sh`, `agent.sh`, and `stage.sh` are always updated; callers must pass
 * the resolved per-subtask value (override-or-run-level) for each. Always-write
 * makes phase boundaries idempotent — a phase that doesn't override a script
 * gets the run-level fallback baked into the subtask, so transitions never
 * leave the wrong content on disk.
 *
 * `stage.sh` matters for the same reason as `gate.sh` / `agent.sh`: the
 * staging container reads it fresh from the bind-mount each
 * `runStagingTestVerification` call (per subtask, not per outer attempt).
 * A previous phase's override would otherwise persist into a non-overriding
 * phase's staging tests — that bug was caught in the per-phase-config 7.3
 * review.
 *
 * The /saifctl/ bind-mount is a directory mount (:ro from the container's
 * perspective), so the running container sees the new file contents on the
 * next read without any restart or remount.
 */
export async function updateSandboxSubtaskScripts(
  opts: UpdateSandboxSubtaskScriptsOpts,
): Promise<void> {
  const { saifctlPath, gateScript, agentScript, stageScript, subtaskEnv } = opts;

  const gatePath = join(saifctlPath, 'gate.sh');
  await writeUtf8(gatePath, gateScript);
  await chmod(gatePath, 0o755);
  consola.log(`[sandbox] gate.sh updated for next subtask (${gateScript.length} bytes)`);

  const agentPath = join(saifctlPath, 'agent.sh');
  await writeUtf8(agentPath, agentScript);
  await chmod(agentPath, 0o755);
  consola.log(`[sandbox] agent.sh updated for next subtask (${agentScript.length} bytes)`);

  const stagePath = join(saifctlPath, 'stage.sh');
  await writeUtf8(stagePath, stageScript);
  await chmod(stagePath, 0o755);
  consola.log(`[sandbox] stage.sh updated for next subtask (${stageScript.length} bytes)`);

  // per-phase-config phase 7.4 — Level 1.5 fast path. Per-subtask env
  // file is sourced by `coder-start.sh` on every inner round. Always
  // written (the type makes it required) so phase boundaries are
  // idempotent regardless of source order — see per-phase-config 7.4
  // review F-A. The writer takes care of mode `0o600` + atomic swap.
  await writeSubtaskEnvFile({ saifctlPath, env: subtaskEnv });
}

/**
 * Ensures the workspace `.saifctl/` directory exists and cleans up any stale
 * subtask signal files left from a previous run (e.g. after pause/resume).
 *
 * Must be called once before starting the coder container for a run, so the
 * shell finds a clean signaling state.
 */
export async function prepareSubtaskSignalDir(sandboxBasePath: string): Promise<void> {
  const workspaceRoot = join(sandboxBasePath, 'code');
  const dir = join(workspaceRoot, '.saifctl');
  await mkdir(dir, { recursive: true });

  for (const stalePath of [
    subtaskDonePath(workspaceRoot),
    subtaskExitPath(workspaceRoot),
    subtaskNextPath(workspaceRoot),
    subtaskRetriesPath(workspaceRoot),
  ]) {
    try {
      await unlink(stalePath);
    } catch {
      // Not present — fine.
    }
  }
  consola.log('[sandbox] Subtask signal directory prepared.');
}

/**
 * Delivers the next subtask prompt to the running container.
 *
 * Writes the content to the file the shell polls between subtasks
 * (`SAIFCTL_NEXT_SUBTASK_PATH`). The shell detects this file, consumes it
 * (renames it to `*.consumed.N`), and starts the next subtask's inner loop.
 */
export async function writeSubtaskNextPrompt(
  sandboxBasePath: string,
  content: string,
): Promise<void> {
  const workspaceRoot = join(sandboxBasePath, 'code');
  const p = subtaskNextPath(workspaceRoot);
  await mkdir(join(workspaceRoot, '.saifctl'), { recursive: true });
  await writeUtf8(p, content);
  consola.log(`[sandbox] Next subtask prompt written (${content.length} chars).`);
}

/**
 * Writes a per-subtask gate-retries override for the next subtask.
 *
 * The shell reads and immediately deletes this file when starting the next
 * subtask's inner loop. If not called, the container uses SAIFCTL_GATE_RETRIES
 * (the run-level default from the container env).
 */
export async function writeSubtaskRetriesOverride(
  sandboxBasePath: string,
  gateRetries: number,
): Promise<void> {
  const workspaceRoot = join(sandboxBasePath, 'code');
  const p = subtaskRetriesPath(workspaceRoot);
  await mkdir(join(workspaceRoot, '.saifctl'), { recursive: true });
  await writeUtf8(p, String(gateRetries));
  consola.log(`[sandbox] Subtask gate-retries override written: ${gateRetries}`);
}

/**
 * Signals the container to exit cleanly after the current subtask completes.
 *
 * Creates the file at SAIFCTL_SUBTASK_EXIT_PATH. The shell detects this during
 * its between-subtasks poll and calls `exit 0`. Must only be called after the
 * host has already read the current subtask's done signal.
 */
export async function writeSubtaskExitSignal(sandboxBasePath: string): Promise<void> {
  const workspaceRoot = join(sandboxBasePath, 'code');
  const p = subtaskExitPath(workspaceRoot);
  await mkdir(join(workspaceRoot, '.saifctl'), { recursive: true });
  await writeUtf8(p, '');
  consola.log('[sandbox] Subtask exit signal written.');
}

/** Result of {@link pollSubtaskDone}: the exit code the inner shell wrote for the just-finished subtask. */
export interface PollSubtaskDoneResult {
  /** The exit code written by coder-start.sh: 0 = success, 1 = failure. */
  exitCode: number;
}

/**
 * Polls the subtask-done signal file until the running container writes it.
 *
 * `coder-start.sh` writes the exit code of the last subtask's inner loop as a
 * single integer to SAIFCTL_SUBTASK_DONE_PATH immediately after the inner loop
 * exits. This function detects the file, reads the exit code, removes the file
 * (so it does not interfere with the next subtask's done signal), and resolves.
 *
 * Rejects if `signal` is aborted before the file appears (run pause / stop).
 *
 * @param sandboxBasePath - The sandbox base path (`code/` is appended for workspace paths).
 * @param signal - AbortSignal wired to pause/stop.
 * @param pollIntervalMs - How often to check for the file (default: 500 ms).
 */
export function pollSubtaskDone( // eslint-disable-line max-params -- (sandboxBasePath, signal, pollIntervalMs) subtask driver API
  sandboxBasePath: string,
  signal: AbortSignal,
  pollIntervalMs = 500,
): Promise<PollSubtaskDoneResult> {
  const workspaceRoot = join(sandboxBasePath, 'code');
  const donePath = subtaskDonePath(workspaceRoot);

  return new Promise<PollSubtaskDoneResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('pollSubtaskDone: signal already aborted'));
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | undefined;
    let busy = false;

    const cleanup = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('pollSubtaskDone: aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const tick = async () => {
      if (busy || signal.aborted) return;
      busy = true;
      try {
        if (!(await pathExists(donePath))) return;
        const raw = (await readUtf8(donePath)).trim();
        const exitCode = Number.parseInt(raw, 10);
        try {
          await unlink(donePath);
        } catch {
          // Ignore — may have already been removed in a race.
        }
        cleanup();
        resolve({ exitCode: Number.isFinite(exitCode) ? exitCode : 1 });
      } catch (err) {
        consola.warn('[sandbox] pollSubtaskDone: read error (will retry):', err);
      } finally {
        busy = false;
      }
    };

    intervalId = setInterval(() => {
      void tick();
    }, pollIntervalMs);
    void tick();
  });
}

/** A pattern used to exclude files from the extracted patch. */
export type PatchExcludeRule =
  | { type: 'glob'; pattern: string }
  | { type: 'regex'; pattern: RegExp };

/** Common options for patch extraction: caller-supplied exclude rules layered on top of the built-in set. */
export interface ExtractPatchOpts {
  /**
   * File sections whose path matches any rule are stripped from the patch.
   * Paths are relative to the repo root (e.g. "saifctl/features/foo/tests/tests.json").
   * Glob patterns are matched with minimatch; regex patterns are tested directly.
   */
  exclude?: PatchExcludeRule[];
}

/** Options for {@link extractIncrementalRoundPatch}: pre-round HEAD plus optional commit message/author overrides. */
export interface ExtractIncrementalRoundPatchOpts extends ExtractPatchOpts {
  /** `git rev-parse` at the start of this agent round (before the agent ran). */
  preRoundHeadSha: string;
  /** Outer loop attempt index (1-based), for default commit message. */
  attempt: number;
  /** Override default `saifctl: coding attempt <attempt>`. */
  message?: string;
  /** Override default {@link SAIFCTL_DEFAULT_AUTHOR}. */
  author?: string;
  /**
   * Snapshot of {@link listIgnoredOtherFiles} taken before the agent ran (or
   * at the start of the coding session). When supplied, the returned
   * `silentlyIgnored` is the set difference (current minus baseline) — i.e.,
   * paths the agent wrote that `.gitignore` excluded so `git add .` skipped
   * them. When omitted, `silentlyIgnored` is always empty (feature off).
   */
  baselineIgnored?: ReadonlySet<string>;
}

/**
 * Lists working-tree paths excluded from version control by `.gitignore` (or
 * any `core.excludesFile` / `info/exclude`). Fully-ignored directories collapse
 * to a single trailing-slash entry via `--directory`, so `node_modules/` does
 * not expand into every file inside it.
 *
 * Use as a snapshot taken before/after an agent round to detect writes the
 * orchestrator silently dropped because the agent's output path was
 * gitignored.
 */
export async function listIgnoredOtherFiles(
  codePath: string,
  env?: NodeJS.ProcessEnv,
): Promise<string[]> {
  const out = await git({
    cwd: codePath,
    env,
    args: ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * After an agent round: record **one {@link RunCommit} per git commit** on the first-parent chain
 * from `preRoundHeadSha` to `HEAD`, then optionally **one more** for leftover uncommitted work
 * (committed here with `saifctl: coding attempt <n>` unless overridden).
 *
 * Does **not** reset the repo — HEAD stays at the tip so tests run on the real tree.
 * On failed tests the caller should `git reset --hard` to `preRoundHeadSha` and drop all commits
 * from this round from `runCommits`.
 *
 * Writes combined `patch.diff` beside `code/` (for bookkeeping / PR summarizer).
 * Uses `git diff --binary` so binary files survive `git apply` on replay / host apply.
 */
export async function extractIncrementalRoundPatch(
  codePath: string,
  opts: ExtractIncrementalRoundPatchOpts,
): Promise<{
  patch: string;
  patchPath: string;
  commits: RunCommit[];
  /**
   * Paths that appeared in the working tree this session but were excluded by
   * `.gitignore` so `git add .` ignored them. Computed as
   * (current ignored entries) − (`baselineIgnored`). Empty when
   * `baselineIgnored` was not supplied.
   */
  silentlyIgnored: string[];
}> {
  const sandboxBasePath = join(codePath, '..');
  const patchPath = join(sandboxBasePath, 'patch.diff');
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'saifctl',
    GIT_AUTHOR_EMAIL: 'saifctl@safeaifactory.com',
    GIT_COMMITTER_NAME: 'saifctl',
    GIT_COMMITTER_EMAIL: 'saifctl@safeaifactory.com',
  };

  const preRoundHead = opts.preRoundHeadSha.trim();
  const exclude = opts.exclude ?? [];
  const commits: RunCommit[] = [];

  // Commits the agent made this round only (linear history — merges follow first parent).
  const revListRaw = (
    await git({
      cwd: codePath,
      env: gitEnv,
      args: ['rev-list', '--reverse', '--first-parent', `${preRoundHead}..HEAD`],
    })
  ).trim();
  const commitShas = revListRaw
    ? revListRaw
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  // Each commit becomes its own replayable RunCommit: diff from parent → stored message/author from that commit.
  for (const sha of commitShas) {
    const parent = (
      await git({ cwd: codePath, env: gitEnv, args: ['rev-parse', `${sha}^`] })
    ).trim();
    const rawPatch = await gitDiff({
      cwd: codePath,
      env: gitEnv,
      args: ['--binary', parent, sha],
    });
    const message = (
      await git({ cwd: codePath, env: gitEnv, args: ['log', '-1', '--format=%B', sha] })
    ).trimEnd();
    const author = (
      await git({ cwd: codePath, env: gitEnv, args: ['log', '-1', '--format=%an <%ae>', sha] })
    ).trim();
    const patch = exclude.length ? filterPatchHunks(rawPatch, exclude) : rawPatch;
    const normalizedPatch = patch.endsWith('\n') ? patch : `${patch}\n`;
    if (!normalizedPatch.trim()) continue;
    commits.push({ message, diff: normalizedPatch, author });
  }

  // Leftover uncommitted / unstaged changes:
  // Stage them, optionally make one temporary commit so we can diff it,
  // then either record a WIP run commit or undo the commit.
  // if exclude rules stripped everything — working tree stays ready for tests either way.
  await gitAdd({ cwd: codePath, env: gitEnv });
  // Omit `.saifctl/` from the staged changes
  try {
    await git({ cwd: codePath, env: gitEnv, args: ['reset', 'HEAD', '--', '.saifctl'] });
  } catch {
    /* .saifctl may be absent */
  }

  // If there are any staged changes after the `gitAdd` above,
  // create a commit for them.
  const hasStagedChanges = (
    await git({ cwd: codePath, env: gitEnv, args: ['diff', '--cached', '--name-only'] })
  ).trim();
  if (hasStagedChanges) {
    const lastCommitSha = (
      await git({ cwd: codePath, env: gitEnv, args: ['rev-parse', 'HEAD'] })
    ).trim();

    // Create a commit with unstaged / uncommitted changes.
    const wipMessage = opts.message ?? `saifctl: coding attempt ${opts.attempt}`;
    const wipAuthor = opts.author ?? SAIFCTL_DEFAULT_AUTHOR;
    await gitCommit({
      cwd: codePath,
      env: gitEnv,
      message: wipMessage,
      author: wipAuthor,
      verbose: false,
    });

    // Decide whether the commit we just created contains any changes
    // after we strip from it forbidden paths (e.g. `.saifctl/`).
    // If not, revert the commit.
    const rawWip = await gitDiff({
      cwd: codePath,
      env: gitEnv,
      args: ['--binary', lastCommitSha, 'HEAD'],
    });
    const wipPatch = exclude.length ? filterPatchHunks(rawWip, exclude) : rawWip;
    const normalizedWip = wipPatch.endsWith('\n') ? wipPatch : `${wipPatch}\n`;
    if (normalizedWip.trim()) {
      commits.push({ message: wipMessage, diff: normalizedWip, author: wipAuthor });
    } else {
      // Nothing left after exclude rules — drop the capture commit but keep changes staged (same tree for tests).
      await git({ cwd: codePath, env: gitEnv, args: ['reset', '--soft', 'HEAD~1'] });
    }
  }

  // Single file for humans / PR summarizer: all commit diffs back-to-back (commits[] is the source of truth for replay).
  const combinedPatch =
    commits.length > 0 ? `${commits.map((c) => c.diff.replace(/\n+$/, '')).join('\n')}\n` : '';
  await writeUtf8(patchPath, combinedPatch);

  // Surface paths the agent wrote that `git add` skipped because of `.gitignore`.
  // Without a baseline we can't tell agent-created entries apart from preexisting
  // ignores (node_modules/, dist/, …), so the feature only fires when the caller
  // opted in by passing `baselineIgnored`.
  const baseline = opts.baselineIgnored;
  const silentlyIgnored = baseline
    ? (await listIgnoredOtherFiles(codePath, gitEnv)).filter((p) => !baseline.has(p))
    : [];

  return { patch: combinedPatch, patchPath, commits, silentlyIgnored };
}

/**
 * Lists repo-relative paths referenced in a unified diff by parsing `diff --git` headers.
 * Uses the post-change path (`b/...`), except for lines of the form `diff --git /dev/null b/...`
 * (new files). Does not read the working tree.
 */
export function listFilePathsInUnifiedDiff(patch: string): string[] {
  if (!patch.trim()) return [];

  const paths: string[] = [];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;

    const fromNull = /^diff --git \/dev\/null b\/(.+)$/.exec(line);
    if (fromNull) {
      paths.push(fromNull[1]);
      continue;
    }

    const ab = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (ab) {
      const [, aPath, bPath] = ab;
      paths.push(bPath === '/dev/null' ? aPath : bPath);
    }
  }

  return [...new Set(paths)];
}

/**
 * Removes file sections from a unified diff whose paths match any of the given exclude rules.
 *
 * A unified diff is a sequence of file sections, each starting with:
 *   diff --git a/<path> b/<path>
 * We split on those headers, test the path against each rule, and reassemble.
 */
export function filterPatchHunks(patch: string, exclude: PatchExcludeRule[]): string {
  if (!patch || exclude.length === 0) return patch;

  const sections = patch.split(/(?=^diff --git )/m);
  const filtered: string[] = [];
  const dropped: string[] = [];

  for (const section of sections) {
    const match = /^diff --git a\/(.+?) b\//.exec(section);
    if (match && isExcluded(match[1], exclude)) {
      dropped.push(match[1]);
    } else {
      filtered.push(section);
    }
  }

  if (dropped.length > 0) {
    consola.warn(
      `[sandbox] Dropped ${dropped.length} file(s) from patch (reward-hacking prevention):\n` +
        dropped.map((p) => `  - ${p}`).join('\n'),
    );
  }

  return filtered.join('');
}

function isExcluded(filePath: string, rules: PatchExcludeRule[]): boolean {
  return rules.some((rule) =>
    rule.type === 'glob'
      ? minimatch(filePath, rule.pattern, { matchBase: false })
      : rule.pattern.test(filePath),
  );
}
