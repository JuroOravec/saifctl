/**
 * Phase: run-agent-phase
 *
 * Runs the coder agent inside the coding container (Leash)
 * or with '--engine local' on the host). Returns the raw patch content produced by the agent.
 *
 * This is the inner atom for a single attempt:
 *   setup engine → runAgent → teardown engine → extractIncrementalRoundPatch
 *
 * The entire operation runs inside a `try/finally` so teardown() always fires,
 * even when Hatchet cancels the step (ctx.abortController.signal fires).
 */

import { resolveAgentProfile } from '../../agent-profiles/index.js';
import { createEngine } from '../../engines/index.js';
import { defaultEngineLog } from '../../engines/logs.js';
import { resolveAgentLlmConfig } from '../../llm-config.js';
import { consola } from '../../logger.js';
import type { RunCommit } from '../../runs/types.js';
import type { CleanupRegistry } from '../../utils/cleanup.js';
import { git } from '../../utils/git.js';
import { buildCoderContainerEnv } from '../agent-env.js';
import { buildTaskPrompt } from '../agent-task.js';
import { createAgentStdoutPipe, createDefaultAgentLog } from '../logs.js';
import type { IterativeLoopOpts } from '../loop.js';
import {
  extractIncrementalRoundPatch,
  listFilePathsInUnifiedDiff,
  type PatchExcludeRule,
  type Sandbox,
} from '../sandbox.js';
import { getArgusBinaryPath } from '../sidecars/reviewer/argus.js';
import { prepareRoundsStatsFile } from '../stats.js';

export interface RunAgentPhaseInput {
  sandbox: Sandbox;
  /** Which outer attempt this is (1-indexed) */
  attempt: number;
  /** Error feedback from the previous test run (empty on first attempt) */
  errorFeedback: string;
  /** Initial task prompt (built once per loop from plan.md + specification.md) */
  task: string;
  /** Patch exclusion rules (saifDir + .git/hooks/ already included) */
  patchExclude: PatchExcludeRule[];
  opts: Pick<
    IterativeLoopOpts,
    | 'overrides'
    | 'projectDir'
    | 'projectName'
    | 'feature'
    | 'dangerousNoLeash'
    | 'cedarPolicyPath'
    | 'coderImage'
    | 'gateRetries'
    | 'agentEnv'
    | 'agentSecretKeys'
    | 'agentSecretFiles'
    | 'agentProfileId'
    | 'reviewerEnabled'
    | 'codingEnvironment'
    | 'saifDir'
  >;
  registry: CleanupRegistry | null;
  /** When set, abort the agent container when this signal fires (Hatchet cancellation). */
  signal?: AbortSignal;
}

export interface RunAgentPhaseOutput {
  /** Filtered diffs concatenated (bookkeeping / test gate). Empty when the agent made no changes. */
  patchContent: string;
  /** Absolute path to patch.diff written to sandboxBasePath */
  patchPath: string;
  /** HEAD at the start of this round (for Ralph reset on failure). */
  preRoundHeadSha: string;
  /** One entry per sandbox commit this round (+ optional WIP); empty when no capture-worthy changes. */
  commits: RunCommit[];
}

export async function runAgentPhase(input: RunAgentPhaseInput): Promise<RunAgentPhaseOutput> {
  const { sandbox, attempt, errorFeedback, task, patchExclude, opts, registry, signal } = input;

  const preRoundHead = (await git({ cwd: sandbox.codePath, args: ['rev-parse', 'HEAD'] })).trim();
  const {
    overrides,
    projectDir,
    projectName,
    feature,
    dangerousNoLeash,
    cedarPolicyPath,
    coderImage,
    gateRetries,
    agentEnv,
    agentProfileId,
    reviewerEnabled,
    codingEnvironment,
    saifDir,
    agentSecretKeys,
    agentSecretFiles,
  } = opts;

  const agentProfile = resolveAgentProfile(agentProfileId);
  const coderLlmConfig = resolveAgentLlmConfig('coder', overrides);
  const codingIsLocal = codingEnvironment.engine === 'local';
  const reviewer =
    reviewerEnabled && !codingIsLocal
      ? {
          llmConfig: resolveAgentLlmConfig('reviewer', overrides),
          argusBinaryPath: await getArgusBinaryPath(),
        }
      : null;

  const codingRunId = `${sandbox.runId}-coding-${attempt}`;
  const codingEngine = createEngine(codingEnvironment);
  registry?.registerEngine(codingEngine, codingRunId);

  try {
    await codingEngine.setup({
      runId: codingRunId,
      projectName,
      featureName: feature.name,
      projectDir,
    });

    await prepareRoundsStatsFile(sandbox.sandboxBasePath);

    const logStrategy = agentProfile.stdoutStrategy;
    const { onAgentStdout, onAgentStdoutEnd } = createAgentStdoutPipe({
      stdoutStrategy: logStrategy,
      onAgentLog: createDefaultAgentLog({
        linePrefix: 'agent',
        stdoutStrategy: logStrategy,
      }),
    });

    const taskPrompt = await buildTaskPrompt({
      codePath: sandbox.codePath,
      task,
      saifDir,
      feature,
      errorFeedback,
    });

    const containerEnv = await buildCoderContainerEnv({
      mode: codingIsLocal
        ? { kind: 'host', codePath: sandbox.codePath, saifacPath: sandbox.saifacPath }
        : { kind: 'container' },
      llmConfig: coderLlmConfig,
      reviewer: reviewer ? { llmConfig: reviewer.llmConfig } : null,
      agentEnv,
      projectDir,
      agentSecretKeys,
      agentSecretFiles,
      taskPrompt,
      gateRetries,
      runId: sandbox.runId,
    });

    await codingEngine.runAgent({
      codePath: sandbox.codePath,
      sandboxBasePath: sandbox.sandboxBasePath,
      containerEnv,
      dangerousNoLeash,
      cedarPolicyPath,
      coderImage,
      saifacPath: sandbox.saifacPath,
      onAgentStdout,
      onAgentStdoutEnd,
      onLog: defaultEngineLog,
      reviewer: reviewer ? { argusBinaryPath: reviewer.argusBinaryPath } : null,
      signal,
    });
  } finally {
    registry?.deregisterEngine(codingEngine);
    await codingEngine.teardown({ runId: codingRunId });
  }

  const {
    patch: patchContent,
    patchPath,
    commits,
  } = await extractIncrementalRoundPatch(sandbox.codePath, {
    preRoundHeadSha: preRoundHead,
    attempt,
    exclude: patchExclude,
  });

  const patchPaths = listFilePathsInUnifiedDiff(patchContent);
  if (!patchContent.trim()) {
    consola.log('[run-agent-phase] Patch empty — 0 file(s) in patch content');
  } else if (patchPaths.length === 0) {
    consola.warn(
      '[run-agent-phase] Non-empty patch but no paths parsed from diff --git headers — check patch format.',
    );
  } else {
    consola.log(
      `[run-agent-phase] Files in patch content (${patchPaths.length}): ${patchPaths.join(', ')}`,
    );
  }

  return { patchContent, patchPath, preRoundHeadSha: preRoundHead, commits };
}
