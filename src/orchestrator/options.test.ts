/**
 * Unit tests for orchestrator option merge and LLM CLI delta parsing.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaifctlConfig } from '../config/schema.js';
import { consola } from '../logger.js';
import { DEFAULT_SANDBOX_PROFILE } from '../sandbox-profiles/index.js';
import type { FeatureConfig } from '../specs/phases/schema.js';
import type { OrchestratorOpts } from './modes.js';
import {
  applyEngineCliToOrchestratorOpts,
  normalizeStagingEnvironmentRaw,
  parseEngineCliSpec,
  parseLlmOverridesCliDelta,
  pickAgentInstallScript,
  pickAgentProfile,
  pickAgentScript,
  pickCedarPolicyPath,
  pickDangerousNoLeash,
  pickSandboxProfile,
  pickStartupScript,
  resolveCoderImage,
  resolveCodingEnvironment,
  resolveFeatureLevelScriptPaths,
} from './options.js';

describe('parseLlmOverridesCliDelta', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consolaErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // @ts-expect-error allow mock implementation of exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    consolaErrorSpy = vi.spyOn(consola, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consolaErrorSpy.mockRestore();
  });

  it('rejects unknown agent in --model', () => {
    parseLlmOverridesCliDelta({ model: 'bad-agent=openai/gpt-4o' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consolaErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown agent "bad-agent"'),
    );
  });

  it('rejects unknown agent in --base-url', () => {
    // KEY_EQ_PATTERN (\w+=) only matches keys without hyphens; use badagent so it's parsed as key=value
    parseLlmOverridesCliDelta({ 'base-url': 'badagent=https://api.example.com/v1' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consolaErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown agent "badagent"'),
    );
  });

  it('accepts valid agent names', () => {
    const delta = parseLlmOverridesCliDelta({
      model: 'coder=openai/gpt-4o,vague-specs-check=openai/gpt-4o-mini',
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(delta).toBeDefined();
    expect(delta!.agentModels).toEqual({
      coder: 'openai/gpt-4o',
      'vague-specs-check': 'openai/gpt-4o-mini',
    });
  });
});

describe('parseEngineCliSpec', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consolaErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // @ts-expect-error allow mock implementation of exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    consolaErrorSpy = vi.spyOn(consola, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consolaErrorSpy.mockRestore();
  });

  it('parses global docker for both phases', () => {
    expect(parseEngineCliSpec('docker')).toEqual({ coding: 'docker', staging: 'docker' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('parses global local as coding=local and staging=docker', () => {
    expect(parseEngineCliSpec('local')).toEqual({ coding: 'local', staging: 'docker' });
  });

  it('parses coding=staging pair', () => {
    expect(parseEngineCliSpec('coding=docker,staging=helm')).toEqual({
      coding: 'docker',
      staging: 'helm',
    });
  });

  it('rejects staging=local', () => {
    parseEngineCliSpec('staging=local');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('applyEngineCliToOrchestratorOpts', () => {
  it('reuses staging from file when engine matches docker', () => {
    const config = {
      environments: {
        staging: { engine: 'docker' as const, file: 'ops/compose.yml' },
      },
    } as SaifctlConfig;

    const merged = {
      codingEnvironment: { engine: 'docker' as const },
      stagingEnvironment: normalizeStagingEnvironmentRaw({
        engine: 'helm',
        chart: 'other',
      }),
    } as unknown as OrchestratorOpts;

    applyEngineCliToOrchestratorOpts(merged, config, 'staging=docker');

    expect(merged.stagingEnvironment).toEqual(
      normalizeStagingEnvironmentRaw({
        engine: 'docker',
        file: 'ops/compose.yml',
      }),
    );
  });

  it('drops incompatible staging fields when switching to docker from helm-only file', () => {
    const config = {
      environments: {
        staging: { engine: 'helm' as const, chart: './chart' },
      },
    } as SaifctlConfig;

    const merged = {
      codingEnvironment: { engine: 'docker' as const },
      stagingEnvironment: normalizeStagingEnvironmentRaw({ engine: 'helm', chart: './chart' }),
    } as unknown as OrchestratorOpts;

    applyEngineCliToOrchestratorOpts(merged, config, 'staging=docker');

    expect(merged.stagingEnvironment).toEqual(normalizeStagingEnvironmentRaw({ engine: 'docker' }));
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5c — featureConfig top-level threading.
// Pin the precedence chain for the Level-2/3 pickers:
//   CLI > feature.yml top-level > feature.yml.phases.defaults > saifctl-global > package default
// ---------------------------------------------------------------------------

describe('pickAgentProfile (phase 7.5c — featureConfig precedence)', () => {
  it('CLI flag wins over featureConfig top-level', () => {
    const fc: FeatureConfig = { agent: { profile: 'aider' } };
    expect(pickAgentProfile('claude', undefined, fc).id).toBe('claude');
  });

  it('featureConfig top-level wins over phases.defaults', () => {
    const fc: FeatureConfig = {
      agent: { profile: 'claude' },
      phases: { defaults: { agent: { profile: 'aider' } } },
    };
    expect(pickAgentProfile(undefined, undefined, fc).id).toBe('claude');
  });

  it('featureConfig phases.defaults wins over saifctl-global config', () => {
    const fc: FeatureConfig = { phases: { defaults: { agent: { profile: 'aider' } } } };
    const cfg = { defaults: { agentProfile: 'claude' } } as unknown as SaifctlConfig;
    expect(pickAgentProfile(undefined, cfg, fc).id).toBe('aider');
  });

  it('saifctl-global config wins over package default when no featureConfig', () => {
    const cfg = { defaults: { agentProfile: 'aider' } } as unknown as SaifctlConfig;
    expect(pickAgentProfile(undefined, cfg).id).toBe('aider');
  });

  it('falls through to package default when nothing is set', () => {
    // Don't pin the exact id — just verify a profile is returned (the
    // package default ships with saifctl). Pinning the id couples this
    // test to whichever profile DEFAULT_AGENT_PROFILE points at.
    expect(pickAgentProfile(undefined, undefined).id).toBeTruthy();
  });

  it('back-compat: omitting featureConfig argument keeps previous behaviour', () => {
    const cfg = { defaults: { agentProfile: 'aider' } } as unknown as SaifctlConfig;
    // Two-arg call still works (cli/utils.ts callers don't pass featureConfig).
    expect(pickAgentProfile(undefined, cfg).id).toBe('aider');
  });
});

describe('pickSandboxProfile (phase 7.5c — featureConfig precedence)', () => {
  it('featureConfig container.sandbox-profile wins over saifctl-global', () => {
    const fc: FeatureConfig = { container: { 'sandbox-profile': 'python-uv' } };
    const cfg = { defaults: { sandboxProfile: 'node-pnpm' } } as unknown as SaifctlConfig;
    expect(pickSandboxProfile(undefined, cfg, fc).id).toBe('python-uv');
  });

  it('featureConfig phases.defaults.container.sandbox-profile wins over saifctl-global', () => {
    const fc: FeatureConfig = {
      phases: { defaults: { container: { 'sandbox-profile': 'python-uv' } } },
    };
    const cfg = { defaults: { sandboxProfile: 'node-pnpm' } } as unknown as SaifctlConfig;
    expect(pickSandboxProfile(undefined, cfg, fc).id).toBe('python-uv');
  });

  it('top-level wins over phases.defaults', () => {
    const fc: FeatureConfig = {
      container: { 'sandbox-profile': 'node-pnpm' },
      phases: { defaults: { container: { 'sandbox-profile': 'python-uv' } } },
    };
    expect(pickSandboxProfile(undefined, undefined, fc).id).toBe('node-pnpm');
  });

  it('CLI wins over featureConfig top-level', () => {
    const fc: FeatureConfig = { container: { 'sandbox-profile': 'python-uv' } };
    expect(pickSandboxProfile('node-pnpm', undefined, fc).id).toBe('node-pnpm');
  });

  it('saifctl-global wins over package default when no featureConfig', () => {
    const cfg = { defaults: { sandboxProfile: 'python-uv' } } as unknown as SaifctlConfig;
    expect(pickSandboxProfile(undefined, cfg).id).toBe('python-uv');
  });

  it('falls through to package default when nothing is set', () => {
    expect(pickSandboxProfile(undefined, undefined).id).toBeTruthy();
  });

  it('back-compat: omitting featureConfig argument keeps previous behaviour', () => {
    const cfg = { defaults: { sandboxProfile: 'python-uv' } } as unknown as SaifctlConfig;
    expect(pickSandboxProfile(undefined, cfg).id).toBe('python-uv');
  });
});

describe('pickStartupScript (phase 7.5c — pre-resolved feature value precedence)', () => {
  // The picker now takes the **already script-resolver-resolved** absolute
  // path for the `feature.yml` `container.startup` declaration as its
  // third arg. Pre-resolution happens in `options.ts` via
  // `resolveFeatureLevelScriptPaths` (per review H2). The picker tests
  // here cover precedence only; path-resolution coverage lives in the
  // `resolveFeatureLevelScriptPaths` block below.
  it('feature value wins over saifctl-global config', () => {
    const cfg = { defaults: { startupScript: './global.sh' } } as unknown as SaifctlConfig;
    const pick = pickStartupScript(undefined, cfg, '/abs/feature/my-startup.sh');
    expect(pick).toEqual({ mode: 'path', relativePath: '/abs/feature/my-startup.sh' });
  });

  it('CLI path wins over feature value', () => {
    const pick = pickStartupScript('./cli-startup.sh', undefined, '/abs/feature/yaml-startup.sh');
    expect(pick).toEqual({ mode: 'path', relativePath: './cli-startup.sh' });
  });

  it('saifctl-global wins over package default when no feature value', () => {
    const cfg = { defaults: { startupScript: './global.sh' } } as unknown as SaifctlConfig;
    const pick = pickStartupScript(undefined, cfg, undefined);
    expect(pick).toEqual({ mode: 'path', relativePath: './global.sh' });
  });

  it('CLI wins over saifctl-global with no feature value', () => {
    const cfg = { defaults: { startupScript: './global.sh' } } as unknown as SaifctlConfig;
    const pick = pickStartupScript('./cli-startup.sh', cfg, undefined);
    expect(pick).toEqual({ mode: 'path', relativePath: './cli-startup.sh' });
  });

  it('falls through to bundled profile script when nothing is set', () => {
    expect(pickStartupScript(undefined, undefined)).toEqual({ mode: 'profile' });
  });

  it('back-compat: omitting feature value keeps previous behaviour', () => {
    // Two-arg call still works (cli/utils.ts callers don't pass feature value).
    const cfg = { defaults: { startupScript: './global.sh' } } as unknown as SaifctlConfig;
    expect(pickStartupScript(undefined, cfg)).toEqual({
      mode: 'path',
      relativePath: './global.sh',
    });
  });
});

describe('pickAgentInstallScript (phase 7.5c — pre-resolved feature value precedence)', () => {
  // Same shape as pickStartupScript: caller pre-resolves the feature.yml
  // `agent.install` declaration via `resolveFeatureLevelScriptPaths` and
  // passes the absolute path here.
  it('feature value takes effect', () => {
    expect(pickAgentInstallScript(undefined, undefined, '/abs/feature/my-install.sh')).toEqual({
      mode: 'path',
      relativePath: '/abs/feature/my-install.sh',
    });
  });

  it('CLI path wins over feature value', () => {
    expect(
      pickAgentInstallScript('./cli-install.sh', undefined, '/abs/feature/yaml-install.sh'),
    ).toEqual({
      mode: 'path',
      relativePath: './cli-install.sh',
    });
  });

  // Review N4: saifctl-global `defaults.agentInstallScript` is admitted by
  // the schema; pre-7.5c no picker read it (dead config). Now wired into
  // the picker between feature-value and the bundled fallback.
  it('saifctl-global config wins over bundled profile when nothing else is set', () => {
    const cfg = {
      defaults: { agentInstallScript: './from-config.sh' },
    } as unknown as SaifctlConfig;
    expect(pickAgentInstallScript(undefined, cfg)).toEqual({
      mode: 'path',
      relativePath: './from-config.sh',
    });
  });

  it('feature value wins over saifctl-global config', () => {
    const cfg = {
      defaults: { agentInstallScript: './from-config.sh' },
    } as unknown as SaifctlConfig;
    expect(pickAgentInstallScript(undefined, cfg, '/abs/feature/feat.sh')).toEqual({
      mode: 'path',
      relativePath: '/abs/feature/feat.sh',
    });
  });

  it('CLI wins over saifctl-global config', () => {
    const cfg = {
      defaults: { agentInstallScript: './from-config.sh' },
    } as unknown as SaifctlConfig;
    expect(pickAgentInstallScript('./cli.sh', cfg)).toEqual({
      mode: 'path',
      relativePath: './cli.sh',
    });
  });

  it('falls through to bundled profile script when nothing is set', () => {
    expect(pickAgentInstallScript(undefined)).toEqual({ mode: 'profile' });
  });

  it('back-compat: single-arg call (CLI only) still works', () => {
    expect(pickAgentInstallScript('./cli-install.sh')).toEqual({
      mode: 'path',
      relativePath: './cli-install.sh',
    });
  });
});

describe('pickAgentScript (phase 7.5c — saifctl-global config precedence, review N4)', () => {
  // Pre-7.5c, the picker read CLI only — `defaults.agentScript` was
  // admitted by the schema but unwired (dead config). Now matches the
  // rest of the script pickers. No featureConfig layer because
  // `agent.script` is per-phase Level-1 (handled by the compiler), not
  // per-feature; the run-level baseline only needs CLI + saifctl-global.
  it('saifctl-global config wins over bundled profile when CLI unset', () => {
    const cfg = { defaults: { agentScript: './from-config.sh' } } as unknown as SaifctlConfig;
    expect(pickAgentScript(undefined, cfg)).toEqual({
      mode: 'path',
      relativePath: './from-config.sh',
    });
  });

  it('CLI wins over saifctl-global', () => {
    const cfg = { defaults: { agentScript: './from-config.sh' } } as unknown as SaifctlConfig;
    expect(pickAgentScript('./cli.sh', cfg)).toEqual({ mode: 'path', relativePath: './cli.sh' });
  });

  it('falls through to bundled profile when nothing is set', () => {
    expect(pickAgentScript(undefined)).toEqual({ mode: 'profile' });
  });
});

describe('pickDangerousNoLeash (phase 7.5c — featureConfig precedence)', () => {
  // Boolean field, so we use `??` not `||`. An explicit `false` in
  // featureConfig must beat a saifctl-global `true` — that's the safe
  // direction (a feature that tightens leash enforcement should not be
  // silently overridden by a permissive saifctl-global default).
  it('featureConfig top-level wins over saifctl-global', () => {
    const fc: FeatureConfig = { container: { 'no-leash': true } };
    const cfg = { defaults: { dangerousNoLeash: false } } as unknown as SaifctlConfig;
    expect(pickDangerousNoLeash(cfg, fc)).toBe(true);
  });

  it('explicit `no-leash: false` in featureConfig wins over saifctl-global `true` (security: feature can tighten)', () => {
    const fc: FeatureConfig = { container: { 'no-leash': false } };
    const cfg = { defaults: { dangerousNoLeash: true } } as unknown as SaifctlConfig;
    expect(pickDangerousNoLeash(cfg, fc)).toBe(false);
  });

  it('phases.defaults wins over saifctl-global when top-level is unset', () => {
    const fc: FeatureConfig = {
      phases: { defaults: { container: { 'no-leash': true } } },
    };
    expect(pickDangerousNoLeash(undefined, fc)).toBe(true);
  });

  it('top-level wins over phases.defaults', () => {
    const fc: FeatureConfig = {
      container: { 'no-leash': false },
      phases: { defaults: { container: { 'no-leash': true } } },
    };
    expect(pickDangerousNoLeash(undefined, fc)).toBe(false);
  });

  it('saifctl-global wins over package default when no featureConfig', () => {
    const cfg = { defaults: { dangerousNoLeash: true } } as unknown as SaifctlConfig;
    expect(pickDangerousNoLeash(cfg, null)).toBe(true);
  });

  it('falls through to package default `false` when nothing is set', () => {
    expect(pickDangerousNoLeash(undefined, null)).toBe(false);
  });
});

describe('pickCedarPolicyPath (phase 7.5c — featureConfig precedence)', () => {
  // The picker takes the **already script-resolver-resolved** absolute
  // path for the `feature.yml` `container.cedar` declaration as the
  // featureValueResolvedAbs option. Pre-resolution happens in
  // `options.ts` via `resolveFeatureLevelScriptPaths` (per review H1).
  // The picker tests here cover precedence only.
  it('feature value wins over saifctl-global', () => {
    expect(
      pickCedarPolicyPath({
        saifctlGlobalResolvedAbs: '/abs/global.cedar',
        featureValueResolvedAbs: '/abs/feature/strict.cedar',
      }),
    ).toBe('/abs/feature/strict.cedar');
  });

  it('saifctl-global (pre-resolved) wins over package default when no feature value', () => {
    // After review N5 the picker takes the pre-resolved saifctl-global
    // path directly (caller wraps `resolveSaifctlGlobalCedarPath` /
    // similar containment-checked resolution). Passing `config:` here
    // would do nothing — the picker reads the resolved-abs paths.
    expect(pickCedarPolicyPath({ saifctlGlobalResolvedAbs: '/abs/global.cedar' })).toBe(
      '/abs/global.cedar',
    );
  });

  it('falls through to bundled default Cedar policy when nothing is set', () => {
    const path = pickCedarPolicyPath({});
    // The bundled default lives under the saifctl install dir; assert
    // shape rather than the exact path so this stays portable.
    expect(path).toContain('default.cedar');
  });
});

describe('resolveCoderImage (phase 7.5c — featureConfig precedence)', () => {
  // featureConfig.container.image > saifctl-global config.defaults.coderImage
  // > sandbox-profile bundled image tag.
  it('featureConfig top-level wins over saifctl-global', () => {
    const fc: FeatureConfig = { container: { image: 'my-coder:v2' } };
    const cfg = { defaults: { coderImage: 'global-coder:v1' } } as unknown as SaifctlConfig;
    expect(resolveCoderImage(cfg, DEFAULT_SANDBOX_PROFILE, fc)).toBe('my-coder:v2');
  });

  it('phases.defaults wins over saifctl-global', () => {
    const fc: FeatureConfig = {
      phases: { defaults: { container: { image: 'defaults-coder:v3' } } },
    };
    const cfg = { defaults: { coderImage: 'global-coder:v1' } } as unknown as SaifctlConfig;
    expect(resolveCoderImage(cfg, DEFAULT_SANDBOX_PROFILE, fc)).toBe('defaults-coder:v3');
  });

  it('top-level wins over phases.defaults', () => {
    const fc: FeatureConfig = {
      container: { image: 'top-coder:v4' },
      phases: { defaults: { container: { image: 'defaults-coder:v3' } } },
    };
    expect(resolveCoderImage(undefined, DEFAULT_SANDBOX_PROFILE, fc)).toBe('top-coder:v4');
  });

  it('saifctl-global wins over sandbox-profile bundled tag when no featureConfig', () => {
    const cfg = { defaults: { coderImage: 'global-coder:v1' } } as unknown as SaifctlConfig;
    expect(resolveCoderImage(cfg, DEFAULT_SANDBOX_PROFILE)).toBe('global-coder:v1');
  });

  it('falls through to sandbox-profile bundled tag when nothing is set', () => {
    expect(resolveCoderImage(undefined, DEFAULT_SANDBOX_PROFILE)).toBe(
      DEFAULT_SANDBOX_PROFILE.coderImageTag,
    );
  });
});

describe('resolveCodingEnvironment (phase 7.5c — featureConfig precedence)', () => {
  it('featureConfig container.engine top-level wins over saifctl-global', () => {
    const fc: FeatureConfig = { container: { engine: 'helm' } };
    const cfg = {
      environments: { coding: { engine: 'docker' as const } },
    } as unknown as SaifctlConfig;
    expect(resolveCodingEnvironment(cfg, fc).engine).toBe('helm');
  });

  it('featureConfig phases.defaults engine wins over saifctl-global', () => {
    const fc: FeatureConfig = {
      phases: { defaults: { container: { engine: 'local' } } },
    };
    const cfg = {
      environments: { coding: { engine: 'docker' as const } },
    } as unknown as SaifctlConfig;
    expect(resolveCodingEnvironment(cfg, fc).engine).toBe('local');
  });

  it('featureConfig container.compose-file overrides saifctl-global compose file', () => {
    const fc: FeatureConfig = { container: { 'compose-file': 'feat.yml' } };
    const cfg = {
      environments: { coding: { engine: 'docker' as const, file: 'global.yml' } },
    } as unknown as SaifctlConfig;
    const out = resolveCodingEnvironment(cfg, fc);
    expect(out).toEqual({ engine: 'docker', file: 'feat.yml' });
  });

  it('preserves saifctl-global agentEnvironment carry-over when feature only sets compose-file', () => {
    const fc: FeatureConfig = { container: { 'compose-file': 'feat.yml' } };
    const cfg = {
      environments: {
        coding: { engine: 'docker' as const, agentEnvironment: 'app' },
      },
    } as unknown as SaifctlConfig;
    const out = resolveCodingEnvironment(cfg, fc);
    expect(out).toEqual({ engine: 'docker', file: 'feat.yml', agentEnvironment: 'app' });
  });

  it('returns saifctl-global verbatim when featureConfig declares neither engine nor compose-file', () => {
    const cfg = {
      environments: {
        coding: { engine: 'docker' as const, file: 'global.yml', agentEnvironment: 'app' },
      },
    } as unknown as SaifctlConfig;
    const out = resolveCodingEnvironment(cfg, null);
    expect(out).toEqual({ engine: 'docker', file: 'global.yml', agentEnvironment: 'app' });
  });

  it('falls through to package default `{ engine: docker }` when nothing is set', () => {
    expect(resolveCodingEnvironment(undefined, null)).toEqual({ engine: 'docker' });
  });

  // Review N3: explicit pair pin for top-level vs phases.defaults so a
  // regression in `featureContainerValue`'s `??` chain (e.g. swap to `||`
  // or layer-order swap) can't slip through.
  it('top-level container.engine wins over phases.defaults engine', () => {
    const fc: FeatureConfig = {
      container: { engine: 'helm' },
      phases: { defaults: { container: { engine: 'local' } } },
    };
    expect(resolveCodingEnvironment(undefined, fc).engine).toBe('helm');
  });

  it('top-level container.compose-file wins over phases.defaults compose-file', () => {
    const fc: FeatureConfig = {
      container: { engine: 'docker', 'compose-file': 'top.yml' },
      phases: { defaults: { container: { 'compose-file': 'def.yml' } } },
    };
    const out = resolveCodingEnvironment(undefined, fc);
    expect(out.engine).toBe('docker');
    expect(out.engine === 'docker' && out.file).toBe('top.yml');
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5c — `resolveFeatureLevelScriptPaths` end-to-end.
//
// Spec required an integration test: "a feature with `agent.profile: aider`
// at top-level and no per-phase override actually runs with the Aider
// profile." A real container boot is too heavyweight to mock here, so the
// equivalent pin is: with a real on-disk `feature.yml` declaring
// `agent.install` / `container.startup` / `container.cedar`, the run-level
// baseline really resolves the paths against the feature dir (per design
// §4.3) — closing review H1 (cedar was cwd-relative) and H2 (startup +
// install were project-rooted only).
// ---------------------------------------------------------------------------
describe('resolveFeatureLevelScriptPaths (phase 7.5c — end-to-end script-resolver wiring)', () => {
  let projectDir: string;
  let featureDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'options-7.5c-'));
    featureDir = join(projectDir, 'saifctl', 'features', 'auth');
    await mkdir(featureDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('resolves cedar / startup / install at the FEATURE root, not the project root (H1+H2)', async () => {
    // Files at the feature dir — natural place per design §4.3.
    await writeFile(join(featureDir, 'strict.cedar'), 'permit(...)', 'utf8');
    await writeFile(join(featureDir, 'startup.sh'), '#!/bin/sh\nfeat-startup\n', 'utf8');
    await writeFile(join(featureDir, 'install.sh'), '#!/bin/sh\nfeat-install\n', 'utf8');

    const featureConfig: FeatureConfig = {
      container: { cedar: './strict.cedar', startup: './startup.sh', 'no-leash': false },
      agent: { install: './install.sh' },
    };

    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig,
      featureAbsolutePath: featureDir,
      projectDir,
    });

    // All three resolve to absolute paths under the feature dir.
    expect(resolved.cedar).toBeDefined();
    expect(resolved.cedar!.endsWith('saifctl/features/auth/strict.cedar')).toBe(true);
    expect(resolved.startup!.endsWith('saifctl/features/auth/startup.sh')).toBe(true);
    expect(resolved.install!.endsWith('saifctl/features/auth/install.sh')).toBe(true);
  });

  it('reads from `phases.defaults` when the field is unset at the top level', async () => {
    await writeFile(join(featureDir, 'defaults-cedar.cedar'), 'permit(...)', 'utf8');
    const featureConfig: FeatureConfig = {
      phases: { defaults: { container: { cedar: './defaults-cedar.cedar' } } },
    };
    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    expect(resolved.cedar!.endsWith('/defaults-cedar.cedar')).toBe(true);
  });

  // Review N3: pin the "top-level wins when BOTH layers are set" pair for
  // each script-path field. The picker-layer tests can't exercise this
  // (the pickers take a pre-resolved abs path), so the regression surface
  // lives at the resolver layer. A `??` → `||` regression would slip
  // through the existing fall-through tests for falsy values; an explicit
  // both-set pair is the surface that pins the chain.
  it('top-level wins over phases.defaults when BOTH set container.cedar', async () => {
    await writeFile(join(featureDir, 'top.cedar'), 'top', 'utf8');
    await writeFile(join(featureDir, 'def.cedar'), 'def', 'utf8');
    const featureConfig: FeatureConfig = {
      container: { cedar: './top.cedar' },
      phases: { defaults: { container: { cedar: './def.cedar' } } },
    };
    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    expect(resolved.cedar!.endsWith('/top.cedar')).toBe(true);
  });

  it('top-level wins over phases.defaults when BOTH set container.startup', async () => {
    await writeFile(join(featureDir, 'top-startup.sh'), '#!/bin/sh\n', 'utf8');
    await writeFile(join(featureDir, 'def-startup.sh'), '#!/bin/sh\n', 'utf8');
    const featureConfig: FeatureConfig = {
      container: { startup: './top-startup.sh' },
      phases: { defaults: { container: { startup: './def-startup.sh' } } },
    };
    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    expect(resolved.startup!.endsWith('/top-startup.sh')).toBe(true);
  });

  it('top-level wins over phases.defaults when BOTH set agent.install', async () => {
    await writeFile(join(featureDir, 'top-install.sh'), '#!/bin/sh\n', 'utf8');
    await writeFile(join(featureDir, 'def-install.sh'), '#!/bin/sh\n', 'utf8');
    const featureConfig: FeatureConfig = {
      agent: { install: './top-install.sh' },
      phases: { defaults: { agent: { install: './def-install.sh' } } },
    };
    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    expect(resolved.install!.endsWith('/top-install.sh')).toBe(true);
  });

  it('returns undefined for fields that are not declared anywhere', async () => {
    const featureConfig: FeatureConfig = { agent: { profile: 'claude' } };
    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    expect(resolved.cedar).toBeUndefined();
    expect(resolved.startup).toBeUndefined();
    expect(resolved.install).toBeUndefined();
  });

  it('returns an empty object when featureConfig is null (single-task synthesised path)', async () => {
    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig: null,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    expect(resolved).toEqual({});
  });

  it('exits the process with a clear error when a declared file does not exist (no silent fallthrough)', async () => {
    // Don't create the file; `resolveFeatureLevelScriptPaths` must not
    // silently fall through to a bundled default.
    const featureConfig: FeatureConfig = {
      container: { cedar: './missing.cedar' },
    };

    const exitSpy = vi
      .spyOn(process, 'exit')
      // @ts-expect-error allow void mock for exit
      .mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(consola, 'error').mockImplementation(() => undefined);

    try {
      await resolveFeatureLevelScriptPaths({
        featureConfig,
        featureAbsolutePath: featureDir,
        projectDir,
      });
      expect(exitSpy).toHaveBeenCalledWith(1);
      // The error message should name the field path so the user can fix
      // their feature.yml.
      const calls = errorSpy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((m) => m.includes('container.cedar'))).toBe(true);
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('end-to-end: resolved paths flow into the picker layer with absolute targets', async () => {
    await writeFile(join(featureDir, 'startup.sh'), '#!/bin/sh\n', 'utf8');
    const featureConfig: FeatureConfig = {
      container: { startup: './startup.sh' },
    };

    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    const pick = pickStartupScript(undefined, undefined, resolved.startup);

    expect(pick.mode).toBe('path');
    expect(
      pick.mode === 'path' && pick.relativePath.endsWith('saifctl/features/auth/startup.sh'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5c — integration: a real on-disk `feature.yml`
// loaded by `loadFeatureConfig` flows through to the picker layer (review N2).
//
// Spec.md required: "Integration: a feature with `agent.profile: aider` at
// top-level and no per-phase override actually runs with the Aider profile."
// The picker-level tests above use synthetic `FeatureConfig` objects in
// memory, so a regression in `loadFeatureConfig`'s YAML parse / kebab-case
// handling / shape pass-through wouldn't be caught there. This block writes
// a real `feature.yml` to disk, loads it the same way `applyOrchestratorBaseline`
// does, and asserts the picker chain returns the declared values.
// ---------------------------------------------------------------------------
describe('integration: feature.yml → loadFeatureConfig → pickers (phase 7.5c — N2)', () => {
  let projectDir: string;
  let featureDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'options-7.5c-integ-'));
    featureDir = join(projectDir, 'saifctl', 'features', 'auth');
    await mkdir(featureDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('agent.profile at feature.yml top-level flows through pickAgentProfile', async () => {
    await writeFile(join(featureDir, 'feature.yml'), `agent:\n  profile: aider\n`, 'utf8');

    const { loadFeatureConfig } = await import('../specs/phases/load.js');
    const loaded = await loadFeatureConfig(featureDir);
    const fc = loaded?.config ?? null;

    // The exact assertion the spec.md called out: "actually runs with the
    // Aider profile" — the run-level picker, with no CLI flag and no
    // saifctl-global default, must return Aider.
    const profile = pickAgentProfile(undefined, undefined, fc);
    expect(profile.id).toBe('aider');
  });

  it('container.cedar / container.startup / agent.install flow through resolveFeatureLevelScriptPaths and the pickers', async () => {
    await writeFile(join(featureDir, 'strict.cedar'), 'permit(...)', 'utf8');
    await writeFile(join(featureDir, 'startup.sh'), '#!/bin/sh\nfeat\n', 'utf8');
    await writeFile(join(featureDir, 'install.sh'), '#!/bin/sh\nfeat\n', 'utf8');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `container:\n  cedar: ./strict.cedar\n  startup: ./startup.sh\n  no-leash: false\nagent:\n  install: ./install.sh\n`,
      'utf8',
    );

    const { loadFeatureConfig } = await import('../specs/phases/load.js');
    const loaded = await loadFeatureConfig(featureDir);
    const fc = loaded?.config ?? null;

    const resolved = await resolveFeatureLevelScriptPaths({
      featureConfig: fc,
      featureAbsolutePath: featureDir,
      projectDir,
    });
    const startup = pickStartupScript(undefined, undefined, resolved.startup);
    // Post phase 7.5c review N4 the install picker takes
    // `(cli, saifctlGlobalConfig?, featureResolvedAbs?)`; pass `undefined`
    // for the saifctl-global config so the feature-resolved path wins.
    const install = pickAgentInstallScript(undefined, undefined, resolved.install);
    const cedar = pickCedarPolicyPath({
      featureValueResolvedAbs: resolved.cedar,
    });
    const noLeash = pickDangerousNoLeash(undefined, fc);

    expect(startup.mode === 'path' && startup.relativePath.endsWith('startup.sh')).toBe(true);
    expect(install.mode === 'path' && install.relativePath.endsWith('install.sh')).toBe(true);
    expect(cedar.endsWith('strict.cedar')).toBe(true);
    expect(noLeash).toBe(false);
  });

  it('CLI flag still wins over feature.yml top-level (precedence preserved end-to-end)', async () => {
    await writeFile(join(featureDir, 'feature.yml'), `agent:\n  profile: aider\n`, 'utf8');

    const { loadFeatureConfig } = await import('../specs/phases/load.js');
    const loaded = await loadFeatureConfig(featureDir);
    const fc = loaded?.config ?? null;

    // CLI says claude; feature.yml says aider; CLI must win.
    const profile = pickAgentProfile('claude', undefined, fc);
    expect(profile.id).toBe('claude');
  });
});
