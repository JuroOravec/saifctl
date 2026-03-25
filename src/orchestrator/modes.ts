/**
 * Orchestration modes for the Software Factory.
 *
 *  1. fail2pass      — Verify at least one feature test fails on current codebase (sanity check; partial overlap OK)
 *  2. start          — Create a fresh sandbox and run the iterative agent loop
 *  3. resume         — Resume a failed run from storage then calls start
 *  4. test           — Re-test a stored run's patch without running the coding agent loop
 *  5. inspect        — Idle coding container for a stored run (changes made in the container are saved)
 */

import { join } from 'node:path';

import type { SaifacConfig } from '../config/schema.js';
import { getSaifRoot } from '../constants.js';
import { getHatchetClient } from '../hatchet/client.js';
import { serializeOrchestratorOpts } from '../hatchet/utils/serialize-opts.js';
import {
  createFeatRunWorkflow,
  type FeatRunSerializedInput,
} from '../hatchet/workflows/feat-run.workflow.js';
import { type ModelOverrides, resolveAgentLlmConfig } from '../llm-config.js';
import { consola } from '../logger.js';
import { hasFeatureSuccessfullyFailed } from '../provisioners/docker/index.js';
import { createProvisioner } from '../provisioners/index.js';
import { type CoderInspectSessionHandle } from '../provisioners/types.js';
import { type RunPatchStep, type RunStorage, StaleArtifactError } from '../runs/types.js';
import { buildRunArtifact, type BuildRunArtifactOpts } from '../runs/utils/artifact.js';
import { deserializeArtifactConfig } from '../runs/utils/serialize.js';
import { resolveFeature } from '../specs/discover.js';
import { CleanupRegistry } from '../utils/cleanup.js';
import { git } from '../utils/git.js';
import { writeUtf8 } from '../utils/io.js';
import {
  buildInitialTask,
  buildPatchExcludeRules,
  type IterativeLoopOpts,
  logIterativeLoopSettings,
  type OrchestratorResult,
  prepareTestRunnerOpts,
  runIterativeLoop,
  type RunStorageContext,
} from './loop.js';
import { type OrchestratorCliInput, resolveOrchestratorOpts } from './options.js';
import {
  captureBaseGitState,
  cleanupResumeWorkspace,
  createResumeWorktree,
  saveRunOnError,
} from './resume.js';
import { createSandbox, destroySandbox, extractIncrementalRoundPatch } from './sandbox.js';
import { getArgusBinaryPath } from './sidecars/reviewer/argus.js';

export interface OrchestratorOpts extends IterativeLoopOpts {
  /**
   * Base directory where sandbox entries are created.
   */
  sandboxBaseDir: string;
  /**
   * Content of the gate script to run after each OpenHands round. In leash mode the script is
   * written to sandboxBasePath/gate.sh and mounted read-only at /saifac/gate.sh inside the
   * container. In --dangerous-debug mode it runs directly on the host via bash.
   *
   * It must exit 0 to pass; non-zero causes the inner loop to retry with the output as feedback.
   *
   * Resolved by the CLI: defaults to the gate.sh from the resolved sandbox profile when --gate-script is not set.
   */
  gateScript: string;
  /**
   * Content of the startup script to run once before the agent loop begins.
   * Written to sandboxBasePath/startup.sh and mounted read-only at /saifac/startup.sh
   * inside the coder container (or run directly on the host in --dangerous-debug mode).
   *
   * Use for workspace setup that requires the workspace to be mounted first:
   * pnpm install, pip install -r requirements.txt, cargo fetch, etc.
   *
   * Resolved by the CLI: set via --profile or --startup-script. When neither is
   * provided, the profile's installation script is used.
   */
  startupScript: string;
  /**
   * Content of the agent setup script to write into the sandbox as `agent-install.sh`.
   * Mounted read-only at `/saifac/agent-install.sh` inside the coder container and executed
   * once by `coder-start.sh` after the startup script, before the agent loop begins.
   *
   * Use to install the coding agent at runtime (e.g. `pipx install aider-chat`).
   *
   * Resolved by the CLI: defaults to the agent profile's agent-install.sh.
   */
  agentInstallScript: string;
  /**
   * Content of the agent script to write into the sandbox as `agent.sh`.
   * Mounted read-only at `/saifac/agent.sh` inside the coder container and invoked
   * by `coder-start.sh` once per inner round. The script must read the task from
   * `$SAIFAC_TASK_PATH`.
   *
   * Resolved by the CLI: defaults to the agent profile's agent.sh (OpenHands) when
   * --agent and --agent-script are not set.
   */
  agentScript: string;
  /**
   * Content of the staging script mounted read-only in the staging container at /saifac/stage.sh.
   * Invoked by staging-start.sh after the installation script and the sidecar have run.
   *
   * Resolved by the CLI: set via --profile or --stage-script. When neither is provided,
   * the profile's stage script is used.
   */
  stageScript: string;
  /**
   * Reporting-only paths for run artifacts (relative to projectDir when under the project,
   * else absolute). Not read by the orchestrator for execution.
   */
  startupScriptFile: string;
  gateScriptFile: string;
  stageScriptFile: string;
  testScriptFile: string;
  agentInstallScriptFile: string;
  agentScriptFile: string;
  /**
   * Run storage for persisting failed runs. Resolved by CLI via readStorageStringFromCli + resolveRunStorage.
   * Default: local (.saifac/runs/) when --storage is omitted. Set to null for --storage runs=none.
   */
  runStorage: RunStorage | null;
  /**
   * When set, runStartCore operates in resume mode: use sandboxSourceDir for createSandbox,
   * skip base git capture, and pass initialErrorFeedback to the loop.
   * Only used when runResumeCore delegates to runStartCore.
   */
  resume: {
    sandboxSourceDir: string;
    runContext: RunStorageContext;
    initialErrorFeedback?: string;
    /** Base tree copy (before run steps) — sandbox rsync source for resume/tests/inspect */
    baseSnapshotPath?: string;
    /** Stored `runPatchSteps` replayed after the sandbox "Base state" commit */
    seedRunPatchSteps?: RunPatchStep[];
    /**
     * When resuming from `run storage`, the run id to reuse for the sandbox and persisted artifact
     * (same as the key passed to `saifac run resume <id>`).
     */
    persistedRunId?: string;
    /**
     * Stored {@link RunArtifact#artifactRevision} at resume time (missing treated as 0).
     *
     * Used for optimistic locking on `saveRun`, same pattern as `run inspect`.
     *
     * This is used to prevent race conditions when multiple processes are trying to save the same run.
     * If the revision is not the same as the one in storage, the save will fail.
     */
    artifactRevisionAtResume?: number;
  } | null;
  /**
   * When true, append the semantic reviewer step to the gate script.
   * Disabled via --no-reviewer.
   */
  reviewerEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Cleanup registry decorator
// ---------------------------------------------------------------------------

function withCleanupRegistry<T, R>(
  fn: (opts: T, registry: CleanupRegistry) => Promise<R>,
): (opts: T) => Promise<R> {
  return async (opts: T): Promise<R> => {
    const registry = new CleanupRegistry();
    let isCleaningUp = false;

    // This function is called when the user hits Ctrl+C or the process is terminated.
    // It cleans up the containers and networks created during the run.
    // It also saves the run state to runStorage so the user can resume later.
    const onSignal = (sig: string) => {
      if (isCleaningUp) return;
      isCleaningUp = true;

      consola.log(`\n[orchestrator] ${sig} received — cleaning up...`);

      // The terminal sends SIGINT to the whole process group.
      // pnpm (the parent) catches SIGINT and immediately sends SIGTERM to us.
      // We must catch BOTH and explicitly ignore them so Node doesn't die
      // before our async Docker API calls finish.
      const ignore = () => {};
      process.on('SIGINT', ignore);
      process.on('SIGTERM', ignore);

      void (async () => {
        try {
          await registry.cleanup();
        } catch (err) {
          consola.warn('[orchestrator] Cleanup error:', err);
        } finally {
          process.exit(sig === 'SIGINT' ? 130 : 143);
        }
      })();
    };

    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));

    try {
      return await fn(opts, registry);
    } finally {
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
    }
  };
}

// ---------------------------------------------------------------------------
// Public entry points (wrapped with cleanup registry)
// ---------------------------------------------------------------------------

export const runFail2Pass = withCleanupRegistry(runFail2PassCore);
export const runStart = withCleanupRegistry(runStartCore);
export const runResume = withCleanupRegistry(runResumeCore);
export const runTestsFromRun = withCleanupRegistry(runTestsFromRunCore);

// ---------------------------------------------------------------------------
// Mode 1: fail2pass
// ---------------------------------------------------------------------------

/**
 * Spins up containers with no patch applied and runs the full test suite
 * (including hidden tests). Asserts that tests FAIL (exit code 1).
 *
 * Purpose: sanity-check that the tests are actually testing something new
 * and haven't been accidentally satisfied by existing code.
 */
type Fail2PassOpts = Pick<
  OrchestratorOpts,
  | 'sandboxProfileId'
  | 'feature'
  | 'projectDir'
  | 'saifDir'
  | 'projectName'
  | 'sandboxBaseDir'
  | 'testImage'
  | 'stagingEnvironment'
  | 'startupScript'
  | 'gateScript'
  | 'agentInstallScript'
  | 'agentScript'
  | 'stageScript'
  | 'testScript'
  | 'verbose'
>;

async function runFail2PassCore(
  opts: Fail2PassOpts,
  registry: CleanupRegistry,
): Promise<OrchestratorResult> {
  const {
    sandboxProfileId,
    feature,
    projectDir,
    saifDir,
    projectName,
    sandboxBaseDir,
    testImage,
    stagingEnvironment,
    startupScript,
    gateScript,
    agentInstallScript,
    agentScript,
    stageScript,
    testScript,
  } = opts;

  consola.log(`\n[orchestrator] MODE: fail2pass — ${feature.name}`);

  const sandbox = await createSandbox({
    feature,
    projectDir,
    saifDir,
    projectName,
    sandboxBaseDir,
    startupScript,
    gateScript,
    agentInstallScript,
    agentScript,
    stageScript,
    verbose: opts.verbose,
  });
  registry.setEmergencySandboxPath(sandbox.sandboxBasePath);
  const testRunnerOpts = await prepareTestRunnerOpts({
    feature,
    sandboxBasePath: sandbox.sandboxBasePath,
    testScript,
  });

  const provisioner = createProvisioner(stagingEnvironment);
  registry.registerProvisioner(provisioner, sandbox.runId);

  try {
    await provisioner.setup({
      runId: sandbox.runId,
      projectName,
      featureName: feature.name,
      projectDir,
    });

    const stagingHandle = await provisioner.startStaging({
      sandboxProfileId,
      codePath: sandbox.codePath,
      projectDir,
      stagingEnvironment,
      feature,
      projectName,
      startupPath: sandbox.startupPath,
      stagePath: sandbox.stagePath,
    });

    const result = await provisioner.runTests({
      ...testRunnerOpts,
      stagingHandle,
      testImage,
      runId: sandbox.runId,
      feature,
      projectName,
      reportPath: join(sandbox.sandboxBasePath, 'results.xml'),
    });

    if (result.runnerError) {
      throw new Error(
        `Test runner error (not a test failure): ${result.runnerError}\n` +
          `Check that runner.spec.ts and tests.json are present and valid.\n` +
          `Stderr:\n${result.stderr}`,
      );
    }

    if (hasFeatureSuccessfullyFailed(result)) {
      consola.log(
        '\n[orchestrator] ✓ FAIL2PASS CONFIRMED — feature tests correctly fail on current codebase',
      );
      return {
        success: true,
        attempts: 1,
        message: 'Tests correctly fail on current codebase. Ready to start the iterative loop.',
      };
    } else {
      consola.error(
        '\n[orchestrator] ✗ FAIL2PASS REJECTED — no feature tests failed on current codebase',
      );
      consola.error('Either the feature already exists or the tests are invalid.');
      return {
        success: false,
        attempts: 1,
        message:
          'No feature tests failed on current codebase — feature may already be implemented or tests are invalid.',
      };
    }
  } finally {
    registry.deregisterProvisioner(provisioner);
    await provisioner.teardown({ runId: sandbox.runId });
    await destroySandbox(sandbox.sandboxBasePath);
    registry.clearEmergencySandboxPath();
  }
}

// ---------------------------------------------------------------------------
// Mode 2: start
// ---------------------------------------------------------------------------

/**
 * Creates a fresh sandbox and runs the full Ralph Wiggum iterative loop:
 *   1. Run OpenHands to implement the feature
 *   2. Extract the patch
 *   3. Run Mutual Verification (Container A + B)
 *   4. If pass → apply patch to host, commit, open PR
 *   5. If fail → feed stderr back to OpenHands, repeat
 */
async function runStartCore(
  opts: OrchestratorOpts,
  registry: CleanupRegistry,
): Promise<OrchestratorResult> {
  const {
    feature,
    projectDir,
    saifDir,
    projectName,
    sandboxBaseDir,
    gateScript,
    startupScript,
    agentInstallScript,
    agentScript,
    stageScript,
    runStorage,
    testOnly,
  } = opts;

  consola.log(`\n[orchestrator] MODE: ${testOnly ? 'test' : 'start'} — ${feature.name}`);

  const sandboxSourceDir = getSandboxSourceDir(opts);

  // ─── Run context (for save-on-Ctrl+C / save-on-failure) ────────────────────
  // Capture all the relevant state so that we can resume the run later.
  // Thus, if `runIterativeLoop` throws or user aborts with CTRL+C, the loop
  // will persist an artifact with all the relevant state so the user can
  // resume later with `saifac run resume <runId>`.
  let runContext: RunStorageContext;
  if (opts.resume) {
    // Resume: use the context from the stored artifact
    runContext = opts.resume.runContext;
  } else {
    // Start: capture the current git state so we can reconstruct it when resuming
    runContext = await captureBaseGitState(projectDir);
  }

  // ─── Hatchet path ─────────────────────────────────────────────────────────
  // When HATCHET_CLIENT_TOKEN is set, dispatch via Hatchet (distributed mode).
  // IMPORTANT: Do not call createSandbox here — the worker's provision-sandbox task creates
  // the only sandbox. A local createSandbox before this branch used to leak sandboxes on
  // every Hatchet dispatch.
  //
  // OrchestratorOpts is not JSON-serializable (contains gitProvider/testProfile class
  // instances, patchExclude RegExp), so we serialize it at dispatch and reconstruct it
  // on the worker via deserializeOrchestratorOpts — no ambient in-process state needed.
  const hatchet = getHatchetClient();
  if (hatchet) {
    consola.log('[orchestrator] Hatchet token detected — dispatching via Hatchet workflow.');

    const serializedOpts = serializeOrchestratorOpts(opts);
    const featRunWorkflow = createFeatRunWorkflow();

    // Start an inline worker for this request. In production a persistent
    // worker process (`saifac worker start`) is preferred.
    const worker = await hatchet.worker('saifac-worker', { workflows: [featRunWorkflow] });
    await worker.start();

    try {
      const input: FeatRunSerializedInput = {
        serializedOpts,
        runContext: {
          baseCommitSha: runContext.baseCommitSha,
          basePatchDiff: runContext.basePatchDiff,
          lastErrorFeedback: runContext.lastErrorFeedback,
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await hatchet.run<FeatRunSerializedInput, any>(
        featRunWorkflow.name,
        input,
      )) as OrchestratorResult;
    } finally {
      // Note: There is finally, but not `catch` branch, so the error still throws
      // after the cleanup.
      await worker.stop();
    }
  }

  const sandbox = await createSandbox({
    feature,
    projectDir: sandboxSourceDir,
    codeSourceDir: opts.resume?.baseSnapshotPath ?? sandboxSourceDir,
    saifDir,
    projectName,
    sandboxBaseDir,
    gateScript,
    startupScript,
    agentInstallScript,
    agentScript,
    stageScript,
    verbose: opts.verbose,
    runPatchSteps: opts.resume?.seedRunPatchSteps ?? [],
    runId: opts.resume?.persistedRunId,
  });

  registry.setEmergencySandboxPath(sandbox.sandboxBasePath);

  // ─── Save run artifact on interrupt (Ctrl+C) ───────────────────────────────
  // Normal exit (success or failure) is handled inside runIterativeLoop cleanup.
  if (runStorage) {
    const resumeRev = opts.resume?.artifactRevisionAtResume;
    registry.setBeforeCleanup(async () => {
      await saveRunOnError({
        sandbox,
        runContext,
        opts,
        runStorage,
        saveRunOptions: resumeRev === undefined ? undefined : { ifRevisionEquals: resumeRev },
      });
    });
  }

  // ─── Existing in-process path ──────────────────────────────────────────────
  return runIterativeLoop(sandbox, {
    ...opts,
    saifDir,
    runStorage,
    runContext,
    initialErrorFeedback: opts.resume?.initialErrorFeedback ?? null,
    seedRunPatchSteps: opts.resume?.seedRunPatchSteps ?? [],
    registry,
  });
}

// ---------------------------------------------------------------------------
// Mode 3: resume (from storage)
// ---------------------------------------------------------------------------

export interface ResumeOpts {
  runId: string;
  projectDir: string;
  saifDir: string;
  config: SaifacConfig;
  runStorage: RunStorage;
  cli: OrchestratorCliInput;
  cliModelDelta: ModelOverrides | undefined;
}

/**
 * Resumes a run from storage. Fetches the artifact, prepares workspace from
 * baseCommitSha + diffs, creates a fresh sandbox, and runs the loop.
 * Delegates to runStartCore with resume opts.
 *
 * Used by both `run resume` and `run test`.
 */
async function runResumeCore(
  opts: ResumeOpts & { testOnly?: boolean },
  registry: CleanupRegistry,
): Promise<OrchestratorResult> {
  const {
    runId,
    projectDir,
    runStorage,
    cli,
    cliModelDelta,
    config,
    saifDir,
    testOnly = false,
  } = opts;

  const artifact = await runStorage.getRun(runId);
  if (!artifact) {
    throw new Error(`Run not found: ${runId}. List runs with: saifac run ls`);
  }

  const mode = testOnly ? 'test' : 'resume';
  consola.log(`\n[orchestrator] MODE: ${mode} — ${artifact.config.featureName} (run ${runId})`);

  // Fresh worktree under /tmp/saifac/resume-worktrees/ (from artifact), then fresh sandbox in runStartCore
  // to reconstruct the state of the workspace at the time of the run (+ agent's changes)
  const { worktreePath, branchName, baseSnapshotPath } = await createResumeWorktree({
    projectDir,
    runId,
    baseCommitSha: artifact.baseCommitSha,
    basePatchDiff: artifact.basePatchDiff,
    runPatchSteps: artifact.runPatchSteps,
  });

  const deserialized = deserializeArtifactConfig(artifact.config);
  const feature = await resolveFeature({
    input: deserialized.featureName,
    projectDir,
    saifDir: deserialized.saifDir,
  });

  const mergedOpts = await resolveOrchestratorOpts({
    projectDir,
    saifDir,
    config,
    feature,
    cli,
    cliModelDelta,
    artifact,
  });

  mergedOpts.resume = {
    sandboxSourceDir: worktreePath,
    baseSnapshotPath,
    seedRunPatchSteps: artifact.runPatchSteps,
    runContext: {
      baseCommitSha: artifact.baseCommitSha,
      basePatchDiff: artifact.basePatchDiff,
    },
    initialErrorFeedback: artifact.lastFeedback,
    persistedRunId: runId,
    artifactRevisionAtResume: artifact.artifactRevision ?? 0,
  };

  logIterativeLoopSettings(mergedOpts);

  try {
    // Finally, run the same flow as when we run `saifac feat start <featureName>`
    return await runStartCore(mergedOpts, registry);
  } finally {
    await cleanupResumeWorkspace({ worktreePath, projectDir, branchName }, () => {
      // Best-effort cleanup
    });
  }
}

// ---------------------------------------------------------------------------
// Mode 3b: inspect (stored run → resume worktree + sandbox + idle coder container)
// ---------------------------------------------------------------------------

export type InspectOpts = Omit<ResumeOpts, 'dangerousDebug'> & {
  /**
   * When true, run the inspect container under Leash/Cedar like the coding agent.
   * Default (false/omitted) uses plain `docker run` so operations blocked by Cedar (e.g. git commit) work.
   */
  inspectLeash?: boolean;
};

/**
 * Opens the same coding environment as the first round of `run resume`, with an idle container
 * (`sleep infinity`). When the process is stopped, code changes from the container are extracted
 * and saved the same way as when we run the coding agent. Thus, allowing the user
 * to manually code the feature and save the changes to the run storage.
 *
 * Not wrapped with the cleanup-registry decorator: SIGINT ends the wait and
 * runs a controlled teardown (save + destroy) instead of the global registry exit path.
 */
export async function runInspect(opts: InspectOpts): Promise<void> {
  const { runId, projectDir, runStorage, cli, cliModelDelta, config, saifDir, inspectLeash } = opts;
  const inspectDangerousNoLeash = inspectLeash !== true;

  if (!runStorage) {
    throw new Error('Run inspect requires run storage (do not use --storage with runs=none).');
  }

  const artifact = await runStorage.getRun(runId);
  if (!artifact) {
    throw new Error(`Run not found: ${runId}. List runs with: saifac run ls`);
  }

  consola.log(`\n[orchestrator] MODE: inspect — ${artifact.config.featureName} (run ${runId})`);

  const { worktreePath, branchName, baseSnapshotPath } = await createResumeWorktree({
    projectDir,
    runId,
    baseCommitSha: artifact.baseCommitSha,
    basePatchDiff: artifact.basePatchDiff,
    runPatchSteps: artifact.runPatchSteps,
  });

  const expectedRevision = artifact.artifactRevision ?? 0;
  const prevStepsJson = JSON.stringify(artifact.runPatchSteps);
  let inspectSaveError: unknown;

  try {
    const deserialized = deserializeArtifactConfig(artifact.config);
    const feature = await resolveFeature({
      input: deserialized.featureName,
      projectDir,
      saifDir: deserialized.saifDir,
    });

    const mergedOpts = await resolveOrchestratorOpts({
      projectDir,
      saifDir,
      config,
      feature,
      cli,
      cliModelDelta,
      artifact,
    });

    if (mergedOpts.dangerousDebug) {
      consola.warn(
        '[inspect] Run inspect does not support --dangerous-debug (host-based coding); ignoring.',
      );
      mergedOpts.dangerousDebug = false;
    }

    mergedOpts.resume = {
      sandboxSourceDir: worktreePath,
      baseSnapshotPath,
      seedRunPatchSteps: artifact.runPatchSteps,
      runContext: {
        baseCommitSha: artifact.baseCommitSha,
        basePatchDiff: artifact.basePatchDiff,
      },
      initialErrorFeedback: artifact.lastFeedback,
    };

    logIterativeLoopSettings(mergedOpts);

    const sandboxSourceDir = getSandboxSourceDir(mergedOpts);
    const sandbox = await createSandbox({
      feature,
      projectDir: sandboxSourceDir,
      codeSourceDir: mergedOpts.resume?.baseSnapshotPath ?? sandboxSourceDir,
      saifDir,
      projectName: mergedOpts.projectName,
      sandboxBaseDir: mergedOpts.sandboxBaseDir,
      gateScript: mergedOpts.gateScript,
      startupScript: mergedOpts.startupScript,
      agentInstallScript: mergedOpts.agentInstallScript,
      agentScript: mergedOpts.agentScript,
      stageScript: mergedOpts.stageScript,
      verbose: mergedOpts.verbose,
      runPatchSteps: mergedOpts.resume?.seedRunPatchSteps ?? [],
    });

    const preInspectHead = (
      await git({ cwd: sandbox.codePath, args: ['rev-parse', 'HEAD'] })
    ).trim();

    const patchExclude = buildPatchExcludeRules(saifDir, mergedOpts.patchExclude);

    const runContext = mergedOpts.resume.runContext;
    const inspectRunId = `${sandbox.runId}-inspect`;
    const codingProvisioner = createProvisioner(mergedOpts.codingEnvironment);

    const task = await buildInitialTask({ feature, saifDir });
    const errorFeedback = artifact.lastFeedback ?? '';

    const coderLlmConfig = resolveAgentLlmConfig('coder', mergedOpts.overrides);
    const reviewer =
      mergedOpts.reviewerEnabled && !mergedOpts.dangerousDebug
        ? {
            llmConfig: resolveAgentLlmConfig('reviewer', mergedOpts.overrides),
            scriptPath: join(getSaifRoot(), 'src', 'orchestrator', 'scripts', 'reviewer.sh'),
            argusBinaryPath: await getArgusBinaryPath(),
          }
        : null;

    let inspectHandle: CoderInspectSessionHandle | null = null;

    try {
      try {
        await codingProvisioner.setup({
          runId: inspectRunId,
          projectName: mergedOpts.projectName,
          featureName: feature.name,
          projectDir: mergedOpts.projectDir,
        });

        inspectHandle = await codingProvisioner.startInspect({
          codePath: sandbox.codePath,
          sandboxBasePath: sandbox.sandboxBasePath,
          task,
          errorFeedback,
          saifDir,
          feature,
          coderImage: mergedOpts.coderImage,
          dangerousNoLeash: inspectDangerousNoLeash,
          cedarPolicyPath: mergedOpts.cedarPolicyPath,
          startupPath: sandbox.startupPath,
          agentInstallPath: sandbox.agentInstallPath,
          agentPath: sandbox.agentPath,
          agentEnv: mergedOpts.agentEnv,
          agentLogFormat: mergedOpts.agentLogFormat,
          reviewer,
          gateRetries: mergedOpts.gateRetries,
          llmConfig: coderLlmConfig,
        });

        consola.log(`\n[inspect] Attach your editor with Dev Containers or \`docker exec -it\`:`);
        consola.log(`  Container: \`${inspectHandle.containerName}\``);
        consola.log(`  Workspace: \`${inspectHandle.workspacePath}\``);
        consola.log('[inspect] Press Ctrl+C when done to save changes and clean up.\n');

        await new Promise<void>((resolve) => {
          const onExit = (sig: string) => {
            consola.log(
              `\n[inspect] ${sig} received — stopping session and cleaning up Docker (this may take a few seconds)...`,
            );
            resolve();
          };
          process.once('SIGINT', () => onExit('SIGINT'));
          process.once('SIGTERM', () => onExit('SIGTERM'));
        });
      } finally {
        const ignore = () => {};
        process.on('SIGINT', ignore);
        process.on('SIGTERM', ignore);
        try {
          if (inspectHandle) {
            await inspectHandle.stop().catch((err: unknown) => {
              consola.warn('[inspect] inspect session stop:', err);
            });
          }
          await codingProvisioner.teardown({ runId: inspectRunId }).catch((err: unknown) => {
            consola.warn('[inspect] provisioner teardown:', err);
          });

          // Extract any changes made in the container
          const { steps: inspectSteps } = await extractIncrementalRoundPatch(sandbox.codePath, {
            preRoundHeadSha: preInspectHead,
            attempt: 1,
            message: 'saifac: inspect session',
            exclude: patchExclude,
          });
          const nextSteps =
            inspectSteps.length > 0
              ? [...artifact.runPatchSteps, ...inspectSteps]
              : artifact.runPatchSteps;
          const nextJson = JSON.stringify(nextSteps);
          if (nextJson !== prevStepsJson) {
            const { runStorage: _rs, resume: _r, ...artifactLoopOpts } = mergedOpts;
            const newArtifact = buildRunArtifact({
              runId,
              baseCommitSha: runContext.baseCommitSha,
              basePatchDiff: runContext.basePatchDiff,
              runPatchSteps: nextSteps,
              specRef: feature.relativePath,
              lastFeedback: artifact.lastFeedback,
              status: artifact.status,
              opts: artifactLoopOpts as BuildRunArtifactOpts,
            });
            try {
              await runStorage.saveRun(runId, newArtifact, {
                ifRevisionEquals: expectedRevision,
              });
              consola.log('[inspect] Saved updated run patch steps to storage.');
            } catch (e) {
              if (e instanceof StaleArtifactError) {
                consola.warn(`[inspect] ${e.message}`);
                const fallback = join(projectDir, `.saifac-inspect-stale-${runId}.json`);
                await writeUtf8(fallback, nextJson);
                consola.warn(
                  `[inspect] Wrote working tree steps to ${fallback} — merge manually after reloading the run.`,
                );
              } else {
                inspectSaveError = e;
              }
            }
          } else {
            consola.log('[inspect] No patch changes; skipping save.');
          }
        } finally {
          process.removeListener('SIGINT', ignore);
          process.removeListener('SIGTERM', ignore);
        }
      }
    } finally {
      await destroySandbox(sandbox.sandboxBasePath);
    }
  } finally {
    await cleanupResumeWorkspace({ worktreePath, projectDir, branchName }, () => {
      consola.warn(`[orchestrator] Could not clean up worktree at ${worktreePath}`);
    });
  }

  if (inspectSaveError) throw inspectSaveError;
}

// ---------------------------------------------------------------------------
// Mode 4: test
// ---------------------------------------------------------------------------

export type TestFromRunOpts = ResumeOpts;

/**
 * Re-tests the patch from a stored run without running the coding agent loop.
 *
 * Useful after a run completes/fails/pauses to re-run just the test phase with
 * updated tests, a different test profile, or to promote a passing patch to a PR.
 *
 * Same pipeline as {@link runResume} with {@link OrchestratorOpts#testOnly}: materialize worktree,
 * sandbox, staging tests, optional host apply — and persist results like resume.
 */
async function runTestsFromRunCore(
  opts: TestFromRunOpts,
  registry: CleanupRegistry,
): Promise<OrchestratorResult> {
  return runResumeCore({ ...opts, testOnly: true }, registry);
}

/**
 * Resolves the directory `createSandbox` rsyncs FROM.
 *
 * - **Start:** the main project directory (`opts.projectDir`).
 * - **Resume:** the ephemeral worktree path under `/tmp/saifac/resume-worktrees/`
 *   (`opts.resume.sandboxSourceDir`), materialized from the run artifact.
 */
export function getSandboxSourceDir(opts: {
  projectDir: string;
  resume: { sandboxSourceDir: string } | null;
}): string {
  return opts.resume?.sandboxSourceDir ?? opts.projectDir;
}
