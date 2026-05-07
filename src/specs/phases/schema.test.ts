/**
 * Unit tests for feature.yml / phase.yml Zod schemas.
 */

import { describe, expect, it } from 'vitest';

import {
  agentConfigSchema,
  containerConfigSchema,
  criticEntrySchema,
  featureConfigSchema,
  gateConfigSchema,
  limitsConfigSchema,
  phaseConfigSchema,
  runnerConfigSchema,
  testsConfigSchema,
} from './schema.js';

describe('criticEntrySchema', () => {
  it('accepts {id, rounds}', () => {
    const r = criticEntrySchema.parse({ id: 'strict', rounds: 2 });
    expect(r).toEqual({ id: 'strict', rounds: 2 });
  });

  it('defaults rounds to 1 when omitted', () => {
    const r = criticEntrySchema.parse({ id: 'paranoid' });
    expect(r.rounds).toBe(1);
  });

  it('rejects rounds < 1', () => {
    expect(() => criticEntrySchema.parse({ id: 'x', rounds: 0 })).toThrow();
    expect(() => criticEntrySchema.parse({ id: 'x', rounds: -1 })).toThrow();
  });

  it('rejects non-integer rounds', () => {
    expect(() => criticEntrySchema.parse({ id: 'x', rounds: 1.5 })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => criticEntrySchema.parse({ id: 'x', extra: true })).toThrow();
  });

  it('rejects invalid id charset', () => {
    expect(() => criticEntrySchema.parse({ id: 'Strict' })).toThrow(/match/);
    expect(() => criticEntrySchema.parse({ id: 'with space' })).toThrow();
    expect(() => criticEntrySchema.parse({ id: '-leading' })).toThrow();
  });
});

describe('testsConfigSchema', () => {
  it('accepts the empty object (all keys optional)', () => {
    expect(testsConfigSchema.parse({})).toEqual({});
  });

  it('accepts mutable / fail2pass / immutable-files', () => {
    const r = testsConfigSchema.parse({
      mutable: true,
      fail2pass: false,
      'immutable-files': ['tests/contract.ts', 'tests/api/**'],
    });
    expect(r.mutable).toBe(true);
    expect(r.fail2pass).toBe(false);
    expect(r['immutable-files']).toEqual(['tests/contract.ts', 'tests/api/**']);
  });

  it("accepts enforce: 'diff-inspection'", () => {
    expect(testsConfigSchema.parse({ enforce: 'diff-inspection' }).enforce).toBe('diff-inspection');
  });

  it("accepts enforce: 'read-only' at the schema layer (validator rejects in v1)", () => {
    // Parses successfully so users can future-proof their config files.
    // validatePhaseGraph (discover.ts) rejects 'read-only' as not implemented.
    expect(testsConfigSchema.parse({ enforce: 'read-only' }).enforce).toBe('read-only');
  });

  it('rejects enforce values outside the enum', () => {
    expect(() => testsConfigSchema.parse({ enforce: 'something-else' })).toThrow();
  });

  it('rejects immutable-files globs with `..` segments', () => {
    expect(() => testsConfigSchema.parse({ 'immutable-files': ['../escape'] })).toThrow();
  });

  it('rejects immutable-files globs that are absolute paths', () => {
    expect(() => testsConfigSchema.parse({ 'immutable-files': ['/abs/path'] })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => testsConfigSchema.parse({ mutable: true, extra: 1 })).toThrow();
  });
});

describe('phaseConfigSchema', () => {
  it('accepts the empty object', () => {
    expect(phaseConfigSchema.parse({})).toEqual({});
  });

  it('accepts critics + spec + tests', () => {
    const r = phaseConfigSchema.parse({
      critics: [{ id: 'paranoid', rounds: 2 }],
      spec: 'spec.md',
      tests: { mutable: true },
    });
    expect(r.critics).toEqual([{ id: 'paranoid', rounds: 2 }]);
    expect(r.spec).toBe('spec.md');
    expect(r.tests?.mutable).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(() => phaseConfigSchema.parse({ foo: 'bar' })).toThrow();
  });

  it("rejects spec paths containing '..' segments", () => {
    expect(() => phaseConfigSchema.parse({ spec: '../sibling/spec.md' })).toThrow(
      /relative to the phase dir/,
    );
  });

  it('rejects absolute spec paths', () => {
    expect(() => phaseConfigSchema.parse({ spec: '/etc/passwd' })).toThrow(
      /relative to the phase dir/,
    );
  });

  it('accepts plain relative spec filenames and subpaths', () => {
    expect(phaseConfigSchema.parse({ spec: 'spec.md' }).spec).toBe('spec.md');
    expect(phaseConfigSchema.parse({ spec: 'docs/spec.md' }).spec).toBe('docs/spec.md');
  });
});

describe('featureConfigSchema', () => {
  it('accepts the empty object', () => {
    expect(featureConfigSchema.parse({})).toEqual({});
  });

  it('accepts the full feature.yml shape from the doc', () => {
    const r = featureConfigSchema.parse({
      critics: [
        { id: 'strict', rounds: 1 },
        { id: 'paranoid', rounds: 1 },
      ],
      tests: { mutable: false, 'immutable-files': [] },
      phases: {
        order: ['01-core', '02-trigger', 'e2e'],
        defaults: {
          critics: [{ id: 'strict', rounds: 1 }],
          tests: { mutable: false, fail2pass: true },
        },
        phases: {
          '01-core': {},
          '02-trigger': { critics: [{ id: 'paranoid', rounds: 2 }] },
        },
      },
    });
    expect(r.phases?.order).toEqual(['01-core', '02-trigger', 'e2e']);
    expect(r.phases?.phases?.['02-trigger']?.critics?.[0]?.id).toBe('paranoid');
  });

  it("rejects phase ids starting with '(' (route-group reserved)", () => {
    expect(() => featureConfigSchema.parse({ phases: { order: ['(auth)'] } })).toThrow(
      /Next\.js-style route groups/,
    );
  });

  it('rejects invalid phase id charset in order', () => {
    expect(() => featureConfigSchema.parse({ phases: { order: ['Phase1'] } })).toThrow(/match/);
  });

  it('rejects invalid phase id keys in inline phases map', () => {
    expect(() => featureConfigSchema.parse({ phases: { phases: { 'BAD ID': {} } } })).toThrow();
  });

  it('rejects unknown top-level keys', () => {
    expect(() => featureConfigSchema.parse({ random: 'x' })).toThrow();
  });

  it('rejects unknown keys inside phases block', () => {
    expect(() => featureConfigSchema.parse({ phases: { random: 'x' } })).toThrow();
  });

  // per-phase-config v1: feature.yml top-level admits the new groups (§6.8).
  it('accepts per-phase-config v1 groups at the feature top level', () => {
    const r = featureConfigSchema.parse({
      gate: { script: 'gate.sh', retries: 3 },
      agent: {
        profile: 'claude',
        env: { FOO: 'bar' },
        secrets: ['API_KEY'],
        model: 'anthropic/claude-opus',
        'base-url': 'https://api.example.com',
        reviewer: false,
      },
      container: {
        startup: 'startup.sh',
        cedar: 'policy.cedar',
        'no-leash': false,
        'sandbox-profile': 'node-pnpm-python',
        engine: 'docker',
      },
      runner: { 'test-profile': 'pytest', 'test-retries': 3 },
      limits: { 'max-attempts': 5 },
    });
    expect(r.gate?.script).toBe('gate.sh');
    expect(r.agent?.['base-url']).toBe('https://api.example.com');
    expect(r.container?.['no-leash']).toBe(false);
    expect(r.runner?.['test-profile']).toBe('pytest');
    expect(r.limits?.['max-attempts']).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config v1 group schemas
// ---------------------------------------------------------------------------

describe('testsConfigSchema — none field (per-phase-config v1)', () => {
  it('accepts none: true / false', () => {
    expect(testsConfigSchema.parse({ none: true }).none).toBe(true);
    expect(testsConfigSchema.parse({ none: false }).none).toBe(false);
  });

  it('accepts none alongside other tests fields (validator warns separately)', () => {
    const r = testsConfigSchema.parse({ none: true, mutable: false, fail2pass: true });
    expect(r.none).toBe(true);
    expect(r.mutable).toBe(false);
  });

  it('rejects non-boolean none', () => {
    expect(() => testsConfigSchema.parse({ none: 'yes' })).toThrow();
  });
});

describe('gateConfigSchema', () => {
  it('accepts the empty object', () => {
    expect(gateConfigSchema.parse({})).toEqual({});
  });

  it('accepts script + retries', () => {
    const r = gateConfigSchema.parse({ script: './gate.sh', retries: 5 });
    expect(r.script).toBe('./gate.sh');
    expect(r.retries).toBe(5);
  });

  it('rejects scripts with `..` or absolute paths (POSIX, Windows, UNC)', () => {
    // POSIX traversal + absolute.
    expect(() => gateConfigSchema.parse({ script: '../escape/gate.sh' })).toThrow();
    expect(() => gateConfigSchema.parse({ script: '/etc/passwd' })).toThrow();
    // Windows-style absolute (forward and backslash) — schema is the first
    // line of defence; running on a non-Windows host doesn't excuse a
    // permissive schema since Saifctl ships cross-platform.
    expect(() => gateConfigSchema.parse({ script: 'C:\\Windows\\System32\\cmd.exe' })).toThrow();
    expect(() => gateConfigSchema.parse({ script: 'C:/Windows/System32/cmd.exe' })).toThrow();
    expect(() => gateConfigSchema.parse({ script: 'd:\\evil.bat' })).toThrow();
    // UNC paths point at a remote share — also out of project by definition.
    expect(() => gateConfigSchema.parse({ script: '\\\\server\\share\\evil.sh' })).toThrow();
  });

  it('rejects retries < 1 / non-integer', () => {
    expect(() => gateConfigSchema.parse({ retries: 0 })).toThrow();
    expect(() => gateConfigSchema.parse({ retries: -1 })).toThrow();
    expect(() => gateConfigSchema.parse({ retries: 1.5 })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => gateConfigSchema.parse({ extra: true })).toThrow();
  });
});

describe('agentConfigSchema', () => {
  it('accepts the empty object', () => {
    expect(agentConfigSchema.parse({})).toEqual({});
  });

  it('accepts every documented field', () => {
    const r = agentConfigSchema.parse({
      profile: 'claude',
      script: 'agent.sh',
      install: 'install.sh',
      env: { FOO: 'bar', BAZ: 'qux' },
      secrets: ['API_KEY', 'TOKEN'],
      model: 'anthropic/claude-opus',
      'base-url': 'https://api.example.com',
      reviewer: false,
    });
    expect(r.profile).toBe('claude');
    expect(r.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
    expect(r.secrets).toEqual(['API_KEY', 'TOKEN']);
    expect(r['base-url']).toBe('https://api.example.com');
  });

  it('rejects script paths with `..` / absolute', () => {
    expect(() => agentConfigSchema.parse({ script: '../sibling.sh' })).toThrow();
    expect(() => agentConfigSchema.parse({ install: '/etc/install.sh' })).toThrow();
  });

  it('rejects invalid env-var names in env keys', () => {
    expect(() => agentConfigSchema.parse({ env: { '1BAD': 'value' } })).toThrow();
    expect(() => agentConfigSchema.parse({ env: { 'has space': 'value' } })).toThrow();
  });

  it('rejects invalid env-var names in secrets', () => {
    expect(() => agentConfigSchema.parse({ secrets: ['1BAD'] })).toThrow();
    expect(() => agentConfigSchema.parse({ secrets: ['has space'] })).toThrow();
  });

  it('rejects camelCase variants of kebab-case keys', () => {
    expect(() => agentConfigSchema.parse({ baseUrl: 'https://x.example.com' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => agentConfigSchema.parse({ extra: true })).toThrow();
  });
});

describe('containerConfigSchema', () => {
  it('accepts the empty object', () => {
    expect(containerConfigSchema.parse({})).toEqual({});
  });

  it('accepts every documented field', () => {
    const r = containerConfigSchema.parse({
      startup: 'startup.sh',
      cedar: 'policy.cedar',
      'no-leash': true,
      'sandbox-profile': 'node-pnpm-python',
      image: 'my-coder:v2',
      engine: 'docker',
      'compose-file': 'docker-compose.yml',
    });
    expect(r['no-leash']).toBe(true);
    expect(r.engine).toBe('docker');
    expect(r['compose-file']).toBe('docker-compose.yml');
  });

  it('rejects engines outside the allowed set', () => {
    expect(() => containerConfigSchema.parse({ engine: 'kubernetes' })).toThrow();
  });

  it('rejects camelCase variants of kebab-case keys', () => {
    expect(() => containerConfigSchema.parse({ noLeash: true })).toThrow();
    expect(() => containerConfigSchema.parse({ sandboxProfile: 'x' })).toThrow();
  });
});

describe('runnerConfigSchema', () => {
  it('accepts every documented field', () => {
    const r = runnerConfigSchema.parse({
      'test-profile': 'pytest',
      'test-image': 'my-runner:v1',
      'test-script': 'test.sh',
      'stage-script': 'stage.sh',
      'resolve-ambiguity': 'ai',
      'test-retries': 3,
    });
    expect(r['test-profile']).toBe('pytest');
    expect(r['resolve-ambiguity']).toBe('ai');
    expect(r['test-retries']).toBe(3);
  });

  it("rejects resolve-ambiguity outside { 'off' | 'prompt' | 'ai' }", () => {
    expect(() => runnerConfigSchema.parse({ 'resolve-ambiguity': 'maybe' })).toThrow();
  });

  it('rejects test-retries < 1', () => {
    expect(() => runnerConfigSchema.parse({ 'test-retries': 0 })).toThrow();
  });

  it('rejects camelCase variants', () => {
    expect(() => runnerConfigSchema.parse({ testProfile: 'pytest' })).toThrow();
  });

  it('rejects runner.test-script / runner.stage-script with `..` or absolute paths (POSIX, Windows, UNC)', () => {
    // The shared `relativePathSchema` flows into the runner script fields;
    // the same defence-in-depth checks that protect `gate.script` and
    // `agent.script` must apply here. (Per-phase-config phase 7.3 review F-J.)
    expect(() => runnerConfigSchema.parse({ 'test-script': '../escape/test.sh' })).toThrow();
    expect(() => runnerConfigSchema.parse({ 'test-script': '/etc/passwd' })).toThrow();
    expect(() =>
      runnerConfigSchema.parse({ 'test-script': 'C:\\Windows\\System32\\cmd.exe' }),
    ).toThrow();
    expect(() => runnerConfigSchema.parse({ 'test-script': 'C:/Windows/cmd.exe' })).toThrow();
    expect(() =>
      runnerConfigSchema.parse({ 'test-script': '\\\\server\\share\\evil.sh' }),
    ).toThrow();

    expect(() => runnerConfigSchema.parse({ 'stage-script': '../sibling.sh' })).toThrow();
    expect(() => runnerConfigSchema.parse({ 'stage-script': '/etc/init' })).toThrow();
    expect(() => runnerConfigSchema.parse({ 'stage-script': 'D:\\evil.bat' })).toThrow();
  });
});

describe('limitsConfigSchema', () => {
  it('accepts max-attempts', () => {
    expect(limitsConfigSchema.parse({ 'max-attempts': 5 })['max-attempts']).toBe(5);
  });

  it('rejects max-attempts < 1', () => {
    expect(() => limitsConfigSchema.parse({ 'max-attempts': 0 })).toThrow();
  });

  it('rejects camelCase maxAttempts', () => {
    expect(() => limitsConfigSchema.parse({ maxAttempts: 5 })).toThrow();
  });
});

describe('phaseConfigSchema — per-phase-config v1 groups', () => {
  it('accepts all five groups in one phase config', () => {
    const r = phaseConfigSchema.parse({
      gate: { script: 'gate.sh', retries: 3 },
      agent: { profile: 'claude', env: { FOO: 'bar' } },
      container: { engine: 'docker' },
      runner: { 'test-retries': 2 },
      limits: { 'max-attempts': 5 },
    });
    expect(r.gate?.script).toBe('gate.sh');
    expect(r.agent?.profile).toBe('claude');
    expect(r.container?.engine).toBe('docker');
    expect(r.runner?.['test-retries']).toBe(2);
    expect(r.limits?.['max-attempts']).toBe(5);
  });

  it('rejects unknown sub-keys within a group', () => {
    expect(() => phaseConfigSchema.parse({ gate: { extra: true } })).toThrow();
    expect(() => phaseConfigSchema.parse({ agent: { unknown: 'x' } })).toThrow();
  });
});
