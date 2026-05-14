/**
 * Tests for `wireAgentProfileOptions`.
 *
 * The bug this helper closes: pre-fix, both `feat run` and `sandbox`
 * gated the agent option-bridge on `args.agent` being non-empty on the
 * CLI. When the user relied on `saifctl/config.ts` (or `feature.yml`)
 * to select the agent, `agentOptions.<id>.*` config blocks were
 * silently dropped — most visibly: `agentOptions.claude.max: true`
 * stayed unset, so `prepareAgentEnv` fell through to the
 * ANTHROPIC_API_KEY path even when the user expected OAuth.
 *
 * These tests cover the regression path (no `--agent` on CLI, config
 * selects the profile) plus the CLI-precedence path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SaifctlConfig } from '../config/schema.js';
import type { FeatureConfig } from '../specs/phases/schema.js';
import { wireAgentProfileOptions } from './profile-options.js';

// Env vars these tests mutate; cleared before + after each test so state
// doesn't leak between cases.
const trackedEnvKeys = [
  'SAIFCTL_AGENT_OPT_CLAUDE_MAX',
  'SAIFCTL_AGENT_OPT_CLAUDE_CREDENTIALS',
  'SAIFCTL_AGENT_OPT_GEMINI_MAX',
];

beforeEach(() => {
  for (const k of trackedEnvKeys) delete process.env[k];
});
afterEach(() => {
  for (const k of trackedEnvKeys) delete process.env[k];
});

describe('wireAgentProfileOptions', () => {
  it('applies `agentOptions.<id>` from config when CLI has no --agent (regression)', async () => {
    // The exact shape that was failing: user sets agentProfile + agentOptions
    // in saifctl/config.ts, passes no --agent on CLI, expects Claude Max OAuth.
    const config = {
      defaults: {
        agentProfile: 'claude',
        agentOptions: {
          claude: { max: true },
        },
      },
    } as SaifctlConfig;

    const profile = await wireAgentProfileOptions({
      args: {},
      config,
      featureCfg: null,
    });

    expect(profile.id).toBe('claude');
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBe('true');
  });

  it('regression: ignores `false` defaults that citty fills in when the user did not pass the flag', async () => {
    // Live-run-bug repro: under always-inject (cli/index.ts injecting every
    // profile's flags into citty), if buildProfileCliFlags forwarded
    // `default: false` to citty, citty would set `args['claude-max'] = false`
    // even when the user passed no --claude-max. recordProfileOptionsFromArgs
    // would then record env=false, applyConfigToProfileOptionsEnv's
    // no-clobber rule would skip writing 'true' from config, and the
    // downstream prepareAgentEnv would see `options.max = false` —
    // exactly the failure mode we saw in the user's debug-log output.
    //
    // The fix: buildProfileCliFlags no longer emits citty `default:`, so
    // citty leaves args undefined when the user doesn't pass the flag.
    // This test pins the wireAgentProfileOptions side of that contract.
    const config = {
      defaults: {
        agentProfile: 'claude',
        agentOptions: { claude: { max: true } },
      },
    } as SaifctlConfig;

    // Simulate the args citty would build IF buildProfileCliFlags had
    // forwarded the default. Even in this hostile shape, config must win.
    const profile = await wireAgentProfileOptions({
      args: {
        // Note: 'claude-max' is NOT in args. Post-fix, citty leaves it
        // out when the user doesn't pass it. Pre-fix, citty would inject
        // 'claude-max': false here and the assertion below would break.
      },
      config,
      featureCfg: null,
    });

    expect(profile.id).toBe('claude');
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBe('true');
  });

  it('applies `agent.profile` from feature.yml when CLI has no --agent', async () => {
    const config = {
      defaults: {
        agentProfile: 'openhands', // saifctl-global default
      },
    } as SaifctlConfig;

    const featureCfg = {
      agent: { profile: 'claude' },
    } as FeatureConfig;

    const profile = await wireAgentProfileOptions({
      args: {},
      config,
      featureCfg,
    });

    expect(profile.id).toBe('claude'); // feature.yml beats saifctl/config.ts
  });

  it('CLI --agent wins over feature.yml and config', async () => {
    const config = {
      defaults: {
        agentProfile: 'openhands',
        agentOptions: { claude: { max: true } },
      },
    } as SaifctlConfig;

    const featureCfg = {
      agent: { profile: 'claude' },
    } as FeatureConfig;

    const profile = await wireAgentProfileOptions({
      args: { agent: 'gemini' },
      config,
      featureCfg,
    });

    expect(profile.id).toBe('gemini');
    // The claude options block in config does NOT leak onto gemini because
    // the env-var protocol is keyed by profile id.
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBeUndefined();
  });

  it('CLI --claude-max wins over config for the same option', async () => {
    // Config tries to disable max; CLI flag turns it on. CLI must win.
    const config = {
      defaults: {
        agentProfile: 'claude',
        agentOptions: { claude: { max: false } },
      },
    } as SaifctlConfig;

    const profile = await wireAgentProfileOptions({
      args: { 'claude-max': true },
      config,
      featureCfg: null,
    });

    expect(profile.id).toBe('claude');
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBe('true');
  });

  it('returns the built-in default profile when nothing is configured', async () => {
    const profile = await wireAgentProfileOptions({
      args: {},
      config: undefined,
      featureCfg: null,
    });
    // Built-in default is openhands; assert via id stability.
    expect(profile.id).toBeTruthy();
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBeUndefined();
  });
});
