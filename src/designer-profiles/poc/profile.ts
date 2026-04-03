/**
 * POC designer profile.
 *
 * Runs a full containerised agent Run — tracked as `<feat>-poc` — whose goal is to
 * explore the feature through a quick-and-dirty proof-of-concept implementation.
 * The agent may write anywhere under `saifctl/features/` (primary outputs go under
 * `saifctl/features/<feat>/`, not under the `-poc` id).
 *
 * The agent receives instructions via {@link taskPromptOverride} (see
 * {@link resolveIterativeLoopTask}); the synthetic `saifctl/features/<feat>-poc/`
 * directory exists only so the orchestrator can resolve the run feature.
 *
 * After the run completes, file changes under `saifctl/features/` are applied to the
 * host with `git apply` (except paths under `saifctl/features/<feat>-poc/`). Product code
 * outside `saifctl/features/` stays on the Run only.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { loadSaifctlConfig } from '../../config/load.js';
import { getSaifctlRoot } from '../../constants.js';
import { consola } from '../../logger.js';
import { runStart } from '../../orchestrator/modes.js';
import { type OrchestratorCliInput, resolveOrchestratorOpts } from '../../orchestrator/options.js';
import { resolveFeature } from '../../specs/discover.js';
import { git } from '../../utils/git.js';
import { pathExists, readUtf8, writeUtf8 } from '../../utils/io.js';
import type { DesignerBaseOpts, DesignerProfile, DesignerRunOpts } from '../types.js';
import { buildPocTask } from './task.js';

const POC_SUFFIX = '-poc';

/** Output files required in the REAL feature dir for hasRun() to return true. */
const REQUIRED_OUTPUT_FILES = ['specification.md', 'plan.md'] as const;

export const pocDesignerProfile: DesignerProfile = {
  id: 'poc',
  displayName: 'POC Explorer',

  async hasRun({ feature }: DesignerBaseOpts): Promise<boolean> {
    for (const f of REQUIRED_OUTPUT_FILES) {
      if (!(await pathExists(join(feature.absolutePath, f)))) return false;
    }
    return true;
  },

  async run({ cwd, feature, saifctlDir, model, prompt }: DesignerRunOpts): Promise<void> {
    const projectDir = cwd;
    const realFeatName = feature.name;
    const pocFeatName = `${realFeatName}${POC_SUFFIX}`;

    // Synthetic feature dir so resolveFeature can target the POC run id (may stay empty).
    const pocFeatDir = join(projectDir, saifctlDir, 'features', pocFeatName);
    await mkdir(pocFeatDir, { recursive: true });

    const pocTask = await buildPocTask({
      targetFeatureName: realFeatName,
      targetFeatureAbsolutePath: feature.absolutePath,
      saifctlDir,
      pocFeatureName: pocFeatName,
      prompt,
    });

    const pocFeature = await resolveFeature({
      input: pocFeatName,
      projectDir,
      saifctlDir,
    });

    const config = await loadSaifctlConfig(saifctlDir, projectDir);

    const cliOverrides = await buildPocCliOverrides();

    const orchestratorOpts = await resolveOrchestratorOpts({
      projectDir,
      saifctlDir,
      config,
      feature: pocFeature,
      cli: cliOverrides,
      cliModelDelta: model ? { globalModel: model } : undefined,
      artifact: null,
      engineCli: undefined,
    });

    orchestratorOpts.reviewerEnabled = false;
    orchestratorOpts.maxRuns = 1;
    orchestratorOpts.resolveAmbiguity = 'off';
    orchestratorOpts.taskPromptOverride = pocTask;

    consola.log(`\n[poc-designer] Starting POC run for feature: ${realFeatName}`);
    consola.log(`[poc-designer] POC run name: ${pocFeatName}`);

    const result = await runStart({
      ...orchestratorOpts,
      fromArtifact: null,
    });

    consola.log(`\n[poc-designer] POC run finished (status: ${result.status})`);

    const diff = await extractSaifctlFeaturesApplyDiffString({
      result,
      orchestratorOpts,
      saifctlDir,
      projectDir,
      pocFeatName,
    });
    if (!diff) return;

    await applySaifctlFeaturesPatchToHost({
      diff,
      projectDir,
      runId: result.runId!,
      saifctlDir,
      pocFeatName,
    });
  },
};

interface ExtractSaifctlFeaturesOpts {
  result: Awaited<ReturnType<typeof runStart>>;
  orchestratorOpts: Awaited<ReturnType<typeof resolveOrchestratorOpts>>;
  saifctlDir: string;
  projectDir: string;
  /** e.g. `my-feature-poc` — paths under `features/<this>/` are not applied to host. */
  pocFeatName: string;
}

/**
 * Loads the POC run artifact and returns the filtered unified diff to apply on the host
 * (`{saifctlDir}/features/` minus `{saifctlDir}/features/<feat>-poc/`). See
 * {@link filterSaifctlFeaturesForHostApply}.
 */
async function extractSaifctlFeaturesApplyDiffString(
  opts: ExtractSaifctlFeaturesOpts,
): Promise<string | null> {
  const { result, orchestratorOpts, saifctlDir, pocFeatName } = opts;

  const runId = result.runId;
  const runStorage = orchestratorOpts.runStorage;

  if (!runId || !runStorage) {
    throw new Error(
      '[poc-designer] No run ID or run storage available — cannot extract saifctl changes.',
    );
  }

  const artifact = await runStorage.getRun(runId);
  if (!artifact || artifact.runCommits.length === 0) {
    consola.warn('[poc-designer] POC run produced no commits — nothing to extract.');
    return null;
  }

  const fullDiff = artifact.runCommits.map((c) => c.diff).join('\n');

  const featuresPrefix = `${saifctlDir}/features/`;
  const pocFeatPrefix = `${featuresPrefix}${pocFeatName}/`;
  const saifctlFeaturesDiff = filterSaifctlFeaturesForHostApply({
    patch: fullDiff,
    includePrefix: featuresPrefix,
    excludePrefix: pocFeatPrefix,
  });

  if (!saifctlFeaturesDiff.trim()) {
    consola.warn(
      `[poc-designer] No applicable changes under ${featuresPrefix} (excluding ${pocFeatPrefix}) — ` +
        `did the agent write specification.md / plan.md under the real feature dir?`,
    );
    return null;
  }

  return saifctlFeaturesDiff;
}

interface ApplySaifctlFeaturesPatchOnHostOpts {
  diff: string;
  projectDir: string;
  runId: string;
  saifctlDir: string;
  pocFeatName: string;
}

/** Writes the patch to a temp file, runs `git apply`, then removes the file (best-effort). */
async function applySaifctlFeaturesPatchToHost(
  opts: ApplySaifctlFeaturesPatchOnHostOpts,
): Promise<void> {
  const { diff, projectDir, runId, saifctlDir, pocFeatName } = opts;

  const featuresPrefix = `${saifctlDir}/features/`;
  const pocFeatPrefix = `${featuresPrefix}${pocFeatName}/`;

  const patchPath = join(projectDir, `.saifctl-poc-${runId}.patch`);
  try {
    const normalized = diff.endsWith('\n') ? diff : `${diff}\n`;
    await writeUtf8(patchPath, normalized);

    consola.log(
      `[poc-designer] Applying changes under ${featuresPrefix} (excluding ${pocFeatPrefix}) to host.`,
    );

    await git({
      cwd: projectDir,
      args: ['apply', '--allow-empty', patchPath],
    });

    consola.log(`[poc-designer] ${featuresPrefix} updated from POC run.`);
  } catch (err) {
    consola.error('[poc-designer] Failed to apply saifctl/features patch to host:', err);
    consola.warn(`[poc-designer] Raw patch written to: ${patchPath} — apply manually.`);
    return;
  }

  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(patchPath);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SaifctlApplyFilterOpts {
  patch: string;
  /** Repo-relative prefix to keep (e.g. `saifctl/features/`). */
  includePrefix: string;
  /** Repo-relative prefix to drop entirely (e.g. `saifctl/features/my-feat-poc/`). */
  excludePrefix: string;
}

/**
 * Keeps unified-diff file sections that touch `includePrefix` but should be applied on
 * the host, excluding anything under `excludePrefix` only.
 *
 * Handles normal edits, **new files** (`diff --git a/dev/null b/<path>`), **deletions**
 * (`diff --git a/<path> b/dev/null`), and renames/modes that use the standard
 * `diff --git a/<one> b/<two>` header by inspecting both paths. Sections with no
 * parseable `diff --git` line are preserved only when they are preamble text before
 * the first file (rare); otherwise skipped.
 */
function filterSaifctlFeaturesForHostApply(opts: SaifctlApplyFilterOpts): string {
  const { patch, includePrefix, excludePrefix } = opts;
  const sections = patch.split(/(?=^diff --git )/m);
  const kept: string[] = [];

  for (const section of sections) {
    const headerLine = section.split('\n')[0] ?? '';
    if (!headerLine.startsWith('diff --git ')) {
      if (section.trim()) kept.push(section);
      continue;
    }
    if (sectionTouchesSaifctlFeaturesForApply({ line: headerLine, includePrefix, excludePrefix })) {
      kept.push(section);
    }
  }

  return kept.join('');
}

/**
 * True when at least one non–`/dev/null` path in the `diff --git` header lies under
 * `includePrefix` and outside `excludePrefix`.
 */
function sectionTouchesSaifctlFeaturesForApply(spec: {
  line: string;
  includePrefix: string;
  excludePrefix: string;
}): boolean {
  const paths = parseDiffGitHeaderPaths(spec.line);
  if (paths.length === 0) return false;

  for (const p of paths) {
    if (!p.startsWith(spec.includePrefix)) continue;
    if (p.startsWith(spec.excludePrefix)) continue;
    return true;
  }
  return false;
}

/** Paths from a single `diff --git ...` line (both sides when present). */
function parseDiffGitHeaderPaths(line: string): string[] {
  const trimmed = line.trim();
  const newFile = /^diff --git a\/dev\/null b\/(.+)$/.exec(trimmed);
  if (newFile) return [newFile[1]];

  const deleted = /^diff --git a\/(.+?) b\/dev\/null$/.exec(trimmed);
  if (deleted) return [deleted[1]];

  const ab = /^diff --git a\/(.+?) b\/(.+)$/.exec(trimmed);
  if (ab) {
    const [, aPath, bPath] = ab;
    if (aPath === 'dev/null' && bPath !== 'dev/null') return [bPath];
    if (bPath === 'dev/null' && aPath !== 'dev/null') return [aPath];
    if (aPath !== 'dev/null' && bPath !== 'dev/null') return [aPath, bPath];
  }

  return [];
}

async function buildPocCliOverrides(): Promise<OrchestratorCliInput> {
  const saifctlRoot = getSaifctlRoot();
  const pocCedarPolicyPath = join(saifctlRoot, 'src', 'orchestrator', 'policies', 'poc.cedar');
  const pocGateScriptPath = join(saifctlRoot, 'src', 'orchestrator', 'scripts', 'poc-gate.sh');

  const gateScript = await readUtf8(pocGateScriptPath);

  return {
    cedarPolicyPath: pocCedarPolicyPath,
    cedarScript: undefined,
    gateScript,
    gateScriptFile: pocGateScriptPath,
    reviewerEnabled: false,
    maxRuns: 1,
    allowSaifctlInPatch: true,
    sandboxProfileId: undefined,
    agentProfileId: undefined,
    feature: undefined,
    projectDir: undefined,
    saifctlDir: undefined,
    sandboxBaseDir: undefined,
    projectName: undefined,
    testImage: undefined,
    resolveAmbiguity: undefined,
    testRetries: undefined,
    dangerousNoLeash: undefined,
    coderImage: undefined,
    startupScript: undefined,
    startupScriptFile: undefined,
    agentInstallScript: undefined,
    agentInstallScriptFile: undefined,
    agentScript: undefined,
    agentScriptFile: undefined,
    stageScript: undefined,
    stageScriptFile: undefined,
    testScript: undefined,
    testScriptFile: undefined,
    testProfile: undefined,
    agentEnv: undefined,
    agentSecretKeys: undefined,
    agentSecretFiles: undefined,
    gateRetries: undefined,
    includeDirty: undefined,
    push: undefined,
    pr: undefined,
    targetBranch: undefined,
    gitProvider: undefined,
    runStorage: undefined,
    stagingEnvironment: undefined,
    codingEnvironment: undefined,
    patchExclude: undefined,
    fromArtifact: undefined,
    verbose: undefined,
    llm: undefined,
    taskPromptOverride: undefined,
  };
}
