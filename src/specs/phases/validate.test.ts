/**
 * Tests for {@link validatePhasedFeature} (Block 6 — standalone validator).
 *
 * The validator unifies what compile.ts used to do inline (load + discover +
 * cross-validate) and adds Block 6's spec-existence check on top. It must:
 *
 * - Return {@link ValidationReport} with both `errors` and `warnings`.
 * - Fold parse / multi-variant errors into `errors` (don't throw — the CLI
 *   prints all problems at once).
 * - Detect `phases/` ⊕ `subtasks.json` mutual exclusion (no caller-supplied
 *   flag — the validator stats the disk itself).
 * - Reject phases whose resolved spec file is missing.
 * - Return `context: null` when there are errors so callers can't use stale data.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validatePhasedFeature } from './validate.js';

let featureDir: string;

beforeEach(async () => {
  featureDir = await mkdtemp(join(tmpdir(), 'saifctl-validate-'));
});

afterEach(async () => {
  await rm(featureDir, { recursive: true, force: true });
});

async function makePhase(id: string, opts: { spec?: string } = {}): Promise<string> {
  const phaseDir = join(featureDir, 'phases', id);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(join(phaseDir, opts.spec ?? 'spec.md'), `# ${id} spec\n`, 'utf8');
  return phaseDir;
}

describe('validatePhasedFeature', () => {
  it('returns a clean report and a non-null context for a valid feature', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');

    const { report, context } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(context).not.toBeNull();
    expect(context?.phases.map((p) => p.id)).toEqual(['01-core', '02-trigger']);
    expect(context?.subtasksJsonPresent).toBe(false);
  });

  it('reports an error when a phase is missing its resolved spec file (Block 6 file-existence check)', async () => {
    // No spec.md inside the phase dir.
    await mkdir(join(featureDir, 'phases', '01-core'), { recursive: true });

    const { report, context } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });

    expect(context).toBeNull();
    expect(
      report.errors.some(
        (e) => /phase '01-core'/.test(e) && /missing/.test(e) && /spec\.md/.test(e),
      ),
    ).toBe(true);
  });

  it('honours phase.yml `spec:` override when checking spec existence', async () => {
    // Phase resolves spec to design.md but only ships spec.md ⇒ should error
    // about design.md (not the default spec.md). Use distinct names rather
    // than a case-only difference because macOS APFS is case-insensitive by
    // default — `spec.md` and `SPEC.md` would map to the same inode.
    await mkdir(join(featureDir, 'phases', '01-core'), { recursive: true });
    await writeFile(join(featureDir, 'phases', '01-core', 'spec.md'), '# default', 'utf8');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `spec: design.md\n`,
      'utf8',
    );

    const { report } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });

    expect(report.errors.some((e) => /design\.md/.test(e))).toBe(true);
    // The default name should NOT appear in any error — we resolved away from it.
    expect(report.errors.some((e) => /missing.*'spec\.md'/.test(e))).toBe(false);
  });

  it('detects subtasks.json + phases/ mutual exclusion without caller-supplied flag', async () => {
    await makePhase('01-core');
    await writeFile(join(featureDir, 'subtasks.json'), '[]', 'utf8');

    const { report, context } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });

    expect(context).toBeNull();
    expect(report.errors.some((e) => /mutually exclusive/.test(e))).toBe(true);
  });

  it('folds feature.yml parse errors into report.errors instead of throwing', async () => {
    await makePhase('01-core');
    // Invalid yaml — unclosed bracket.
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id:\n`, 'utf8');

    const { report, context } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });

    expect(context).toBeNull();
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors.some((e) => /feature\.yml/.test(e) || /YAML/i.test(e))).toBe(true);
  });

  it('continues across phase.yml parse errors so all problems surface in one pass', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');
    // Break only 02-trigger's phase.yml — 01-core stays clean.
    await writeFile(
      join(featureDir, 'phases', '02-trigger', 'phase.yml'),
      `critics: { not-a-list }\n`,
      'utf8',
    );

    const { report, context } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });

    expect(context).toBeNull();
    expect(report.errors.length).toBeGreaterThan(0);
    // The 02-trigger error must mention that file — defends against the
    // validator silently swallowing per-phase errors.
    expect(report.errors.some((e) => /02-trigger/.test(e) || /phase\.yml/.test(e))).toBe(true);
  });

  it('returns context: null when ANY error is present, even if cross-file checks pass', async () => {
    // Valid graph but missing spec ⇒ context must be null so compile can't
    // proceed on partial data.
    await mkdir(join(featureDir, 'phases', '01-core'), { recursive: true });

    const { report, context } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(context).toBeNull();
  });

  it('always returns a warnings array (empty in v1) so callers can iterate without branching', async () => {
    await makePhase('01-core');
    const { report } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });
    expect(Array.isArray(report.warnings)).toBe(true);
  });

  // Block 7 (§5.5): immutable-files globs that match no on-disk file are
  // **warnings**, not errors — the glob may anticipate a file an upcoming
  // phase will write. The error path is reserved for "..-segment / absolute
  // path" globs (rejected in the schema). We assert both: a glob that
  // matches a real file produces no warning; a glob that matches nothing
  // produces a warning naming that exact glob.
  it('warns (does NOT error) for immutable-files globs that match zero files on disk', async () => {
    await makePhase('01-core');
    const featTestsDir = join(featureDir, 'tests');
    await mkdir(featTestsDir, { recursive: true });
    await writeFile(join(featTestsDir, 'real.spec.ts'), 'test', 'utf8');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `tests:\n  mutable: true\n  immutable-files:\n    - "tests/real.spec.ts"\n    - "tests/ghost.spec.ts"\n`,
      'utf8',
    );

    const { report, context } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });

    // No errors — feature is otherwise valid.
    expect(report.errors).toEqual([]);
    expect(context).not.toBeNull();
    // Exactly one unused glob warning, naming the unused glob.
    const ghostWarnings = report.warnings.filter(
      (w) => /immutable-files/.test(w) && /ghost\.spec\.ts/.test(w),
    );
    expect(ghostWarnings).toHaveLength(1);
    // The matched glob must NOT be warned about.
    expect(report.warnings.some((w) => /'tests\/real\.spec\.ts'/.test(w))).toBe(false);
  });

  it('immutable-files glob that matches a phase-level test file does not warn', async () => {
    await makePhase('01-core');
    const phaseTestsDir = join(featureDir, 'phases', '01-core', 'tests');
    await mkdir(phaseTestsDir, { recursive: true });
    await writeFile(join(phaseTestsDir, 'phase.spec.ts'), 'test', 'utf8');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `tests:\n  mutable: true\n  immutable-files:\n    - "phases/01-core/tests/phase.spec.ts"\n`,
      'utf8',
    );

    const { report } = await validatePhasedFeature({
      featureAbsolutePath: featureDir,
      projectDir: featureDir,
    });
    expect(report.warnings.filter((w) => /immutable-files/.test(w))).toEqual([]);
  });

  it('non-existent featureDir is reported as an error, not a throw', async () => {
    // Validator must be safe to call even if the feature dir is gone — the
    // CLI may invoke it from a stale slug. Either an empty/successful report
    // (no phases ⇒ trivially valid) OR a structured error is acceptable; what
    // we forbid is an unhandled exception bubbling up.
    const ghost = join(featureDir, 'does-not-exist');
    await expect(
      validatePhasedFeature({ featureAbsolutePath: ghost, projectDir: ghost }),
    ).resolves.not.toThrow();
  });

  // -------------------------------------------------------------------------
  // per-phase-config v1: §6.9 lockstep validators.
  //
  // Each test pins the EXACT message text against the §6.9 contract. Loose
  // substring checks (`.includes(...)`) would let the wording drift; the
  // table is a wire-protocol contract that consumers (the CLI printer, any
  // downstream tooling) are expected to match verbatim. `toContain` against
  // the full string fails as soon as anything reorders or rephrases.
  // -------------------------------------------------------------------------

  /** Source label used in every per-phase-config error/warning prefix. */
  const featureLabel = (): string => `[feature '${basename(featureDir)}']`;
  const featureYmlSource = (): string => `${featureLabel()} feature.yml`;

  describe('§6.9.1 — cedar + no-leash mutual exclusion (error)', () => {
    it('errors with the exact §6.9.1 text when both container.cedar and container.no-leash: true are set', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  cedar: policy.cedar\n  no-leash: true\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.errors).toContain(
        `${featureYmlSource()}: has both \`container.cedar\` and \`container.no-leash: true\` set. Cedar policy is meaningless without Leash. Either remove \`container.cedar\` or set \`container.no-leash: false\`.`,
      );
    });

    it('does not error when only one of cedar / no-leash is set', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  cedar: policy.cedar\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.errors.filter((e) => e.includes('Cedar policy is meaningless'))).toHaveLength(
        0,
      );
    });
  });

  describe('§6.9.2 — tests.none + other tests.* (warning)', () => {
    it('warns with the exact §6.9.2 text when tests.none: true is set with mutable + fail2pass', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `tests:\n  none: true\n  mutable: false\n  fail2pass: true\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings).toContain(
        `${featureYmlSource()}: sets \`tests.none: true\` alongside \`tests.{mutable|fail2pass}\`. When \`tests.none: true\`, those fields are inert because the runner is bypassed for this phase.`,
      );
    });

    it('warns with the exact §6.9.2 text when tests.none: true is set with all four other tests.* keys', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `tests:\n  none: true\n  mutable: false\n  fail2pass: true\n  enforce: diff-inspection\n  immutable-files:\n    - x.spec.ts\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings).toContain(
        `${featureYmlSource()}: sets \`tests.none: true\` alongside \`tests.{mutable|fail2pass|enforce|immutable-files}\`. When \`tests.none: true\`, those fields are inert because the runner is bypassed for this phase.`,
      );
    });

    it('does not warn when tests.none is true and no other tests.* keys are set', async () => {
      await makePhase('01-core');
      await writeFile(join(featureDir, 'feature.yml'), `tests:\n  none: true\n`, 'utf8');
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.warnings.filter((w) => w.includes('inert because the runner is bypassed')),
      ).toHaveLength(0);
    });
  });

  describe('§6.9.3 — tests.none + runner.* (warning)', () => {
    it('warns with the exact §6.9.3 text when tests.none: true is set with two runner.* keys', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `tests:\n  none: true\nrunner:\n  test-profile: pytest\n  test-retries: 3\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings).toContain(
        `${featureYmlSource()}: sets \`tests.none: true\` alongside \`runner.{test-profile|test-retries}\`. The runner is bypassed for this phase, so \`runner.*\` is inert.`,
      );
    });
  });

  describe('§6.9.4 — agent.profile + explicit script/install (warning)', () => {
    it('warns with the exact §6.9.4 text for agent.profile + agent.script', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `agent:\n  profile: claude\n  script: custom-agent.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings).toContain(
        `${featureYmlSource()}: sets \`agent.profile\` and also explicitly sets \`agent.script\`. The explicit value takes precedence over the profile defaults; this is unusual and may indicate a configuration mistake. To inherit the profile's defaults, omit \`agent.script\`.`,
      );
    });

    it('warns with the exact §6.9.4 text for agent.profile + agent.install', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `agent:\n  profile: claude\n  install: custom-install.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings).toContain(
        `${featureYmlSource()}: sets \`agent.profile\` and also explicitly sets \`agent.install\`. The explicit value takes precedence over the profile defaults; this is unusual and may indicate a configuration mistake. To inherit the profile's defaults, omit \`agent.install\`.`,
      );
    });

    it('warns with the exact §6.9.4 text for agent.profile + both script and install', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `agent:\n  profile: claude\n  script: agent.sh\n  install: install.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings).toContain(
        `${featureYmlSource()}: sets \`agent.profile\` and also explicitly sets \`agent.{script|install}\`. The explicit value takes precedence over the profile defaults; this is unusual and may indicate a configuration mistake. To inherit the profile's defaults, omit \`agent.{script|install}\`.`,
      );
    });
  });

  describe('§6.9.5 — sandbox-profile + container.image (warning)', () => {
    it('warns with the exact §6.9.5 text', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  sandbox-profile: node-pnpm-python\n  image: my-coder:v2\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings).toContain(
        `${featureYmlSource()}: sets \`container.sandbox-profile\` and also explicitly sets \`container.image\`. The explicit value takes precedence. To inherit the profile's image, omit \`container.image\`.`,
      );
    });
  });

  describe('§6.9.10 — compose-file with non-docker engine (warning, review L2 / phase 7.5c)', () => {
    // resolveCodingEnvironment silently drops `container.compose-file` when
    // engine is helm/local; warn so the user knows their YAML is inert
    // rather than discovering the no-op at runtime.
    it('warns when container.compose-file is set with engine: helm', async () => {
      await makePhase('01-only');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  engine: helm\n  compose-file: ./compose.yml\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.warnings.some(
          (w) =>
            w.includes('`container.compose-file`') &&
            w.includes('engine: helm') &&
            w.includes('only meaningful when `engine: docker`'),
        ),
      ).toBe(true);
    });

    it('warns when container.compose-file is set with engine: local', async () => {
      await makePhase('01-only');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  engine: local\n  compose-file: ./compose.yml\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.warnings.some(
          (w) => w.includes('`container.compose-file`') && w.includes('engine: local'),
        ),
      ).toBe(true);
    });

    it('does NOT warn when container.compose-file is set with engine: docker', async () => {
      await makePhase('01-only');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  engine: docker\n  compose-file: ./compose.yml\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.warnings.filter(
          (w) => w.includes('`container.compose-file`') && w.includes('only meaningful'),
        ),
      ).toHaveLength(0);
    });

    it('does NOT warn when container.compose-file is set without an engine declaration (engine defaults to docker)', async () => {
      await makePhase('01-only');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  compose-file: ./compose.yml\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.warnings.filter(
          (w) => w.includes('`container.compose-file`') && w.includes('only meaningful'),
        ),
      ).toHaveLength(0);
    });
  });

  describe('§6.9.6 — Level-2 transition infos', () => {
    /** Build the exact §6.9.6 info string. */
    const level2Info = (
      prevId: string,
      nextId: string,
      path: string,
      prevValue: string,
      nextValue: string,
    ): string =>
      `${featureLabel()} phases '${prevId}' → '${nextId}' change \`${path}\` (${prevValue} → ${nextValue}). This triggers a coder-container restart between phases (~10–30s). To minimise restarts, group phases by lifecycle-Level-2 settings.`;

    it('emits the exact §6.9.6 info when adjacent phases differ on agent.profile', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `agent:\n  profile: claude\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `agent:\n  profile: aider\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level2Info('01-a', '02-b', 'agent.profile', "'claude'", "'aider'"),
      );
    });

    it('emits the exact §6.9.6 info when adjacent phases differ on agent.install', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `agent:\n  install: install-a.sh\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `agent:\n  install: install-b.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level2Info('01-a', '02-b', 'agent.install', "'install-a.sh'", "'install-b.sh'"),
      );
    });

    it('emits the exact §6.9.6 info when adjacent phases differ on container.startup', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  startup: startup-a.sh\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  startup: startup-b.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level2Info('01-a', '02-b', 'container.startup', "'startup-a.sh'", "'startup-b.sh'"),
      );
    });

    it('emits the exact §6.9.6 info when adjacent phases differ on container.cedar', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  cedar: a.cedar\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  cedar: b.cedar\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level2Info('01-a', '02-b', 'container.cedar', "'a.cedar'", "'b.cedar'"),
      );
    });

    it('emits the exact §6.9.6 info when adjacent phases differ on container.no-leash', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  no-leash: false\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  no-leash: true\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level2Info('01-a', '02-b', 'container.no-leash', 'false', 'true'),
      );
    });
  });

  describe('§6.9.7 — Level-3 transition infos', () => {
    /** Build the exact §6.9.7 info string. */
    const level3Info = (
      prevId: string,
      nextId: string,
      path: string,
      prevValue: string,
      nextValue: string,
    ): string =>
      `${featureLabel()} phases '${prevId}' → '${nextId}' change \`${path}\` (${prevValue} → ${nextValue}). This triggers a docker pull/build and container restart between phases. First-time image pulls may take minutes.`;

    it('emits the exact §6.9.7 info when adjacent phases differ on container.image', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  image: node-pnpm-python:latest\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  image: python-uv:latest\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level3Info(
          '01-a',
          '02-b',
          'container.image',
          "'node-pnpm-python:latest'",
          "'python-uv:latest'",
        ),
      );
    });

    it('emits the exact §6.9.7 info when adjacent phases differ on container.engine', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  engine: docker\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  engine: local\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level3Info('01-a', '02-b', 'container.engine', "'docker'", "'local'"),
      );
    });

    it('emits the exact §6.9.7 info when adjacent phases differ on container.sandbox-profile', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  sandbox-profile: node-pnpm-python\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  sandbox-profile: python-uv\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level3Info(
          '01-a',
          '02-b',
          'container.sandbox-profile',
          "'node-pnpm-python'",
          "'python-uv'",
        ),
      );
    });

    it('emits the exact §6.9.7 info when adjacent phases differ on container.compose-file', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  compose-file: compose-a.yml\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  compose-file: compose-b.yml\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.infos!).toContain(
        level3Info('01-a', '02-b', 'container.compose-file', "'compose-a.yml'", "'compose-b.yml'"),
      );
    });
  });

  describe('§6.9.8 — runtime-support gate (future-proof reject)', () => {
    // The Level-1.5 field used to be gated by §6.9.8 until phase 7.4
    // landed. Pin instead that the field NO LONGER errors — and that
    // a Level-2 field still does (Level-2 ships in 7.5).
    it('does NOT error on a Level-1.5 field that has shipped (agent.env)', async () => {
      await makePhase('01-core');
      await writeFile(join(featureDir, 'feature.yml'), `agent:\n  env:\n    FOO: bar\n`, 'utf8');
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter((e) => e.includes('agent.env') && e.includes('not yet implemented')),
      ).toHaveLength(0);
    });

    // The Level-2 field used to be gated by §6.9.8 until phase 7.5
    // cleared the runtime-support flags. Pin instead that the field
    // NO LONGER triggers §6.9.8 when set at feature.yml top-level
    // (no per-phase variation → no transition needed → ok). The
    // separate Level-2 transition gate (added in 7.5) catches
    // phase-to-phase variation; that's tested below in the
    // dedicated `Level-2 transition gate` describe block.
    it('does NOT error on a Level-2 field set at feature top-level (agent.profile)', async () => {
      await makePhase('01-core');
      await writeFile(join(featureDir, 'feature.yml'), `agent:\n  profile: claude\n`, 'utf8');
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter(
          (e) => e.includes('agent.profile') && e.includes('not yet implemented'),
        ),
      ).toHaveLength(0);
    });

    // The Level-3 field used to be gated by §6.9.8 until phase 7.5b
    // (level-3-mirror) cleared the runtime-support flags. Pin instead
    // that the field NO LONGER triggers §6.9.8 when set at
    // feature.yml top-level (no per-phase variation → no transition
    // needed → ok). The separate Level-3 transition gate (added in
    // phase 7.5b) catches phase-to-phase variation; that's tested
    // below in the dedicated `Level-3 transition gate` describe block.
    it('does NOT error on a Level-3 field set at feature top-level (container.image)', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  image: my-coder:v2\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter(
          (e) => e.includes('container.image') && e.includes('not yet implemented'),
        ),
      ).toHaveLength(0);
    });

    // The Level-4 field used to be gated by §6.9.8 until phase 7.3
    // landed. Pin instead that the field NO LONGER errors — and that a
    // Level-2 field still does (Level-2 ships in 7.5).
    it('does NOT error on a Level-4 field that has shipped (runner.test-profile)', async () => {
      await makePhase('01-core');
      await writeFile(join(featureDir, 'feature.yml'), `runner:\n  test-profile: pytest\n`, 'utf8');
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter(
          (e) => e.includes('runner.test-profile') && e.includes('not yet implemented'),
        ),
      ).toHaveLength(0);
    });

    // Phase 7.6 (per-phase-max-attempts) cleared the §6.9.8 gate for the
    // last loop-state field (`limits.max-attempts`). Pin instead that the
    // field NO LONGER triggers §6.9.8 — same shape as the other shipped-
    // field pins above. The §6.9.8 table is now empty for v1.
    it('does NOT error on the loop-state field shipped by phase 7.6 (limits.max-attempts)', async () => {
      await makePhase('01-core');
      await writeFile(join(featureDir, 'feature.yml'), `limits:\n  max-attempts: 5\n`, 'utf8');
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter(
          (e) => e.includes('limits.max-attempts') && e.includes('not yet implemented'),
        ),
      ).toHaveLength(0);
    });

    it('does not error when no new fields are set (back-compat)', async () => {
      await makePhase('01-core');
      await writeFile(join(featureDir, 'feature.yml'), `tests:\n  mutable: false\n`, 'utf8');
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.errors.filter((e) => e.includes('not yet implemented'))).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // per-phase-config phase 7.6 review N4: validator info when
  // `limits.max-attempts` is smaller than the minimum number of subtasks
  // the phase will produce. Catches the common typo where a user expects
  // "N retries" but actually configured "N total subtask completions."
  // -------------------------------------------------------------------------
  describe('limits.max-attempts vs phase subtask count info (phase 7.6 N4)', () => {
    async function writeCritic(id: string, body: string): Promise<void> {
      const criticsDir = join(featureDir, 'critics');
      await mkdir(criticsDir, { recursive: true });
      await writeFile(join(criticsDir, `${id}.md`), body, 'utf8');
    }

    it('emits an info when `max-attempts` is smaller than the phase subtask count', async () => {
      // 1 impl + 1 critic × 2 rounds × 2 subtasks-per-round = 5 subtasks.
      // A cap of 2 is clearly insufficient.
      await makePhase('01-core');
      await writeCritic('strict', '# critic body');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `critics:\n  - id: strict\n    rounds: 2\nlimits:\n  max-attempts: 2\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      const matches = (report.infos ?? []).filter(
        (m) => m.includes("phase '01-core'") && m.includes('limits.max-attempts'),
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]).toContain('5 subtasks');
      expect(matches[0]).toContain('≥ 5');
      // Phase 7.6 review M1: the message describes the actual runtime
      // behaviour (failure-fail-fast), not the inaccurate "guaranteed
      // exhaustion" framing the message used to carry. Pin both halves
      // so a regression that re-introduces the misleading phrasing is
      // caught.
      expect(matches[0]).toContain('any failure mid-phase fails the run immediately');
      expect(matches[0]).toContain('First-try success on every subtask still completes the phase');
    });

    it('emits NO info when `max-attempts` is exactly the phase subtask count (allows first-try success on all)', async () => {
      // 1 impl + 1 critic × 1 round × 2 = 3 subtasks. cap = 3 is the
      // boundary case — first-try success on every subtask exhausts it
      // exactly, but doesn't trigger fail-fast (the success path doesn't
      // consult the cap). No info needed.
      await makePhase('01-core');
      await writeCritic('strict', '# critic body');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `critics:\n  - id: strict\n    rounds: 1\nlimits:\n  max-attempts: 3\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        (report.infos ?? []).filter(
          (m) => m.includes("phase '01-core'") && m.includes('limits.max-attempts'),
        ),
      ).toHaveLength(0);
    });

    it('emits NO info when the phase has no `limits.max-attempts` declared', async () => {
      await makePhase('01-core');
      await writeCritic('strict', '# critic body');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `critics:\n  - id: strict\n    rounds: 5\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        (report.infos ?? []).filter(
          (m) => m.includes("phase '01-core'") && m.includes('limits.max-attempts'),
        ),
      ).toHaveLength(0);
    });

    it('counts critic rounds correctly when `critics: null` (run all discovered, rounds: 1 each)', async () => {
      // 1 impl + 2 discovered critics × 1 round × 2 = 5 subtasks. cap = 1 → info.
      await makePhase('01-core');
      await writeCritic('strict', '# strict critic');
      await writeCritic('paranoid', '# paranoid critic');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `limits:\n  max-attempts: 1\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      const matches = (report.infos ?? []).filter(
        (m) => m.includes("phase '01-core'") && m.includes('limits.max-attempts'),
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]).toContain('5 subtasks');
    });
  });

  // -------------------------------------------------------------------------
  // per-phase-config phase 7.2 — script-existence checks at validate time.
  // Once a Level-1 field clears its 6.9.8 flag, the validator surfaces
  // missing-file errors so users see them before `feat run` boots.
  // -------------------------------------------------------------------------

  describe('per-phase script existence (phase 7.2)', () => {
    it('errors when phase.yml references a gate.script that does not resolve', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `gate:\n  script: missing.sh\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.some(
          (e) =>
            e.includes("phase '01-core'") &&
            e.includes('`gate.script: missing.sh`') &&
            e.includes('could not be located'),
        ),
      ).toBe(true);
    });

    it('does not error when gate.script resolves against the phase dir', async () => {
      const phaseDir = await makePhase('01-core');
      await writeFile(join(phaseDir, 'gate.sh'), 'ok\n', 'utf8');
      await writeFile(join(phaseDir, 'phase.yml'), `gate:\n  script: gate.sh\n`, 'utf8');

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter((e) => /`gate\.script.*could not be located/.test(e)),
      ).toHaveLength(0);
    });

    it('does not error when gate.script resolves against the feature dir', async () => {
      await makePhase('01-core');
      await writeFile(join(featureDir, 'shared.sh'), 'ok\n', 'utf8');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `gate:\n  script: shared.sh\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter((e) => /`gate\.script.*could not be located/.test(e)),
      ).toHaveLength(0);
    });

    it('errors when agent.script references a missing file', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `agent:\n  script: nope.sh\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.some(
          (e) =>
            e.includes("phase '01-core'") &&
            e.includes('`agent.script: nope.sh`') &&
            e.includes('could not be located'),
        ),
      ).toBe(true);
    });

    // Per-phase-config phase 7.3 review F-F: extend the existence checks
    // to cover `runner.test-script` and `runner.stage-script`. The
    // validator already wires both into `checkPhaseScriptPaths`; these
    // tests pin the contract so a future regression doesn't drop them.
    it('errors when runner.test-script references a missing file', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `runner:\n  test-script: ghost-test.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.some(
          (e) =>
            e.includes("phase '01-core'") &&
            e.includes('`runner.test-script: ghost-test.sh`') &&
            e.includes('could not be located'),
        ),
      ).toBe(true);
    });

    it('errors when runner.stage-script references a missing file', async () => {
      await makePhase('01-core');
      await writeFile(
        join(featureDir, 'phases', '01-core', 'phase.yml'),
        `runner:\n  stage-script: ghost-stage.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.some(
          (e) =>
            e.includes("phase '01-core'") &&
            e.includes('`runner.stage-script: ghost-stage.sh`') &&
            e.includes('could not be located'),
        ),
      ).toBe(true);
    });

    it('does not error when runner.test-script / runner.stage-script resolve against the phase dir', async () => {
      const phaseDir = await makePhase('01-core');
      await writeFile(join(phaseDir, 'test.sh'), 'ok\n', 'utf8');
      await writeFile(join(phaseDir, 'stage.sh'), 'ok\n', 'utf8');
      await writeFile(
        join(phaseDir, 'phase.yml'),
        `runner:\n  test-script: test.sh\n  stage-script: stage.sh\n`,
        'utf8',
      );
      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter((e) => /runner\.(test|stage)-script.*could not be located/.test(e)),
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // per-phase-config phase 7.5e — Level-2/3 transition gates removed.
  // The validator no longer rejects adjacent-phase Level-2 / 3 differences;
  // those are runtime-driven by `loop.ts:runIterativeLoop` (calls
  // `runControlledRestart` at the boundary, boots a fresh coder container
  // with the new active subtask's Level-2/3 values). These tests pin
  // that the validator IS silent on what used to be gate errors so a
  // future refactor can't accidentally re-enable a gate without
  // surfacing the regression.
  // -------------------------------------------------------------------------
  describe('Level-2/3 transition gates removed (phase 7.5e — runtime-driven)', () => {
    it('does NOT error when adjacent phases differ on agent.profile (runtime restart drives the transition)', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `agent:\n  profile: claude\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `agent:\n  profile: aider\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter(
          (e) =>
            e.includes("phases '01-a' → '02-b'") &&
            (e.includes('Level-2') || e.includes('Level-3')),
        ),
      ).toHaveLength(0);
    });

    it('does NOT error when adjacent phases differ on container.image (Level-3, also runtime-driven)', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `container:\n  image: my-coder:v1\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `container:\n  image: my-coder:v2\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter(
          (e) =>
            e.includes("phases '01-a' → '02-b'") &&
            (e.includes('Level-2') || e.includes('Level-3')),
        ),
      ).toHaveLength(0);
    });

    it('does NOT error when adjacent phases differ on BOTH Level-2 and Level-3', async () => {
      await makePhase('01-a');
      await makePhase('02-b');
      await writeFile(
        join(featureDir, 'phases', '01-a', 'phase.yml'),
        `agent:\n  profile: claude\ncontainer:\n  image: my-coder:v1\n`,
        'utf8',
      );
      await writeFile(
        join(featureDir, 'phases', '02-b', 'phase.yml'),
        `agent:\n  profile: aider\ncontainer:\n  image: my-coder:v2\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.errors.filter(
          (e) =>
            e.includes("phases '01-a' → '02-b'") &&
            (e.includes('Level-2') || e.includes('Level-3')),
        ),
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // per-phase-config phase 7.5c — F-A silent-fallthrough trap is closed.
  // The Level-2/3 warning emitted by previous releases is gone; the
  // run-level baseline pickers in `options.ts` now read `featureConfig`,
  // so YAML-only top-level / `phases.defaults` declarations take effect at
  // runtime. These pins assert the warning path is silent so a future
  // refactor can't accidentally re-enable it without a corresponding
  // user-visible regression.
  // -------------------------------------------------------------------------
  describe('Level-2/3 silent-fallthrough warning is gone (closed by phase 7.5c)', () => {
    it('does NOT warn when feature.yml top-level declares agent.profile', async () => {
      await makePhase('01-only');
      await writeFile(join(featureDir, 'feature.yml'), `agent:\n  profile: claude\n`, 'utf8');

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.warnings.filter(
          (m) => m.includes('`agent.profile`') && m.includes('silently ignored'),
        ),
      ).toHaveLength(0);
    });

    it('does NOT warn when feature.yml top-level declares container.cedar', async () => {
      await makePhase('01-only');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `container:\n  cedar: ./strict.cedar\n  no-leash: false\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(
        report.warnings.filter(
          (m) => m.includes('`container.cedar`') && m.includes('silently ignored'),
        ),
      ).toHaveLength(0);
    });

    it('does NOT warn for any Level-2/3 field declared at feature.yml top-level OR phases.defaults', async () => {
      await makePhase('01-only');
      await writeFile(
        join(featureDir, 'feature.yml'),
        `agent:\n  profile: claude\n` +
          `container:\n  image: my-coder:v1\n  no-leash: true\n` +
          `phases:\n  defaults:\n    container:\n      sandbox-profile: node-pnpm-python\n`,
        'utf8',
      );

      const { report } = await validatePhasedFeature({
        featureAbsolutePath: featureDir,
        projectDir: featureDir,
      });
      expect(report.warnings.filter((m) => m.includes('silently ignored'))).toHaveLength(0);
    });
  });
});
