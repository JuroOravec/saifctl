/**
 * Phase → subtasks compiler.
 *
 * Reads the filesystem (`feature.yml`, per-phase `phase.yml`, `phases/`,
 * `critics/`), runs Block 1's structural validator, and emits a
 * deterministic `RunSubtaskInput[]` for the existing iterative loop:
 *
 *   - 1 implementer subtask per phase (in resolved phase order)
 *   - N critic subtasks per phase per critic per round
 *
 * Each emitted subtask declares `testScope.include = [<phase>/tests/]` with
 * `cumulative: true`; Block 2's loop-side resolver chains them into the
 * cumulative gate per §9. The **last** phase additionally includes
 * `<feature>/tests/` and `<saifctlDir>/tests/`, so end-state contracts gate
 * only at the end of the run (the mongo→postgres rationale in §9 / Block 2).
 *
 * **Block 4 (critic prompt rendering, mustache):** every emitted subtask
 * carries `phaseId`. Critic subtasks additionally carry `criticPrompt`
 * metadata (critic id, round, total rounds, and the closed mustache var set
 * minus `phase.baseRef`). Critic `content` is the raw `critics/<id>.md`
 * body — the loop captures `phase.baseRef` when the phase's impl subtask
 * starts and renders the body via `renderCriticPrompt` just before the
 * critic subtask becomes the active row. The compile-time output stays
 * config-faithful (raw body), runtime output is rendered.
 *
 * Paths emitted in prompts are **container-side** (under `/workspace`), since
 * the agent runs inside Docker with the repo bind-mounted at `/workspace` (see
 * `engines/docker/index.ts`). Host-absolute paths from `feature.absolutePath`
 * are translated via `relative(projectDir, …)` before being put in the prompt.
 */

import { join, relative } from 'node:path';

import {
  resolveAgentInstallScriptPath,
  SUPPORTED_AGENT_PROFILE_IDS,
  type SupportedAgentProfileId,
} from '../../agent-profiles/index.js';
import {
  isSupportedAgentName,
  type LlmOverrides,
  SUPPORTED_AGENT_NAMES,
} from '../../llm-config.js';
import {
  detectLevel2Transition,
  detectLevel3Transition,
} from '../../orchestrator/phase-transition.js';
import type { RunSubtaskInput, RunSubtaskTestScope } from '../../runs/types.js';
import {
  SUPPORTED_SANDBOX_PROFILE_IDS,
  type SupportedSandboxProfileId,
} from '../../sandbox-profiles/types.js';
import { readUtf8 } from '../../utils/io.js';
import { BUILTIN_FIX_TEMPLATE } from './critic-prompt.js';
import { type DiscoveredCritic, effectivePhaseOrder, type ValidationReport } from './discover.js';
import { type ResolvedAgentConfig, type ResolvedPhaseConfig, resolvePhaseConfig } from './load.js';
import type { CriticEntry } from './schema.js';
import {
  resolveAndReadScript,
  ScriptNotARegularFileError,
  ScriptNotFoundError,
  ScriptOutsideProjectError,
} from './script-resolver.js';
import { validatePhasedFeature } from './validate.js';

/**
 * Type-narrow check for `agent.profile` against the bundled-profile set
 * (review F-D). The schema only constrains the field to a non-empty string
 * (so users can future-proof for not-yet-bundled profiles); the compiler
 * narrows it here to gate the agent-install-script default lookup.
 */
function isSupportedAgentProfileId(id: string): id is SupportedAgentProfileId {
  return (SUPPORTED_AGENT_PROFILE_IDS as readonly string[]).includes(id);
}

/**
 * Type-narrow check for `container.sandbox-profile` against the bundled
 * sandbox-profile set (review M5). Mirrors {@link isSupportedAgentProfileId}.
 * Used by `resolvePhaseLevel3Overrides` to fail compile on unknown ids
 * rather than letting the bad value reach 7.5e's runtime restart code.
 */
function isSupportedSandboxProfileId(id: string): id is SupportedSandboxProfileId {
  return (SUPPORTED_SANDBOX_PROFILE_IDS as readonly string[]).includes(id);
}

/**
 * Allowed character set for a docker image tag. Matches the regex used by
 * the run-level `validateImageTag` (which `process.exit`s on mismatch and
 * therefore can't throw); compile-time uses this directly so a bad
 * `runner.test-image` value fails compile with a `PhaseCompileError`
 * instead of killing the process. See per-phase-config phase 7.3 review F-C.
 */
const IMAGE_TAG_REGEX = /^[a-zA-Z0-9_.\-:/@]+$/;

/** Inputs to {@link compilePhasesToSubtasks}: the feature on disk plus paths and scripts needed to render prompts. */
export interface CompilePhasesOptions {
  /** Absolute path to the feature dir. */
  featureAbsolutePath: string;
  /** Display name for prompt content + error messages. */
  featureName: string;
  /** Saifctl dir name (e.g. 'saifctl') — used for project-level tests path + prompt boilerplate. */
  saifctlDir: string;
  /** Absolute project root — used to compute project-level tests path for the last phase. */
  projectDir: string;
  /** Run-level gate script content; threaded onto every emitted subtask for manifest parity. */
  gateScript: string;
  /**
   * Run-level agent script content; threaded onto every emitted subtask as
   * the fallback when no per-phase `agent.script` override applies.
   *
   * Required so the runtime never has to "leave agent.sh unchanged" between
   * subtasks — every subtask carries an explicit value, which means
   * transitioning out of a phase override correctly restores the run-level
   * script. See per-phase-config phase 7.2.
   */
  agentScript: string;
  /**
   * Run-level stage script content; threaded onto every emitted subtask as
   * the fallback when no per-phase `runner.stage-script` override applies.
   *
   * Required for the same reason as `agentScript`: the staging container
   * reads `<sandbox>/saifctl/stage.sh` from the bind-mount fresh every
   * `runStagingTestVerification` call, and that call fires per subtask
   * (not per outer attempt). A subtask following an overriding phase
   * MUST carry an explicit value (override-or-run-level) — otherwise
   * the previous phase's override leaks into the next phase's staging.
   * See per-phase-config phase 7.3.
   */
  stageScript: string;
  /**
   * Run-level Level-2 baseline (per-phase-config phase 7.5). Same
   * always-emit / idempotency rule as `gateScript` / `agentScript` /
   * `stageScript` above: every subtask carries the fully resolved Level-2
   * value (override OR run-level fallback), so 7.5e's per-attempt opts
   * derivation can read these without the previous phase's override
   * leaking across the boundary.
   *
   * `agentInstallScript` is the bytes of the agent's install script; when a
   * phase declares only `agent.profile` (no explicit `agent.install`), the
   * compiler resolves the profile's bundled install script at compile
   * time (see review F-D / 7.5 spec.md "resolves agent-profile defaults").
   *
   * Optional only because callers that don't have a coder container in
   * scope (`feat phases compile` preview, some integration tests) can omit
   * the run-level baseline; in that case the compiler emits whatever the
   * phase declares (or `undefined` when nothing is declared) and skips
   * the always-emit invariant for those fields. The runtime call site
   * (`resolveSubtasks` → `runStart`) MUST supply these.
   */
  runLevelLevel2Baseline?: RunLevelLevel2Baseline;
  /**
   * Run-level Level-3 baseline (per-phase-config phase 7.5b — level-3-mirror).
   * Same always-emit / idempotency rule as the Level-2 baseline above. The
   * Level-3 fields are bound at coder-container creation AND require an image
   * pull / engine swap / compose-stack swap on top of the Level-2 restart, so
   * the runtime side (phase 7.5e) needs the fully-resolved values per subtask
   * to drive the controlled teardown.
   *
   * Optional for the same reason as the Level-2 baseline: `feat phases
   * compile` preview paths don't have a run-level baseline in scope.
   */
  runLevelLevel3Baseline?: RunLevelLevel3Baseline;
}

/**
 * Run-level Level-2 fallback values. Used by the phase compiler to emit
 * fully resolved values on every subtask. Sourced from the same picks the
 * orchestrator uses to build its run-level defaults (`pickAgentProfile`,
 * `pickStartupScript`, `loadAgentScriptsFromPicks`, etc.).
 */
export interface RunLevelLevel2Baseline {
  agentProfileId: string;
  agentInstallScript: string;
  startupScript: string;
  cedarScript: string;
  dangerousNoLeash: boolean;
}

/**
 * Run-level Level-3 fallback values (per-phase-config phase 7.5b — level-3-mirror).
 * Used by the phase compiler to emit fully resolved Level-3 values on
 * every subtask, mirroring {@link RunLevelLevel2Baseline}. Sourced from
 * `pickSandboxProfile`, `resolveCoderImage`, and `config.environments.coding`.
 *
 * `containerComposeFile` is `undefined` when the run uses an engine
 * other than `docker`, or when `environments.coding.file` is omitted —
 * the compiler still emits it as `undefined` on every subtask so a
 * phase that DOES declare a compose file shows up in the transition diff.
 */
export interface RunLevelLevel3Baseline {
  containerImage: string;
  containerSandboxProfileId: string;
  containerEngine: 'docker' | 'helm' | 'local';
  containerComposeFile: string | undefined;
}

/**
 * Compile a phased feature into deterministic subtasks.
 *
 * Throws {@link PhaseCompileError} when structural validation fails (typo'd
 * critic id, unknown phase in `feature.yml.phases.order`, etc.). The error
 * message is human-readable and prefixed with `[feature '<name>']`.
 */
export async function compilePhasesToSubtasks(
  opts: CompilePhasesOptions,
): Promise<RunSubtaskInput[]> {
  const {
    featureAbsolutePath,
    featureName,
    saifctlDir,
    projectDir,
    gateScript,
    agentScript,
    stageScript,
    runLevelLevel2Baseline,
    runLevelLevel3Baseline,
  } = opts;

  // --- Load + discover + validate. -----------------------------------------
  // Block 6 unifies validation behind `validatePhasedFeature` so the same
  // checks run for `feat phases compile`, `feat phases validate`, and the
  // `feat run` pre-flight. On any error we throw `PhaseCompileError` with the
  // full report; on success the loaded context is reused below so we don't
  // re-stat the filesystem.
  const { report, context } = await validatePhasedFeature({
    featureAbsolutePath,
    projectDir,
  });
  if (report.errors.length > 0) {
    throw new PhaseCompileError(featureName, report);
  }
  // context is guaranteed non-null when errors.length === 0.
  const { featureConfig, phases, critics, phaseConfigs } = context!;

  // --- Effective order. -----------------------------------------------------
  const order = effectivePhaseOrder({ featureConfig, discoveredPhases: phases });
  if (order.length === 0) {
    throw new PhaseCompileError(featureName, {
      errors: [`[feature '${featureName}'] phases/ exists but contains no valid phase directories`],
      warnings: [],
    });
  }

  // --- Compile. -------------------------------------------------------------
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const criticsById = new Map(critics.map((c) => [c.id, c]));

  // Workspace-relative feature dir (e.g. 'saifctl/features/auth'). The agent
  // runs in a container with `/workspace` mounted to the host project; raw
  // host-absolute paths from `feature.absolutePath` would not resolve there.
  const featureWorkspaceDir = relative(projectDir, featureAbsolutePath);
  const featurePlanWorkspacePath = workspacePath(featureWorkspaceDir, 'plan.md');

  // Read each referenced critic body exactly once (not once per phase). The
  // raw body is identical across rounds — every per-round difference (round
  // counter, findingsPath, baseRef) lives in `criticPrompt.vars` / runtime
  // state and is woven in by the loop's mustache renderer.
  const criticBodies = new Map<string, string>();

  const out: RunSubtaskInput[] = [];
  const lastPhaseId = order[order.length - 1]!;

  // per-phase-config phase 7.5: track the previous phase's resolved
  // Level-2 fields so we can compute `requiresLevel2RestartFromPrev`
  // for the current phase. `null` on the first iteration (no prior
  // phase to compare against — first subtask of a run never carries
  // the flag; the run's standard coder-container creation reads the
  // active subtask's Level-2 config directly).
  let prevPhaseLevel2: PhaseLevel2Resolved | null = null;
  // per-phase-config phase 7.5b (level-3-mirror): same shape, parallel
  // for Level-3. Tracked separately from Level-2 so the cost class on
  // the `requiresLevelXRestartFromPrev` flags survives — phase 7.5e's
  // runtime branches on Level-2 (script refresh, seconds) vs Level-3
  // (image pull / stack swap, potentially minutes).
  let prevPhaseLevel3: PhaseLevel3Resolved | null = null;

  for (const phaseId of order) {
    const phase = phaseById.get(phaseId)!;
    const config = resolvePhaseConfig({
      phaseId,
      phaseConfig: phaseConfigs.get(phaseId) ?? null,
      featureConfig,
    });

    const isLast = phaseId === lastPhaseId;
    const noPhaseTests = config.tests.none === true;
    const testScope = buildPhaseTestScope({
      phaseAbsolutePath: phase.absolutePath,
      featureAbsolutePath,
      projectDir,
      saifctlDir,
      isLast,
      noPhaseTests,
    });

    const phaseRelativeDir = `${featureWorkspaceDir}/phases/${phaseId}`;
    const phaseWorkspaceDir = workspacePath(phaseRelativeDir);
    const specWorkspacePath = workspacePath(phaseRelativeDir, config.spec);
    const testsWorkspacePath = workspacePath(phaseRelativeDir, 'tests');

    // Per-phase Level-1 overrides (per-phase-config phase 7.2). When the
    // resolved phase config sets `gate.script` / `agent.script` (relative
    // paths), read the file content via the script-resolver and emit it
    // on every subtask of this phase. Falls back to the run-level
    // `gateScript` / `agentScript` content from `opts` when the phase has
    // no override.
    //
    // Both scripts are ALWAYS set on every emitted subtask (no conditional
    // spread). Reason: the runtime's per-subtask sandbox-script writer
    // overwrites whichever fields it receives; if we left `agentScript`
    // undefined for a non-overriding phase that follows an overriding one,
    // the previous phase's `agent.sh` would persist. Carrying the
    // run-level fallback explicitly makes every transition idempotent.
    const overrides = await resolvePhaseLevel1Overrides({
      config,
      phaseAbsolutePath: phase.absolutePath,
      featureAbsolutePath,
      projectDir,
      featureName,
      phaseId,
    });
    const phaseGateScript = overrides.gateScriptContent ?? gateScript;
    const phaseAgentScript = overrides.agentScriptContent ?? agentScript;
    const phaseGateRetries = config.gate.retries;

    // Per-phase Level-4 overrides (per-phase-config phase 7.3). The test
    // runner is recreated each outer attempt; per-phase is just routing.
    // Compile-time read for `runner.test-script` / `runner.stage-script`
    // (file content); the YAML field path is `runner.test-script` (a
    // relative file path) but the manifest field name is `testScript`
    // (the file's bytes). The helper does the path → body transformation
    // and validates `runner.test-image` against the same docker-tag rule
    // the run-level `--test-image` uses.
    //
    // `stageScript` is ALWAYS set on every emitted subtask (no conditional
    // spread). Same rationale as `gateScript` / `agentScript` above: the
    // staging container reads `<sandbox>/saifctl/stage.sh` from the
    // bind-mount fresh each `runStagingTestVerification` call (per
    // subtask), so a non-overriding subtask following an overriding one
    // MUST carry the run-level fallback explicitly. Otherwise the
    // previous phase's override leaks into the next phase's staging.
    const runner = await resolvePhaseLevel4Overrides({
      config,
      phaseAbsolutePath: phase.absolutePath,
      featureAbsolutePath,
      projectDir,
      featureName,
      phaseId,
    });
    const phaseStageScript = runner.stageScriptContent ?? stageScript;
    const phaseRunnerOverrides: Pick<
      RunSubtaskInput,
      'testProfile' | 'testImage' | 'testScript' | 'resolveAmbiguity' | 'testRetries' | 'noRunner'
    > = {
      ...(runner.testProfile !== undefined ? { testProfile: runner.testProfile } : {}),
      ...(runner.testImage !== undefined ? { testImage: runner.testImage } : {}),
      ...(runner.testScriptContent !== undefined ? { testScript: runner.testScriptContent } : {}),
      ...(runner.resolveAmbiguity !== undefined
        ? { resolveAmbiguity: runner.resolveAmbiguity }
        : {}),
      ...(runner.testRetries !== undefined ? { testRetries: runner.testRetries } : {}),
      ...(noPhaseTests ? { noRunner: true } : {}),
    };

    // Per-phase Level-1.5 overrides (per-phase-config phase 7.4). The
    // resolved values land on the subtask manifest; at runtime, the loop
    // merges them with the run-level baseline and writes the result to
    // `<saifctlPath>/subtask-env.sh`, which `coder-start.sh` sources on
    // every inner round (no container restart). Conditional spread —
    // unset fields stay off the manifest so they don't shadow the
    // run-level container env.
    const phaseLevel1_5Overrides = buildPhaseLevel1_5Overrides({
      agent: config.agent,
      featureName,
      phaseId,
    });

    // Per-phase Level-2 overrides (per-phase-config phase 7.5 first half).
    // These values bind at coder-container creation; switching them
    // between phases would trigger a controlled coder-container restart
    // at the boundary. The runtime restart machinery is **deferred to
    // 7.5e** — until then, `validate.ts:checkLevel2TransitionGate` errors
    // out when `requiresLevel2RestartFromPrev` would fire, so the loop
    // never actually reads this flag in this release. The compiler still
    // resolves and emits the per-subtask values on every subtask:
    //
    //  - Always-emit (override OR run-level fallback), matching the
    //    7.2 / 7.3 / 7.4 idempotency rule. Reason: when 7.5e lands the
    //    per-attempt opts derivation, every subtask must carry the
    //    fully resolved value, so transitioning out of an overriding
    //    phase doesn't silently inherit the prior phase's value.
    //  - When a phase declares only `agent.profile` (no explicit
    //    `agent.install`), we resolve the profile's bundled install
    //    script here so the manifest is self-contained — see review
    //    F-D and the 7.5 spec.md "resolves agent-profile defaults"
    //    requirement.
    //
    // The transition flag is computed below by comparing each phase's
    // fully-resolved Level-2 set with the previous phase's. `prevPhaseLevel2`
    // tracks the prior phase's resolved values (not the override delta) so
    // the diff can't false-positive on "phase A explicit / phase B silent
    // (same fallback)" — both resolve to the same value, so no diff fires.
    const phaseLevel2Resolved = await resolvePhaseLevel2Overrides({
      config,
      phaseAbsolutePath: phase.absolutePath,
      featureAbsolutePath,
      projectDir,
      featureName,
      phaseId,
      runLevelBaseline: runLevelLevel2Baseline,
    });
    // per-phase-config phase 7.5b (level-3-mirror): parallel Level-3
    // resolution. No script-content reading (Level-3 fields are
    // identifiers / paths, not file contents), so this resolver is
    // synchronous — to mirror the Level-2 surface the call site looks
    // identical though. The run-level baseline already carries
    // `featureConfig` top-level / `phases.defaults` declarations
    // (closed by 7.5b's bundled-with-7.5b options.ts threading;
    // see design.md §7.5 / §7.5b checklist).
    const phaseLevel3Resolved = resolvePhaseLevel3Overrides({
      config,
      featureName,
      phaseId,
      runLevelBaseline: runLevelLevel3Baseline,
    });
    // The flag rides on the phase's FIRST subtask only (impl). Critic
    // subtasks share the phase's Level-2 config — they don't need a
    // transition mid-phase. The runtime (once 7.5e lands) will check the
    // flag at the subtask boundary, so it fires once when activating phase
    // B's impl after phase A's last subtask.
    //
    // The diff compares fully-resolved values (override OR run-level
    // fallback), not override-deltas — review F-C / F-D. So a phase
    // declaring `agent.profile: claude` against a run-level baseline of
    // `claude` correctly produces no diff (phase declaration was
    // redundant).
    const requiresLevel2Restart =
      prevPhaseLevel2 !== null && level2DiffersAcrossPhases(prevPhaseLevel2, phaseLevel2Resolved);
    const phaseLevel2OnImpl: Pick<
      RunSubtaskInput,
      | 'agentProfileId'
      | 'agentInstallScript'
      | 'startupScript'
      | 'cedarScript'
      | 'dangerousNoLeash'
      | 'requiresLevel2RestartFromPrev'
    > = {
      ...phaseLevel2Resolved,
      ...(requiresLevel2Restart ? { requiresLevel2RestartFromPrev: true } : {}),
    };
    // Critic subtasks carry only the resolved Level-2 config (no flag).
    const phaseLevel2OnCritics: Pick<
      RunSubtaskInput,
      'agentProfileId' | 'agentInstallScript' | 'startupScript' | 'cedarScript' | 'dangerousNoLeash'
    > = phaseLevel2Resolved;
    // per-phase-config phase 7.5b (level-3-mirror): same shape,
    // parallel for Level-3. The flag is computed independently from
    // Level-2 — a phase change can require a Level-2 restart, a
    // Level-3 restart, or both.
    const requiresLevel3Restart =
      prevPhaseLevel3 !== null && level3DiffersAcrossPhases(prevPhaseLevel3, phaseLevel3Resolved);
    const phaseLevel3OnImpl: Pick<
      RunSubtaskInput,
      | 'containerImage'
      | 'containerSandboxProfileId'
      | 'containerEngine'
      | 'containerComposeFile'
      | 'requiresLevel3RestartFromPrev'
    > = {
      ...phaseLevel3Resolved,
      ...(requiresLevel3Restart ? { requiresLevel3RestartFromPrev: true } : {}),
    };
    const phaseLevel3OnCritics: Pick<
      RunSubtaskInput,
      'containerImage' | 'containerSandboxProfileId' | 'containerEngine' | 'containerComposeFile'
    > = phaseLevel3Resolved;

    // Per-phase-config phase 7.6 — `limits.max-attempts`. Emitted on
    // every subtask of the phase (impl + critic rounds) so the loop's
    // per-phase-budget check in `onSubtaskComplete` reads the same cap
    // regardless of which subtask is active. Conditional spread —
    // unset stays off the manifest.
    const phaseLimits: Pick<RunSubtaskInput, 'limits'> =
      config.limits.maxAttempts !== undefined
        ? { limits: { maxAttempts: config.limits.maxAttempts } }
        : {};

    // Implementer subtask.
    out.push({
      title: `phase:${phaseId} impl`,
      content: buildImplementerPrompt({
        featureName,
        saifctlDir,
        phaseId,
        specWorkspacePath,
        featurePlanWorkspacePath,
      }),
      gateScript: phaseGateScript,
      agentScript: phaseAgentScript,
      stageScript: phaseStageScript,
      ...(phaseGateRetries !== undefined ? { gateRetries: phaseGateRetries } : {}),
      testScope,
      phaseId,
      ...phaseRunnerOverrides,
      ...phaseLevel1_5Overrides,
      ...phaseLevel2OnImpl,
      ...phaseLevel3OnImpl,
      ...phaseLimits,
    });

    // Critics for this phase.
    const criticEntries = resolveCriticListForPhase({
      resolvedCritics: config.critics,
      discoveredCritics: critics,
    });
    for (const entry of criticEntries) {
      const critFile = criticsById.get(entry.id);
      if (!critFile) {
        // validatePhaseGraph should have caught this; defensive only.
        throw new PhaseCompileError(featureName, {
          errors: [
            `[feature '${featureName}'] phase '${phaseId}' references unknown critic '${entry.id}'`,
          ],
          warnings: [],
        });
      }
      let rawBody = criticBodies.get(entry.id);
      if (rawBody === undefined) {
        rawBody = await readUtf8(critFile.absolutePath);
        criticBodies.set(entry.id, rawBody);
      }
      const totalRounds = entry.rounds;
      const baseVars = {
        feature: {
          name: featureName,
          dir: featureWorkspaceDir,
          plan: featurePlanWorkspacePath,
        },
        phase: {
          id: phaseId,
          dir: phaseWorkspaceDir,
          spec: specWorkspacePath,
          tests: testsWorkspacePath,
        },
      };
      for (let r = 1; r <= totalRounds; r++) {
        const findingsPath = buildFindingsPath({ phaseId, criticId: entry.id, round: r });
        // Per §6: each round = (discover, fix). Discover writes findings to
        // a temp file; fix reads + applies + deletes. Both subtasks share the
        // phase's testScope. Discover's `content` is the user's
        // `critics/<id>.md` body; fix's is the saifctl-owned BUILTIN_FIX_TEMPLATE.
        // Both are mustache-rendered by the loop just before activation.
        out.push({
          title: `phase:${phaseId} critic:${entry.id} round:${r}/${totalRounds} discover`,
          content: rawBody,
          gateScript: phaseGateScript,
          agentScript: phaseAgentScript,
          stageScript: phaseStageScript,
          ...(phaseGateRetries !== undefined ? { gateRetries: phaseGateRetries } : {}),
          testScope,
          phaseId,
          ...phaseRunnerOverrides,
          ...phaseLevel1_5Overrides,
          ...phaseLevel2OnCritics,
          ...phaseLevel3OnCritics,
          ...phaseLimits,
          criticPrompt: {
            criticId: entry.id,
            round: r,
            totalRounds,
            step: 'discover',
            findingsPath,
            vars: baseVars,
          },
        });
        out.push({
          title: `phase:${phaseId} critic:${entry.id} round:${r}/${totalRounds} fix`,
          content: BUILTIN_FIX_TEMPLATE,
          gateScript: phaseGateScript,
          agentScript: phaseAgentScript,
          stageScript: phaseStageScript,
          ...(phaseGateRetries !== undefined ? { gateRetries: phaseGateRetries } : {}),
          testScope,
          phaseId,
          ...phaseRunnerOverrides,
          ...phaseLevel1_5Overrides,
          ...phaseLevel2OnCritics,
          ...phaseLevel3OnCritics,
          ...phaseLimits,
          criticPrompt: {
            criticId: entry.id,
            round: r,
            totalRounds,
            step: 'fix',
            findingsPath,
            vars: baseVars,
          },
        });
      }
    }

    // Track for the next iteration's `requiresLevel2RestartFromPrev`
    // computation. We track the FULLY-RESOLVED set (override OR
    // run-level fallback) — not the override delta — so the next
    // phase's diff-detection answers "do these phases run with the
    // same effective Level-2 config?" rather than "did each phase
    // happen to declare the same fields?".
    prevPhaseLevel2 = phaseLevel2Resolved;
    // Same shape, parallel for Level-3 (per-phase-config phase 7.5b
    // — level-3-mirror).
    prevPhaseLevel3 = phaseLevel3Resolved;
  }

  return out;
}

/**
 * Build a `/workspace`-rooted absolute path from path segments that are
 * already workspace-relative. Joins with `posix` slashes regardless of host —
 * the path is consumed inside a Linux container, not on the host.
 */
function workspacePath(...segments: string[]): string {
  // node:path's posix `join` is the right primitive but adds an import burden;
  // since we control all callers and pass already-clean segments, a manual
  // join keeps the surface tight. Strip leading/trailing `/` from segments
  // so accidentally absolute pieces don't break the prefix.
  const cleaned = segments.flatMap((s) => s.split(/[\\/]+/).filter(Boolean));
  return `/workspace/${cleaned.join('/')}`;
}

/**
 * Container-side path for a critic round's findings file. Pinned per
 * (phase, critic, round) so re-runs (resume / retry) write and read the
 * same path deterministically. Lives in the workspace `.saifctl/` dir
 * (where `task.md` already lives) — distinct from the project's `saifctl/`
 * config dir.
 */
function buildFindingsPath(opts: { phaseId: string; criticId: string; round: number }): string {
  return `/workspace/.saifctl/critic-findings/${opts.phaseId}--${opts.criticId}--r${opts.round}.md`;
}

/**
 * Resolve a phase's effective critic list per §5.4 / §9.
 *
 * - `null` (sentinel from `resolvePhaseConfig` meaning "not declared at any
 *   layer") ⇒ run all discovered critics, alphabetical, `rounds: 1` each.
 * - `[]` ⇒ run no critics for this phase.
 * - non-empty array ⇒ run those critics in declared order.
 */
export function resolveCriticListForPhase(opts: {
  resolvedCritics: CriticEntry[] | null;
  discoveredCritics: DiscoveredCritic[];
}): CriticEntry[] {
  if (opts.resolvedCritics === null) {
    return opts.discoveredCritics.map((c) => ({ id: c.id, rounds: 1 }));
  }
  return opts.resolvedCritics;
}

/**
 * Per-phase-config 7.6 review N4: count the subtasks a phase will emit
 * given its resolved critic list. One impl + two subtasks per critic
 * round (discover + fix). Used by the validator to surface a "tight
 * budget" info when `limits.max-attempts` is smaller than the minimum
 * possible attempts (i.e., every subtask succeeds first try).
 */
export function countPhaseSubtasks(opts: {
  resolvedCritics: CriticEntry[] | null;
  discoveredCritics: DiscoveredCritic[];
}): number {
  const critics = resolveCriticListForPhase(opts);
  let total = 1; // impl
  for (const c of critics) total += c.rounds * 2;
  return total;
}

/**
 * Build the cumulative `testScope.include` list for one phase.
 *
 * Always includes the phase's own `tests/` dir UNLESS the phase declares
 * `tests.none: true` (per-phase-config phase 7.3 / design §6.5(b) —
 * "this phase has no own tests"). The **last** phase in the run also
 * includes `<feature>/tests/` and `<saifctlDir>/tests/` so feature-level
 * and project-level tests gate only at the terminal state. Earlier phases
 * never include them — those tests describe end-state contracts that cannot
 * pass mid-migration (mongo→postgres rationale in §9).
 *
 * Paths that don't exist on disk are still emitted; Block 2's
 * `synthesizeMergedTestsDir` silently skips missing source dirs, so the
 * compiled output is forward-compatible with Block 7's project-level tests
 * convention even before that block lands.
 */
function buildPhaseTestScope(opts: {
  phaseAbsolutePath: string;
  featureAbsolutePath: string;
  projectDir: string;
  saifctlDir: string;
  isLast: boolean;
  /** When `true`, drop the phase's own `tests/` from the include list. */
  noPhaseTests?: boolean;
}): RunSubtaskTestScope {
  const include: string[] = [];
  if (!opts.noPhaseTests) {
    include.push(join(opts.phaseAbsolutePath, 'tests'));
  }
  if (opts.isLast) {
    include.push(join(opts.featureAbsolutePath, 'tests'));
    include.push(join(opts.projectDir, opts.saifctlDir, 'tests'));
  }
  return { include, cumulative: true };
}

/**
 * Implementer prompt — link-only (consistent with Block 5). Tells the agent
 * which phase to implement, points at the spec + plan, and reminds it not to
 * touch saifctl/ or immutable test paths. Spec/plan paths are container-side
 * (`/workspace/...`) so they resolve from the agent's cwd inside Docker.
 */
function buildImplementerPrompt(opts: {
  featureName: string;
  saifctlDir: string;
  phaseId: string;
  specWorkspacePath: string;
  featurePlanWorkspacePath: string;
}): string {
  const { featureName, saifctlDir, phaseId, specWorkspacePath, featurePlanWorkspacePath } = opts;
  return [
    `Implement phase '${phaseId}' of feature '${featureName}'.`,
    '',
    `The spec for this phase is at \`${specWorkspacePath}\`. You MUST read it before making any changes.`,
    `The broader plan for this feature is at \`${featurePlanWorkspacePath}\`. Read it for context — it describes how this phase fits into the overall feature.`,
    '',
    `Write code in the /workspace directory. Within /${saifctlDir}/, you may modify ONLY this feature's plan (\`${featurePlanWorkspacePath}\`) and this phase's spec (\`${specWorkspacePath}\`) — and only when your implementation deviates from them, in which case update them to match what you actually built. Do NOT modify any other file under /${saifctlDir}/, and do NOT modify any immutable test paths.`,
    'When complete, ensure the code compiles and passes linting.',
  ].join('\n');
}

/**
 * Thrown when phase compilation fails structural validation. Wraps a
 * {@link ValidationReport} so callers (CLI, tests) can inspect each error
 * individually instead of parsing a string.
 */
export class PhaseCompileError extends Error {
  override readonly name = 'PhaseCompileError';
  readonly featureName: string;
  readonly report: ValidationReport;
  constructor(featureName: string, report: ValidationReport) {
    super(`Phase compilation failed for feature '${featureName}':\n${report.errors.join('\n')}`);
    this.featureName = featureName;
    this.report = report;
  }
}

/**
 * Read the Level-1 per-phase script overrides (per-phase-config phase 7.2).
 *
 * - `gate.script` → reads file, returns content for `RunSubtaskInput.gateScript`.
 * - `agent.script` → reads file, returns content for `RunSubtaskInput.agentScript`.
 *
 * Both fall back to `undefined` when the phase has no override; the caller
 * decides which run-level fallback to apply. Path resolution per design §4.3
 * (phase dir → feature dir → project root); resolver throws typed errors
 * we re-wrap as {@link PhaseCompileError} so callers see one consistent type.
 *
 * `gate.retries` is not handled here — it's a number, not a path, and is
 * threaded directly from the resolved config in the caller.
 */
async function resolvePhaseLevel1Overrides(opts: {
  config: ResolvedPhaseConfig;
  phaseAbsolutePath: string;
  featureAbsolutePath: string;
  projectDir: string;
  featureName: string;
  phaseId: string;
}): Promise<{ gateScriptContent?: string; agentScriptContent?: string }> {
  const out: { gateScriptContent?: string; agentScriptContent?: string } = {};
  const ctx = {
    phaseAbsolutePath: opts.phaseAbsolutePath,
    featureAbsolutePath: opts.featureAbsolutePath,
    projectDir: opts.projectDir,
    sourceLabel: `phase '${opts.phaseId}'`,
  };

  if (opts.config.gate.script !== undefined) {
    try {
      const r = await resolveAndReadScript(opts.config.gate.script, {
        ...ctx,
        fieldPath: 'gate.script',
      });
      out.gateScriptContent = r.content;
    } catch (err) {
      throw scriptResolverErrorToCompileError({
        featureName: opts.featureName,
        phaseId: opts.phaseId,
        err,
      });
    }
  }

  if (opts.config.agent.script !== undefined) {
    try {
      const r = await resolveAndReadScript(opts.config.agent.script, {
        ...ctx,
        fieldPath: 'agent.script',
      });
      out.agentScriptContent = r.content;
    } catch (err) {
      throw scriptResolverErrorToCompileError({
        featureName: opts.featureName,
        phaseId: opts.phaseId,
        err,
      });
    }
  }

  return out;
}

/**
 * Read the Level-4 per-phase runner overrides (per-phase-config phase 7.3).
 *
 * Level 4 = test-runner container, recreated per `runStagingTestVerification`
 * call (per subtask, not per outer attempt). Per-phase is just routing: the
 * active subtask's overrides flow into `prepareTestRunnerOpts` at runtime.
 *
 * Two of the fields are file paths (`runner.test-script`, `runner.stage-script`).
 * The YAML is a relative path; the manifest field is the file body. Naming
 * keeps the YAML form in `*Script*` keys on the resolved config and
 * "*Content" suffixes on this helper's intermediate output, transformed
 * into `testScript` / `stageScript` (bytes) on `RunSubtaskInput`.
 *
 * `runner.test-image` is validated here (not at runtime) via the same
 * `validateImageTag` rule as `--test-image`. A bad tag fails compile so
 * the user sees the error before the orchestrator boots.
 *
 * `tests.none` is decided by the caller (from the resolved config). It
 * lands on `RunSubtaskInput.noRunner` directly, not from this helper.
 */
async function resolvePhaseLevel4Overrides(opts: {
  config: ResolvedPhaseConfig;
  phaseAbsolutePath: string;
  featureAbsolutePath: string;
  projectDir: string;
  featureName: string;
  phaseId: string;
}): Promise<{
  testProfile?: string;
  testImage?: string;
  testScriptContent?: string;
  stageScriptContent?: string;
  resolveAmbiguity?: 'off' | 'prompt' | 'ai';
  testRetries?: number;
}> {
  const out: {
    testProfile?: string;
    testImage?: string;
    testScriptContent?: string;
    stageScriptContent?: string;
    resolveAmbiguity?: 'off' | 'prompt' | 'ai';
    testRetries?: number;
  } = {};
  const ctx = {
    phaseAbsolutePath: opts.phaseAbsolutePath,
    featureAbsolutePath: opts.featureAbsolutePath,
    projectDir: opts.projectDir,
    sourceLabel: `phase '${opts.phaseId}'`,
  };

  if (opts.config.runner.testProfile !== undefined) {
    out.testProfile = opts.config.runner.testProfile;
  }
  if (opts.config.runner.testImage !== undefined) {
    // Compile-time validation: same charset rule as the run-level
    // `validateImageTag` (which calls `process.exit` for CLI flags and
    // therefore can't throw a typed error). Inlining the regex here lets
    // us surface a clean `PhaseCompileError` attributed to the phase
    // rather than killing the process.
    if (!IMAGE_TAG_REGEX.test(opts.config.runner.testImage)) {
      throw new PhaseCompileError(opts.featureName, {
        errors: [
          `[feature '${opts.featureName}'] phase '${opts.phaseId}': Invalid \`runner.test-image\` value: "${opts.config.runner.testImage}". Image tags must contain only letters, digits, hyphens, underscores, dots, colons, slashes, and @ signs.`,
        ],
        warnings: [],
      });
    }
    out.testImage = opts.config.runner.testImage;
  }
  if (opts.config.runner.resolveAmbiguity !== undefined) {
    out.resolveAmbiguity = opts.config.runner.resolveAmbiguity;
  }
  if (opts.config.runner.testRetries !== undefined) {
    out.testRetries = opts.config.runner.testRetries;
  }

  if (opts.config.runner.testScript !== undefined) {
    try {
      const r = await resolveAndReadScript(opts.config.runner.testScript, {
        ...ctx,
        fieldPath: 'runner.test-script',
      });
      out.testScriptContent = r.content;
    } catch (err) {
      throw scriptResolverErrorToCompileError({
        featureName: opts.featureName,
        phaseId: opts.phaseId,
        err,
      });
    }
  }

  if (opts.config.runner.stageScript !== undefined) {
    try {
      const r = await resolveAndReadScript(opts.config.runner.stageScript, {
        ...ctx,
        fieldPath: 'runner.stage-script',
      });
      out.stageScriptContent = r.content;
    } catch (err) {
      throw scriptResolverErrorToCompileError({
        featureName: opts.featureName,
        phaseId: opts.phaseId,
        err,
      });
    }
  }

  return out;
}

/** Wrap a script-resolver error as a {@link PhaseCompileError} with the standard `[feature 'X']` prefix. */
function scriptResolverErrorToCompileError(opts: {
  featureName: string;
  phaseId: string;
  err: unknown;
}): PhaseCompileError {
  const { featureName, phaseId, err } = opts;
  const message =
    err instanceof ScriptNotFoundError ||
    err instanceof ScriptOutsideProjectError ||
    err instanceof ScriptNotARegularFileError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return new PhaseCompileError(featureName, {
    errors: [`[feature '${featureName}'] phase '${phaseId}': ${message}`],
    warnings: [],
  });
}

/**
 * Build the per-phase Level-1.5 manifest fragment from a resolved
 * `agent` config block (per-phase-config phase 7.4). Conditional
 * spread — fields stay off the manifest unless the phase declares an
 * override, so they don't shadow the run-level container env at
 * runtime.
 *
 * `agent.model` / `agent.base-url` accept the same shape as the
 * run-level `--model` / `--base-url` CLI flags: a single bare value
 * (`'openai/gpt-4o-mini'`) populates `llmOverrides.globalModel`, and a
 * comma-separated `agent=value` list (`'coder=foo/bar,critic=baz/qux'`)
 * populates `llmOverrides.agentModels` (or `agentBaseUrls`). Mixing
 * both forms in the same string is allowed (one global + per-agent
 * keys), matching the CLI parser. Malformed input throws a
 * {@link PhaseCompileError} attributed to the phase.
 */
function buildPhaseLevel1_5Overrides(opts: {
  agent: ResolvedAgentConfig;
  featureName: string;
  phaseId: string;
}): Pick<RunSubtaskInput, 'agentEnv' | 'agentSecretKeys' | 'reviewerEnabled' | 'llmOverrides'> {
  const { agent, featureName, phaseId } = opts;
  const out: Pick<
    RunSubtaskInput,
    'agentEnv' | 'agentSecretKeys' | 'reviewerEnabled' | 'llmOverrides'
  > = {};

  if (agent.env !== undefined && Object.keys(agent.env).length > 0) {
    out.agentEnv = { ...agent.env };
  }
  if (agent.secrets !== undefined && agent.secrets.length > 0) {
    out.agentSecretKeys = [...agent.secrets];
  }
  if (agent.reviewer !== undefined) {
    out.reviewerEnabled = agent.reviewer;
  }

  if (agent.model !== undefined || agent.baseUrl !== undefined) {
    const llm: LlmOverrides = {};
    if (agent.model !== undefined) {
      const parsed = parseLlmAgentOverride({
        raw: agent.model,
        fieldPath: 'agent.model',
        kind: 'model',
        featureName,
        phaseId,
      });
      if (parsed.global !== undefined) llm.globalModel = parsed.global;
      if (parsed.keys !== undefined) llm.agentModels = parsed.keys;
    }
    if (agent.baseUrl !== undefined) {
      const parsed = parseLlmAgentOverride({
        raw: agent.baseUrl,
        fieldPath: 'agent.base-url',
        kind: 'base-url',
        featureName,
        phaseId,
      });
      if (parsed.global !== undefined) llm.globalBaseUrl = parsed.global;
      if (parsed.keys !== undefined) llm.agentBaseUrls = parsed.keys;
    }
    out.llmOverrides = llm;
  }

  return out;
}

/**
 * Parse the run-level `--model` / `--base-url` shape for `agent.model` /
 * `agent.base-url`: a single bare global, a comma-separated list of
 * `agent=value` pairs, or one global mixed with per-agent overrides.
 *
 * Throws {@link PhaseCompileError} on:
 * - empty values after splitting
 * - unknown agent names (must be in {@link SUPPORTED_AGENT_NAMES})
 * - duplicate agent keys
 * - more than one bare global
 *
 * Reuses the per-phase compile error envelope so the user sees a clear
 * `[feature 'X'] phase 'Y':` prefix and the CLI exits cleanly without
 * `process.exit` (which `parseLlmOverridesCliDelta` calls — unsuitable
 * for compile-time use).
 */
function parseLlmAgentOverride(opts: {
  raw: string;
  fieldPath: 'agent.model' | 'agent.base-url';
  kind: 'model' | 'base-url';
  featureName: string;
  phaseId: string;
}): { global?: string; keys?: Record<string, string> } {
  const { raw, fieldPath, kind, featureName, phaseId } = opts;
  const fail = (msg: string): never => {
    throw new PhaseCompileError(featureName, {
      errors: [`[feature '${featureName}'] phase '${phaseId}': \`${fieldPath}\`: ${msg}`],
      warnings: [],
    });
  };

  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) fail(`value is empty.`);

  let global: string | undefined;
  const keys: Record<string, string> = {};
  // Match the run-level parser's "key=value if part contains '='" rule.
  // For base-url we tighten to "starts with `<word>=`" so URLs like
  // `https://x?a=b` aren't mis-parsed as key=value.
  const isKeyValue = (p: string): boolean => (kind === 'model' ? p.includes('=') : /^\w+=/.test(p));

  for (const part of parts) {
    if (isKeyValue(part)) {
      const eqIdx = part.indexOf('=');
      const key = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      if (!key) fail(`malformed entry "${part}": agent name is empty.`);
      if (!isSupportedAgentName(key)) {
        fail(`unknown agent "${key}". Supported: ${SUPPORTED_AGENT_NAMES.join(', ')}.`);
      }
      if (!value) fail(`malformed entry "${part}": ${kind} value is empty.`);
      if (key in keys) fail(`duplicate agent key "${key}".`);
      keys[key] = value;
    } else {
      if (global !== undefined) {
        fail(
          `multiple bare ${kind} values; only one global is allowed (use \`agent=value\` for per-agent).`,
        );
      }
      global = part;
    }
  }

  return {
    ...(global !== undefined ? { global } : {}),
    ...(Object.keys(keys).length > 0 ? { keys } : {}),
  };
}

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5 — Level-2 controlled coder restart helpers
// ---------------------------------------------------------------------------

/**
 * Resolved Level-2 set for one phase. Distinct from
 * `RunLevelLevel2Baseline` only by field optionality: each field is either
 * the phase's override OR the run-level baseline value (when the caller
 * supplies a baseline), or undefined (when no override and no baseline —
 * the `feat phases compile` preview path that has no coder container in
 * scope).
 *
 * The shape is the same one consumed by `phase-transition.ts`'s
 * {@link SubtaskWithLevel2Fields} so the compiler-side diff and the
 * (future) runtime-side diff use the same comparator. See review F-E.
 */
type PhaseLevel2Resolved = Pick<
  RunSubtaskInput,
  'agentProfileId' | 'agentInstallScript' | 'startupScript' | 'cedarScript' | 'dangerousNoLeash'
>;

/**
 * Read the per-phase Level-2 effective set, fully resolved against the
 * run-level baseline (review F-C — always-emit, matching the 7.2 / 7.3 /
 * 7.4 idempotency rule). Behaviour:
 *
 *  - Every field gets the phase override if present, else the baseline,
 *    else `undefined` (only when no baseline supplied — preview path).
 *  - Script-content fields (`agent.install`, `container.startup`,
 *    `container.cedar`) read from disk via the script-resolver when the
 *    phase declares an override.
 *  - **Profile-default resolution (review F-D / spec.md "resolves
 *    agent-profile defaults"):** when a phase declares only
 *    `agent.profile` (no explicit `agent.install`), we synthesize the
 *    install script by reading the bundled `agent-install.sh` for the
 *    profile. Same for the run-level baseline path (already done by
 *    `loadAgentScriptsFromPicks`), but that resolution is at a different
 *    layer; doing it here too keeps the per-phase manifest self-contained
 *    so 7.5e's runtime restart can boot the new container without
 *    re-resolving profile defaults.
 *
 * Throws {@link PhaseCompileError} on script-resolver failures (file not
 * found, outside project, not regular file) AND on unsupported profile
 * ids (the schema only requires `min(1)`; we validate against the
 * supported set here so the user sees a compile-time error rather than
 * a runtime crash).
 */
async function resolvePhaseLevel2Overrides(opts: {
  config: ResolvedPhaseConfig;
  phaseAbsolutePath: string;
  featureAbsolutePath: string;
  projectDir: string;
  featureName: string;
  phaseId: string;
  runLevelBaseline?: RunLevelLevel2Baseline;
}): Promise<PhaseLevel2Resolved> {
  const out: PhaseLevel2Resolved = {};
  const ctx = {
    phaseAbsolutePath: opts.phaseAbsolutePath,
    featureAbsolutePath: opts.featureAbsolutePath,
    projectDir: opts.projectDir,
    sourceLabel: `phase '${opts.phaseId}'`,
  };
  const baseline = opts.runLevelBaseline;

  // agent.profile — id passes through; runtime baseline used as fallback.
  if (opts.config.agent.profile !== undefined) {
    if (!isSupportedAgentProfileId(opts.config.agent.profile)) {
      throw new PhaseCompileError(opts.featureName, {
        errors: [
          `[feature '${opts.featureName}'] phase '${opts.phaseId}' declares unsupported \`agent.profile\`: '${opts.config.agent.profile}'. Supported ids: ${SUPPORTED_AGENT_PROFILE_IDS.join(', ')}.`,
        ],
        warnings: [],
      });
    }
    out.agentProfileId = opts.config.agent.profile;
  } else if (baseline !== undefined) {
    out.agentProfileId = baseline.agentProfileId;
  }

  // agent.install — explicit phase override OR profile-default-from-id OR
  // run-level baseline. The profile-default case (only `agent.profile` set)
  // is review F-D: we resolve the bundled install script so the manifest
  // is self-contained.
  if (opts.config.agent.install !== undefined) {
    try {
      const r = await resolveAndReadScript(opts.config.agent.install, {
        ...ctx,
        fieldPath: 'agent.install',
      });
      out.agentInstallScript = r.content;
    } catch (err) {
      throw scriptResolverErrorToCompileError({
        featureName: opts.featureName,
        phaseId: opts.phaseId,
        err,
      });
    }
  } else if (
    opts.config.agent.profile !== undefined &&
    isSupportedAgentProfileId(opts.config.agent.profile)
  ) {
    // Phase set only `agent.profile`; resolve the profile's bundled install
    // script. The validator's §6.9.4 lockstep rule already warns when both
    // `agent.profile` AND `agent.install` are set, so this branch only
    // fires for the "profile alone" shape.
    const profileId = opts.config.agent.profile;
    try {
      out.agentInstallScript = await readUtf8(resolveAgentInstallScriptPath(profileId));
    } catch (err) {
      throw new PhaseCompileError(opts.featureName, {
        errors: [
          `[feature '${opts.featureName}'] phase '${opts.phaseId}' could not resolve bundled install script for \`agent.profile: ${profileId}\`: ${err instanceof Error ? err.message : String(err)}`,
        ],
        warnings: [],
      });
    }
  } else if (baseline !== undefined) {
    out.agentInstallScript = baseline.agentInstallScript;
  }

  // container.startup — phase override OR baseline. (No profile-default
  // path here: startup script defaults are sandbox-profile-driven, not
  // agent-profile-driven; that's a Level-3 concern wired in 7.5e.)
  if (opts.config.container.startup !== undefined) {
    try {
      const r = await resolveAndReadScript(opts.config.container.startup, {
        ...ctx,
        fieldPath: 'container.startup',
      });
      out.startupScript = r.content;
    } catch (err) {
      throw scriptResolverErrorToCompileError({
        featureName: opts.featureName,
        phaseId: opts.phaseId,
        err,
      });
    }
  } else if (baseline !== undefined) {
    out.startupScript = baseline.startupScript;
  }

  // container.cedar — phase override OR baseline.
  if (opts.config.container.cedar !== undefined) {
    try {
      const r = await resolveAndReadScript(opts.config.container.cedar, {
        ...ctx,
        fieldPath: 'container.cedar',
      });
      out.cedarScript = r.content;
    } catch (err) {
      throw scriptResolverErrorToCompileError({
        featureName: opts.featureName,
        phaseId: opts.phaseId,
        err,
      });
    }
  } else if (baseline !== undefined) {
    out.cedarScript = baseline.cedarScript;
  }

  // container.no-leash — phase override OR baseline.
  if (opts.config.container.noLeash !== undefined) {
    out.dangerousNoLeash = opts.config.container.noLeash;
  } else if (baseline !== undefined) {
    out.dangerousNoLeash = baseline.dangerousNoLeash;
  }

  return out;
}

/**
 * Compare two phases' fully-resolved Level-2 sets. Returns `true` when any
 * field differs — the caller flips `requiresLevel2RestartFromPrev` on the
 * next phase's first subtask.
 *
 * Implemented by delegating to `phase-transition.ts:detectLevel2Transition`
 * (review F-E) so the compiler-side diff, the validator-side gate, and the
 * future runtime-side detector all share the same comparator and field list.
 * Script-content strings are compared byte-for-byte (a phase that overrides
 * to literally the same content as the prior phase produces no transition).
 */
function level2DiffersAcrossPhases(prev: PhaseLevel2Resolved, next: PhaseLevel2Resolved): boolean {
  return detectLevel2Transition(prev, next).fields.length > 0;
}

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5b (level-3-mirror) — Level-3 helpers (parallel
// to the Level-2 ones above). Kept distinct because the cost class shows
// up in downstream branching: phase 7.5e drives image pulls / stack swaps
// for Level-3 only, where Level-2 only refreshes scripts.
// ---------------------------------------------------------------------------

/**
 * Resolved Level-3 set for one phase. Same optional-field semantics as
 * {@link PhaseLevel2Resolved}: each field is the phase override OR the
 * run-level baseline value, or `undefined` (preview path). Shape matches
 * the {@link SubtaskWithLevel3Fields} shape from `phase-transition.ts`
 * so the compile-side diff and the (future) runtime-side diff use the
 * same comparator.
 */
type PhaseLevel3Resolved = Pick<
  RunSubtaskInput,
  'containerImage' | 'containerSandboxProfileId' | 'containerEngine' | 'containerComposeFile'
>;

/**
 * Read the per-phase Level-3 effective set, fully resolved against the
 * run-level baseline. Mirrors {@link resolvePhaseLevel2Overrides} but
 * with no script-content reads — the Level-3 fields are identifiers
 * (engine kind, sandbox-profile id) and paths (image tag, compose-file
 * path), not file contents.
 *
 * Synchronous today; kept as a regular function (not async) so the
 * caller doesn't pay an `await`. The `featureConfig` top-level threading
 * has already been folded into the run-level baseline upstream
 * (options.ts pickers), so this resolver doesn't need to know about it.
 */
function resolvePhaseLevel3Overrides(opts: {
  config: ResolvedPhaseConfig;
  featureName: string;
  phaseId: string;
  runLevelBaseline?: RunLevelLevel3Baseline;
}): PhaseLevel3Resolved {
  const out: PhaseLevel3Resolved = {};
  const baseline = opts.runLevelBaseline;

  // container.image — phase override OR baseline. Review M5: the
  // run-level baseline path validates the tag via `validateImageTag`
  // (options.ts:resolveCoderImage); the per-phase override path used
  // to skip that check, so a malformed tag could reach `docker run`
  // arguments once 7.5e wires the runtime side. Apply the same regex
  // here at compile time so a typo / shell metachar fails compile
  // rather than producing odd runtime behaviour. Mirrors the Level-4
  // helper's `runner.test-image` validation (per-phase-config 7.3 F-C).
  if (opts.config.container.image !== undefined) {
    if (!IMAGE_TAG_REGEX.test(opts.config.container.image)) {
      throw new PhaseCompileError(opts.featureName, {
        errors: [
          `[feature '${opts.featureName}'] phase '${opts.phaseId}' \`container.image\`: invalid tag '${opts.config.container.image}'. Image tags must contain only letters, digits, hyphens, underscores, dots, colons, slashes, and @ signs.`,
        ],
        warnings: [],
      });
    }
    out.containerImage = opts.config.container.image;
  } else if (baseline !== undefined) {
    out.containerImage = baseline.containerImage;
  }

  // container.sandbox-profile — phase override OR baseline. Review M5:
  // schema only requires `min(1)`; we narrow to the bundled set here
  // so the user sees a compile-time error rather than the runtime
  // throwing from `resolveSandboxProfile` once 7.5e boots the new
  // container.
  if (opts.config.container.sandboxProfile !== undefined) {
    if (!isSupportedSandboxProfileId(opts.config.container.sandboxProfile)) {
      throw new PhaseCompileError(opts.featureName, {
        errors: [
          `[feature '${opts.featureName}'] phase '${opts.phaseId}' declares unsupported \`container.sandbox-profile\`: '${opts.config.container.sandboxProfile}'. Supported ids: ${SUPPORTED_SANDBOX_PROFILE_IDS.join(', ')}.`,
        ],
        warnings: [],
      });
    }
    out.containerSandboxProfileId = opts.config.container.sandboxProfile;
  } else if (baseline !== undefined) {
    out.containerSandboxProfileId = baseline.containerSandboxProfileId;
  }

  // container.engine — phase override OR baseline. The schema's
  // `engineKindSchema` is a strict enum, so any value here is already
  // one of `'docker' | 'helm' | 'local'`; no extra validation needed.
  if (opts.config.container.engine !== undefined) {
    out.containerEngine = opts.config.container.engine;
  } else if (baseline !== undefined) {
    out.containerEngine = baseline.containerEngine;
  }

  // container.compose-file — phase override OR baseline. The baseline
  // value can itself be `undefined` (engine != docker, or no compose
  // file declared at run-level); a phase that overrides with a value
  // produces a transition diff against an undefined baseline, and vice
  // versa, which is the right behaviour. The path itself is validated
  // structurally by the schema (`relativePathSchema`) and existence-
  // checked by `validate.ts:checkPhaseScriptPaths`.
  if (opts.config.container.composeFile !== undefined) {
    out.containerComposeFile = opts.config.container.composeFile;
  } else if (baseline !== undefined) {
    out.containerComposeFile = baseline.containerComposeFile;
  }

  return out;
}

/**
 * Compare two phases' fully-resolved Level-3 sets. Returns `true` when
 * any field differs. Delegates to `phase-transition.ts:detectLevel3Transition`
 * so the compiler-side diff, the validator-side gate, and the (future)
 * runtime-side detector share the same comparator.
 */
function level3DiffersAcrossPhases(prev: PhaseLevel3Resolved, next: PhaseLevel3Resolved): boolean {
  return detectLevel3Transition(prev, next).fields.length > 0;
}
