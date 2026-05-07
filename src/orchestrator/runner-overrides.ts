/**
 * Per-subtask runner-override resolution (per-phase-config phase 7.3,
 * Level 4). Test runner is recreated each outer attempt, so per-phase is
 * just routing — merge the active subtask's `runner.*` overrides on top
 * of the run-level baseline.
 *
 * The compiler resolves YAML paths into content-bearing fields on
 * `RunSubtaskInput` (`testScript`, `stageScript` are file CONTENT, not
 * paths). At runtime the loop calls {@link pickRunnerOptsForSubtask}
 * once per subtask transition to derive the effective values for
 * `prepareTestRunnerOpts` / `runStagingTestVerification`.
 *
 * `testProfile` is special: the YAML form is a registry id (string), but
 * `prepareTestRunnerOpts` consumes the resolved `TestProfile` object.
 * The helper resolves it via the existing `resolveTestProfile` registry
 * call — failures surface as the same "unknown test profile" error the
 * run-level path emits.
 */

import type { RunSubtask, RunSubtaskInput } from '../runs/types.js';
import type { SupportedSandboxProfileId } from '../sandbox-profiles/types.js';
import { resolveTestProfile, type TestProfile } from '../test-profiles/index.js';
import { validateImageTag } from '../utils/docker.js';

/** Run-level baseline for the test runner — defaults the per-subtask resolver falls back to. */
export interface RunnerOptsBaseline {
  testProfile: TestProfile;
  testImage: string;
  testScript: string;
  stageScript: string;
  resolveAmbiguity: 'off' | 'prompt' | 'ai';
  testRetries: number;
}

/** Subset of the subtask shape this resolver reads — accepts both runtime and manifest rows. */
export type SubtaskWithRunnerOverrides = Pick<
  RunSubtask | RunSubtaskInput,
  | 'testProfile'
  | 'testImage'
  | 'testScript'
  | 'stageScript'
  | 'resolveAmbiguity'
  | 'testRetries'
  | 'noRunner'
>;

/** Effective runner opts after merging subtask overrides on top of the run-level baseline. */
export interface ResolvedRunnerOpts extends RunnerOptsBaseline {
  /**
   * `true` when the active subtask declared `tests.none: true` (i.e.
   * `noRunner` on the manifest). The loop short-circuits the runner
   * when this is set AND `testScope.sources` is empty — the combined
   * check implements the §6.5(b) last-phase rule (compile populates
   * the last phase's `testScope.include` with feature/project tests
   * even when `tests.none: true`, so `sources` is non-empty there).
   */
  noRunner: boolean;
}

/**
 * Merge run-level + active-subtask runner opts. Subtask values win when
 * defined; otherwise the run-level baseline applies.
 *
 * `testProfile` and `testImage` are validated via the existing
 * `resolveTestProfile` / `validateImageTag` so a bad per-phase value
 * surfaces with the same error the run-level path produces.
 */
export function pickRunnerOptsForSubtask(opts: {
  active: SubtaskWithRunnerOverrides | undefined;
  runLevel: RunnerOptsBaseline;
}): ResolvedRunnerOpts {
  const a = opts.active;
  const rl = opts.runLevel;

  let testProfile: TestProfile = rl.testProfile;
  if (a?.testProfile !== undefined) {
    testProfile = resolveTestProfile(a.testProfile);
  }

  let testImage = rl.testImage;
  if (a?.testImage !== undefined) {
    validateImageTag(a.testImage, 'runner.test-image');
    testImage = a.testImage;
  }

  return {
    testProfile,
    testImage,
    testScript: a?.testScript ?? rl.testScript,
    stageScript: a?.stageScript ?? rl.stageScript,
    resolveAmbiguity: a?.resolveAmbiguity ?? rl.resolveAmbiguity,
    testRetries: a?.testRetries ?? rl.testRetries,
    noRunner: a?.noRunner === true,
  };
}

/**
 * Decide whether the test runner should be bypassed for the active subtask.
 *
 * Implements the §6.5(b) "tests.none" rule (per-phase-config design):
 * - Non-last phase + `noRunner: true` ⇒ bypass (compile populated `include: []`).
 * - Last phase + `noRunner: true` + feature/project tests on disk ⇒ runner runs.
 * - Last phase + `noRunner: true` + no feature/project tests on disk ⇒ bypass.
 *
 * The combined "noRunner AND scope-empty" check is what differentiates the
 * three cases without needing a separate `lastPhaseInRun` flag — the
 * compiler imprints the last phase's feature/project paths into `include`,
 * so `scope.sources` is non-empty there even with `tests.none: true`.
 */
export function shouldBypassRunner(opts: {
  noRunner: boolean;
  resolvedScopeSources: readonly string[];
}): boolean {
  return opts.noRunner && opts.resolvedScopeSources.length === 0;
}

/**
 * Per-phase-config phase 7.5e — review N1: pick the active subtask's
 * `container.sandbox-profile` (resolved as `containerSandboxProfileId`
 * on the manifest), falling back to the run-level baseline.
 *
 * Drives the staging Dockerfile resolution (`Dockerfile.coder.<profile>`)
 * for `runStagingTestVerification`. Without this resolver the run-level
 * baseline was used unchanged across phases — so a phase declaring
 * `container.sandbox-profile: foo` fired the controlled restart but
 * the new staging container kept building against the old profile.
 *
 * Note: `containerSandboxProfileId` is typed as `string | undefined` on
 * the manifest, but the compiler validates it against the supported
 * profile set (`compile.ts:resolvePhaseLevel3Overrides`), so any value
 * reaching this resolver is a `SupportedSandboxProfileId`. The cast
 * just re-narrows from the broader manifest shape.
 */
export function pickActiveSandboxProfileId(opts: {
  active: { containerSandboxProfileId?: string } | undefined;
  runLevel: SupportedSandboxProfileId;
}): SupportedSandboxProfileId {
  const overridden = opts.active?.containerSandboxProfileId as
    | SupportedSandboxProfileId
    | undefined;
  return overridden ?? opts.runLevel;
}
