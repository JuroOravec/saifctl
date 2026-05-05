import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyConfigToProfileOptionsEnv,
  assertNoGlobalCollisions,
  buildProfileCliFlags,
  envKeyFor,
  readProfileOptionsFromEnv,
  recordProfileOptionsFromArgs,
  validateProfileOptions,
} from './options-bridge.js';
import type { AgentProfile } from './types.js';

const stubProfile = (
  options: AgentProfile['options'],
  overrides: Partial<AgentProfile> = {},
): AgentProfile => ({
  id: 'claude',
  displayName: 'Claude Code',
  stdoutStrategy: null,
  options,
  ...overrides,
});

describe('options-bridge', () => {
  // Snapshot env entries set by these tests so we can restore between runs.
  const trackedEnvKeys = [
    'SAIFCTL_AGENT_OPT_CLAUDE_MAX',
    'SAIFCTL_AGENT_OPT_CLAUDE_CREDENTIALS',
    'SAIFCTL_AGENT_OPT_DEMO_FLAG',
    'SAIFCTL_AGENT_OPT_DEMO_NUM',
  ];

  beforeEach(() => {
    for (const k of trackedEnvKeys) delete process.env[k];
  });
  afterEach(() => {
    for (const k of trackedEnvKeys) delete process.env[k];
  });

  describe('envKeyFor', () => {
    it('uppercases id and option name; replaces hyphens with underscores', () => {
      expect(envKeyFor('claude', 'max')).toBe('SAIFCTL_AGENT_OPT_CLAUDE_MAX');
      expect(envKeyFor('mini-swe-agent', 'foo-bar')).toBe(
        'SAIFCTL_AGENT_OPT_MINI_SWE_AGENT_FOO_BAR',
      );
    });
  });

  describe('buildProfileCliFlags', () => {
    it('returns empty record when profile declares no options', () => {
      const profile = stubProfile([]);
      expect(buildProfileCliFlags(profile)).toEqual({});
    });

    it('builds citty-shape arg defs prefixed with profile id', () => {
      const profile = stubProfile([
        { name: 'max', type: 'boolean', description: 'Use Max', default: false },
        { name: 'credentials', type: 'string', description: 'Path' },
      ]);
      const flags = buildProfileCliFlags(profile);
      expect(flags).toEqual({
        'claude-max': { type: 'boolean', description: 'Use Max', default: false },
        'claude-credentials': { type: 'string', description: 'Path' },
      });
    });

    it('omits default when profile.default is wrong type for option.type', () => {
      const profile = stubProfile([
        // Mistyped default — function should silently drop rather than crash.
        // (Schema would normally guard this, but be defensive.)
        { name: 'flag', type: 'boolean', description: 'x', default: 'yes' as unknown as boolean },
      ]);
      const flags = buildProfileCliFlags(profile);
      expect(flags['claude-flag']).toEqual({ type: 'boolean', description: 'x' });
    });
  });

  describe('recordProfileOptionsFromArgs ↔ readProfileOptionsFromEnv', () => {
    it('round-trips a boolean true', () => {
      const profile = stubProfile([
        { name: 'max', type: 'boolean', description: 'x', default: false },
      ]);
      recordProfileOptionsFromArgs(profile, { 'claude-max': true });
      expect(readProfileOptionsFromEnv(profile)).toEqual({ max: true });
    });

    it('round-trips a string', () => {
      const profile = stubProfile([{ name: 'credentials', type: 'string', description: 'x' }]);
      recordProfileOptionsFromArgs(profile, { 'claude-credentials': '/foo/bar.json' });
      expect(readProfileOptionsFromEnv(profile)).toEqual({ credentials: '/foo/bar.json' });
    });

    it('round-trips a number', () => {
      const profile = stubProfile([{ name: 'num', type: 'number', description: 'x' }], {
        id: 'demo' as AgentProfile['id'],
      });
      recordProfileOptionsFromArgs(profile, { 'demo-num': 42 });
      expect(readProfileOptionsFromEnv(profile)).toEqual({ num: 42 });
    });

    it('falls back to declared default when CLI did not pass a value', () => {
      const profile = stubProfile([
        { name: 'max', type: 'boolean', description: 'x', default: false },
      ]);
      // Don't call record. Read should yield the default.
      expect(readProfileOptionsFromEnv(profile)).toEqual({ max: false });
    });

    it('drops null/undefined values rather than recording empty strings', () => {
      const profile = stubProfile([{ name: 'credentials', type: 'string', description: 'x' }]);
      recordProfileOptionsFromArgs(profile, { 'claude-credentials': undefined });
      expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_CREDENTIALS).toBeUndefined();
    });
  });

  describe('validateProfileOptions', () => {
    it('runs each option validator; errors include the CLI flag name', async () => {
      const profile = stubProfile([
        {
          name: 'credentials',
          type: 'string',
          description: 'x',
          validate: (value) => {
            if (value === 'bad') throw new Error('not allowed');
          },
        },
      ]);
      recordProfileOptionsFromArgs(profile, { 'claude-credentials': 'bad' });
      await expect(validateProfileOptions(profile)).rejects.toThrow(
        /Invalid value for --claude-credentials: not allowed/,
      );
    });

    it('skips options with no validator', async () => {
      const profile = stubProfile([
        { name: 'max', type: 'boolean', description: 'x', default: false },
      ]);
      recordProfileOptionsFromArgs(profile, { 'claude-max': true });
      await expect(validateProfileOptions(profile)).resolves.toBeUndefined();
    });
  });

  describe('applyConfigToProfileOptionsEnv (CLI > config > default precedence)', () => {
    const profile = stubProfile([
      { name: 'max', type: 'boolean', description: 'x', default: false },
      { name: 'credentials', type: 'string', description: 'x' },
    ]);

    it('writes config values when CLI did not pass the flag', () => {
      // No record-from-args call => env is empty.
      applyConfigToProfileOptionsEnv(profile, { max: true, credentials: '/from/config.json' });
      expect(readProfileOptionsFromEnv(profile)).toEqual({
        max: true,
        credentials: '/from/config.json',
      });
    });

    it('CLI value wins over config (config does not overwrite)', () => {
      recordProfileOptionsFromArgs(profile, { 'claude-credentials': '/from/cli.json' });
      applyConfigToProfileOptionsEnv(profile, { credentials: '/from/config.json' });
      expect(readProfileOptionsFromEnv(profile)).toMatchObject({
        credentials: '/from/cli.json',
      });
    });

    it('config fills only the missing keys', () => {
      recordProfileOptionsFromArgs(profile, { 'claude-max': true });
      // CLI set --claude-max but not --claude-credentials. Config provides
      // both; only credentials should land.
      applyConfigToProfileOptionsEnv(profile, { max: false, credentials: '/from/config.json' });
      expect(readProfileOptionsFromEnv(profile)).toEqual({
        max: true, // CLI win
        credentials: '/from/config.json', // config fill
      });
    });

    it('is a no-op when configMap is undefined', () => {
      applyConfigToProfileOptionsEnv(profile, undefined);
      expect(readProfileOptionsFromEnv(profile)).toEqual({
        max: false, // profile default
        credentials: undefined,
      });
    });

    it('silently ignores unknown keys in configMap (forward-compatible)', () => {
      applyConfigToProfileOptionsEnv(profile, {
        max: true,
        unknownKey: 'should-not-throw',
      } as Record<string, string | number | boolean>);
      expect(readProfileOptionsFromEnv(profile)).toMatchObject({ max: true });
      // No SAIFCTL_AGENT_OPT_CLAUDE_UNKNOWNKEY env var was set.
      expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_UNKNOWNKEY).toBeUndefined();
    });

    it('coerces config numbers and booleans to strings via the same env-var protocol', () => {
      const numProfile = stubProfile([{ name: 'num', type: 'number', description: 'x' }], {
        id: 'demo' as AgentProfile['id'],
      });
      applyConfigToProfileOptionsEnv(numProfile, { num: 7 });
      expect(readProfileOptionsFromEnv(numProfile)).toEqual({ num: 7 });
    });
  });

  describe('assertNoGlobalCollisions', () => {
    it('passes when all profile flags are properly namespaced', () => {
      const profile = stubProfile([{ name: 'max', type: 'boolean', description: 'x' }]);
      expect(() =>
        assertNoGlobalCollisions([profile], new Set(['name', 'model', 'storage'])),
      ).not.toThrow();
    });

    it('throws when a profile flag collides with a reserved global flag', () => {
      const profile = stubProfile([{ name: 'max', type: 'boolean', description: 'x' }]);
      // Pretend `--claude-max` is somehow reserved at the global level.
      expect(() => assertNoGlobalCollisions([profile], new Set(['claude-max']))).toThrow(
        /collides with a reserved global flag/,
      );
    });
  });
});
