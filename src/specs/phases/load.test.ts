/**
 * Tests for file loading + extension precedence + inheritance resolution.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILT_IN_DEFAULTS,
  loadFeatureConfig,
  loadPhaseConfig,
  MultipleConfigVariantsError,
  PhaseConfigParseError,
  resolvePhaseConfig,
} from './load.js';

let TEST_BASE: string;

beforeEach(async () => {
  TEST_BASE = join(tmpdir(), `phases-load-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(TEST_BASE, { recursive: true });
});

afterEach(async () => {
  try {
    await rm(TEST_BASE, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// loadFeatureConfig
// ---------------------------------------------------------------------------

describe('loadFeatureConfig', () => {
  it('returns null when no feature.* file exists', async () => {
    const r = await loadFeatureConfig(TEST_BASE);
    expect(r).toBeNull();
  });

  it('loads feature.yml', async () => {
    await writeFile(join(TEST_BASE, 'feature.yml'), 'critics: [{id: strict}]\n', 'utf8');
    const r = await loadFeatureConfig(TEST_BASE);
    expect(r?.config.critics).toEqual([{ id: 'strict', rounds: 1 }]);
    expect(r?.filepath).toBe(join(TEST_BASE, 'feature.yml'));
  });

  it('loads feature.yaml', async () => {
    await writeFile(join(TEST_BASE, 'feature.yaml'), 'critics: [{id: strict}]\n', 'utf8');
    const r = await loadFeatureConfig(TEST_BASE);
    expect(r?.config.critics).toEqual([{ id: 'strict', rounds: 1 }]);
  });

  it('loads feature.json', async () => {
    await writeFile(
      join(TEST_BASE, 'feature.json'),
      JSON.stringify({ critics: [{ id: 'strict' }] }),
      'utf8',
    );
    const r = await loadFeatureConfig(TEST_BASE);
    expect(r?.config.critics).toEqual([{ id: 'strict', rounds: 1 }]);
  });

  it('errors when multiple feature.* variants exist', async () => {
    await writeFile(join(TEST_BASE, 'feature.yml'), 'critics: []\n', 'utf8');
    await writeFile(join(TEST_BASE, 'feature.yaml'), 'critics: []\n', 'utf8');
    await expect(loadFeatureConfig(TEST_BASE)).rejects.toThrow(MultipleConfigVariantsError);
  });

  it('throws PhaseConfigParseError on invalid schema', async () => {
    await writeFile(join(TEST_BASE, 'feature.yml'), 'critics: [{id: "BAD ID"}]\n', 'utf8');
    await expect(loadFeatureConfig(TEST_BASE)).rejects.toThrow(PhaseConfigParseError);
  });

  it('throws PhaseConfigParseError on unknown top-level key', async () => {
    await writeFile(join(TEST_BASE, 'feature.yml'), 'rogue: true\n', 'utf8');
    await expect(loadFeatureConfig(TEST_BASE)).rejects.toThrow(PhaseConfigParseError);
  });
});

// ---------------------------------------------------------------------------
// loadPhaseConfig
// ---------------------------------------------------------------------------

describe('loadPhaseConfig', () => {
  it('returns null when no phase.* file exists', async () => {
    const r = await loadPhaseConfig(TEST_BASE);
    expect(r).toBeNull();
  });

  it('loads phase.yml', async () => {
    await writeFile(join(TEST_BASE, 'phase.yml'), 'critics: [{id: paranoid, rounds: 2}]\n', 'utf8');
    const r = await loadPhaseConfig(TEST_BASE);
    expect(r?.config.critics).toEqual([{ id: 'paranoid', rounds: 2 }]);
  });

  it('errors on multiple variants', async () => {
    await writeFile(join(TEST_BASE, 'phase.yml'), '{}\n', 'utf8');
    await writeFile(join(TEST_BASE, 'phase.json'), '{}\n', 'utf8');
    await expect(loadPhaseConfig(TEST_BASE)).rejects.toThrow(MultipleConfigVariantsError);
  });

  it('throws on invalid schema', async () => {
    // Unknown key trips strict() — schema-time rejection.
    await writeFile(join(TEST_BASE, 'phase.yml'), 'rogue: 1\n', 'utf8');
    await expect(loadPhaseConfig(TEST_BASE)).rejects.toThrow(PhaseConfigParseError);
  });

  it("loads tests.enforce: 'read-only' without throwing (validator handles rejection)", async () => {
    // Ensures the schema layer parses 'read-only' for future-proofing.
    // validatePhaseGraph in discover.ts is responsible for the v1 rejection.
    await writeFile(join(TEST_BASE, 'phase.yml'), 'tests:\n  enforce: read-only\n', 'utf8');
    const r = await loadPhaseConfig(TEST_BASE);
    expect(r?.config.tests?.enforce).toBe('read-only');
  });
});

// ---------------------------------------------------------------------------
// resolvePhaseConfig — inheritance
// ---------------------------------------------------------------------------

describe('resolvePhaseConfig — inheritance', () => {
  it('returns built-in defaults when both inputs are null (strict baseline ⇒ immutable)', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: null,
    });
    expect(r.spec).toBe('spec.md');
    expect(r.critics).toBeNull(); // null sentinel = "run all critics"
    expect(r.tests).toEqual({
      // Strict default (projectDefaultStrict omitted ⇒ true) ⇒ default-immutable.
      mutable: false,
      fail2pass: BUILT_IN_DEFAULTS.testsFail2pass,
      enforce: BUILT_IN_DEFAULTS.testsEnforce,
      immutableFiles: BUILT_IN_DEFAULTS.testsImmutableFiles,
      // per-phase-config v1: `tests.none` defaults to false (the phase has its
      // own tests; the runner spins up as usual).
      none: false,
    });
    // per-phase-config v1: when no phase-level overrides exist, every group
    // resolves to an empty object — the threading site falls back to run-level.
    expect(r.gate).toEqual({});
    expect(r.agent).toEqual({});
    expect(r.container).toEqual({});
    expect(r.runner).toEqual({});
    expect(r.limits).toEqual({});
  });

  it('projectDefaultStrict: false flips the unset-mutable floor to mutable', () => {
    // Regression for the "--no-strict silently ignored for phase tests" bug:
    // when no `mutable:` declaration walks up the chain, the project default
    // (which CLI `--no-strict` flips to false) MUST drive the resolved value.
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: null,
      projectDefaultStrict: false,
    });
    expect(r.tests.mutable).toBe(true);
    // mutable=true auto-flips fail2pass=false unless explicit (§9).
    expect(r.tests.fail2pass).toBe(false);
  });

  it('projectDefaultStrict does NOT override an explicit mutable: false declaration', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { tests: { mutable: false } },
      featureConfig: null,
      projectDefaultStrict: false, // --no-strict
    });
    expect(r.tests.mutable).toBe(false);
  });

  it('phase.yml overrides feature.yml.phases.defaults', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { critics: [{ id: 'paranoid', rounds: 3 }] },
      featureConfig: {
        phases: {
          defaults: { critics: [{ id: 'strict', rounds: 1 }] },
        },
      },
    });
    expect(r.critics).toEqual([{ id: 'paranoid', rounds: 3 }]);
  });

  it('inline phase config (feature.yml.phases.phases.<id>) overrides defaults', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: {
        phases: {
          defaults: { critics: [{ id: 'strict', rounds: 1 }] },
          phases: { p1: { critics: [{ id: 'security', rounds: 1 }] } },
        },
      },
    });
    expect(r.critics).toEqual([{ id: 'security', rounds: 1 }]);
  });

  it('phase.yml beats inline phase config', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { critics: [{ id: 'paranoid', rounds: 2 }] },
      featureConfig: {
        phases: {
          phases: { p1: { critics: [{ id: 'security', rounds: 1 }] } },
        },
      },
    });
    expect(r.critics).toEqual([{ id: 'paranoid', rounds: 2 }]);
  });

  it('feature.yml top-level critics is fallback when phases scope is silent', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: {
        critics: [{ id: 'top-level', rounds: 1 }],
      },
    });
    expect(r.critics).toEqual([{ id: 'top-level', rounds: 1 }]);
  });

  it('explicit critics: [] overrides "run all" sentinel', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { critics: [] },
      featureConfig: { critics: [{ id: 'strict', rounds: 1 }] },
    });
    expect(r.critics).toEqual([]);
  });

  it('no critics anywhere ⇒ null sentinel ("run all")', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: { tests: { mutable: false } },
    });
    expect(r.critics).toBeNull();
  });

  it('spec defaults to spec.md when neither layer sets it', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: null,
    });
    expect(r.spec).toBe('spec.md');
  });

  it('spec from phase.yml wins over inline phase config', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { spec: 'custom-from-phase-yml.md' },
      featureConfig: {
        phases: { phases: { p1: { spec: 'custom-from-inline.md' } } },
      },
    });
    expect(r.spec).toBe('custom-from-phase-yml.md');
  });

  it('spec inherits from phases.defaults when neither phase.yml nor inline sets it', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: {
        phases: { defaults: { spec: 'SPEC.md' } },
      },
    });
    expect(r.spec).toBe('SPEC.md');
  });

  it('spec from inline phase config beats phases.defaults', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: {
        phases: {
          defaults: { spec: 'SPEC.md' },
          phases: { p1: { spec: 'custom-from-inline.md' } },
        },
      },
    });
    expect(r.spec).toBe('custom-from-inline.md');
  });

  it('tests sub-keys resolve independently across layers', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { tests: { mutable: true } },
      featureConfig: {
        phases: {
          defaults: { tests: { 'immutable-files': ['tests/contract.ts'] } },
        },
      },
    });
    expect(r.tests.mutable).toBe(true);
    expect(r.tests.immutableFiles).toEqual(['tests/contract.ts']);
  });

  it('mutable=true auto-flips fail2pass to false unless explicitly set', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { tests: { mutable: true } },
      featureConfig: null,
    });
    expect(r.tests.mutable).toBe(true);
    expect(r.tests.fail2pass).toBe(false);
  });

  it('mutable=true with explicit fail2pass:true keeps fail2pass true', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { tests: { mutable: true, fail2pass: true } },
      featureConfig: null,
    });
    expect(r.tests.fail2pass).toBe(true);
  });

  it('list-valued immutable-files: phase.yml replaces inherited list (no merge)', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { tests: { 'immutable-files': ['phase-only.ts'] } },
      featureConfig: {
        phases: {
          defaults: { tests: { 'immutable-files': ['feat-default.ts'] } },
        },
      },
    });
    expect(r.tests.immutableFiles).toEqual(['phase-only.ts']);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config v1: new group resolution
// ---------------------------------------------------------------------------

describe('resolvePhaseConfig — v1 group resolution', () => {
  it('resolves gate sub-keys independently (sub-key by sub-key merge)', () => {
    // feature-top-level provides script; phase.yml provides retries.
    // Both should land on the resolved config.
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { gate: { retries: 7 } },
      featureConfig: { gate: { script: 'shared/gate.sh' } },
    });
    expect(r.gate.script).toBe('shared/gate.sh');
    expect(r.gate.retries).toBe(7);
  });

  it('phase.yml > inline > defaults > feature-top for the same group sub-key', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { gate: { script: 'phase.sh' } },
      featureConfig: {
        gate: { script: 'feat.sh' },
        phases: {
          defaults: { gate: { script: 'defaults.sh' } },
          phases: { p1: { gate: { script: 'inline.sh' } } },
        },
      },
    });
    expect(r.gate.script).toBe('phase.sh');
  });

  it('inline phase config beats defaults beats feature top-level for groups', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: {
        gate: { script: 'feat.sh' },
        phases: {
          defaults: { gate: { script: 'defaults.sh' } },
          phases: { p1: { gate: { script: 'inline.sh' } } },
        },
      },
    });
    expect(r.gate.script).toBe('inline.sh');
  });

  it('falls back to feature top-level when nothing in the phases scope sets the group', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: { gate: { retries: 2 } },
    });
    expect(r.gate.retries).toBe(2);
  });

  it('agent.env merges by key across layers (most-specific wins per key)', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { agent: { env: { PHASE: '1', SHARED: 'phase-wins' } } },
      featureConfig: {
        agent: { env: { TOP: '1' } },
        phases: {
          defaults: { agent: { env: { DEFAULTS: '1', SHARED: 'defaults-loses' } } },
        },
      },
    });
    expect(r.agent.env).toEqual({
      TOP: '1',
      DEFAULTS: '1',
      PHASE: '1',
      SHARED: 'phase-wins',
    });
  });

  it('agent.secrets is list-valued: most-specific layer REPLACES (no merge)', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { agent: { secrets: ['PHASE_KEY'] } },
      featureConfig: {
        phases: {
          defaults: { agent: { secrets: ['DEFAULTS_KEY'] } },
        },
      },
    });
    expect(r.agent.secrets).toEqual(['PHASE_KEY']);
  });

  it('container kebab-case YAML keys land as camelCase on resolved config', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: {
        container: {
          'no-leash': true,
          'sandbox-profile': 'python-uv',
          'compose-file': 'docker-compose.phase.yml',
        },
      },
      featureConfig: null,
    });
    expect(r.container.noLeash).toBe(true);
    expect(r.container.sandboxProfile).toBe('python-uv');
    expect(r.container.composeFile).toBe('docker-compose.phase.yml');
  });

  it('runner kebab-case YAML keys land as camelCase on resolved config', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: {
        runner: {
          'test-profile': 'pytest',
          'resolve-ambiguity': 'ai',
          'test-retries': 3,
        },
      },
      featureConfig: null,
    });
    expect(r.runner.testProfile).toBe('pytest');
    expect(r.runner.resolveAmbiguity).toBe('ai');
    expect(r.runner.testRetries).toBe(3);
  });

  it('limits.max-attempts kebab → maxAttempts camel', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { limits: { 'max-attempts': 5 } },
      featureConfig: null,
    });
    expect(r.limits.maxAttempts).toBe(5);
  });

  it('agent.base-url kebab → baseUrl camel', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { agent: { 'base-url': 'https://api.example.com' } },
      featureConfig: null,
    });
    expect(r.agent.baseUrl).toBe('https://api.example.com');
  });

  it('groups with no settings anywhere resolve to empty objects', () => {
    const r = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: null,
    });
    expect(r.gate).toEqual({});
    expect(r.agent).toEqual({});
    expect(r.container).toEqual({});
    expect(r.runner).toEqual({});
    expect(r.limits).toEqual({});
  });

  it('tests.none defaults to false; explicit true is preserved', () => {
    const r1 = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: null,
      featureConfig: null,
    });
    expect(r1.tests.none).toBe(false);

    const r2 = resolvePhaseConfig({
      phaseId: 'p1',
      phaseConfig: { tests: { none: true } },
      featureConfig: null,
    });
    expect(r2.tests.none).toBe(true);
  });
});
