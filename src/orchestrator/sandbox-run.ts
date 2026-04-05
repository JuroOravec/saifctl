/**
 * Run a sandboxed agent, without the overhead of features, tests, or staging tests.
 *
 * Used by `saifctl sandbox` and the POC designer.
 *
 * Applies the standard sandbox overrides (no staging tests, no reviewer, maxRuns=1,
 * resolveAmbiguity=off) and delegates to {@link runStart}.
 */

import type { SaifctlConfig } from '../config/schema.js';
import type { LlmOverrides } from '../llm-config.js';
import type { Feature } from '../specs/discover.js';
import type { OrchestratorResult } from './loop.js';
import { runStart } from './modes.js';
import { type OrchestratorCliInput, resolveOrchestratorOpts } from './options.js';
import type { SandboxExtractMode } from './phases/sandbox-extract.js';

export interface RunSandboxOpts {
  projectDir: string;
  saifctlDir: string;
  config: SaifctlConfig;
  /** Caller constructs this — typically points at a tmpdir, not saifctl/features/. */
  feature: Feature;
  /** CLI/profile-specific overrides (gate script, cedar policy, agent profile, etc.). */
  cli: OrchestratorCliInput;
  cliModelDelta?: LlmOverrides;
  /** Engine selector string (e.g. 'docker'); `undefined` = use config default. */
  engineCli?: string;
  /** Task prompt passed verbatim to the agent. */
  task: string;
  /** Controls whether/how agent commits are applied to the host working tree. */
  extract: SandboxExtractMode;
  /** Required when `extract` is `'host-apply-filtered'`. */
  extractInclude?: string;
  extractExclude?: string;
}

/**
 * Resolves orchestrator options, applies sandbox-mode overrides, and runs the agent.
 *
 * Hardcoded overrides (never negotiable for sandbox runs):
 *   - `reviewerEnabled = false`
 *   - `maxRuns = 1`
 *   - `resolveAmbiguity = 'off'`
 *   - `skipStagingTests = true`
 *   - `allowSaifctlInPatch = true`
 *   - `taskPromptOverride` set from `opts.task`
 */
export async function runSandbox(opts: RunSandboxOpts): Promise<OrchestratorResult> {
  const {
    projectDir,
    saifctlDir,
    config,
    feature,
    cli,
    cliModelDelta,
    engineCli,
    task,
    extract,
    extractInclude,
    extractExclude,
  } = opts;

  const orchestratorOpts = await resolveOrchestratorOpts({
    projectDir,
    saifctlDir,
    config,
    feature,
    cli,
    cliModelDelta,
    artifact: null,
    engineCli,
  });

  orchestratorOpts.reviewerEnabled = false;
  orchestratorOpts.maxRuns = 1;
  orchestratorOpts.resolveAmbiguity = 'off';
  orchestratorOpts.taskPromptOverride = task;
  orchestratorOpts.skipStagingTests = true;
  orchestratorOpts.sandboxExtract = extract;
  orchestratorOpts.sandboxExtractInclude = extractInclude;
  orchestratorOpts.sandboxExtractExclude = extractExclude;

  return runStart({ ...orchestratorOpts, fromArtifact: null });
}
