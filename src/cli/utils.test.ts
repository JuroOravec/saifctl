/**
 * Unit tests for CLI utility functions.
 */

import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaifacConfig } from '../config/schema.js';
import { consola } from '../logger.js';
import {
  buildOrchestratorCliInputFromFeatArgs,
  type FeatRunArgs,
  readStorageStringFromCli,
  resolveStorageOverrides,
  scriptSourcePathForReporting,
} from './utils.js';

describe('buildOrchestratorCliInputFromFeatArgs', () => {
  it('loads bundled agent scripts for --agent when install/script paths omitted', async () => {
    const cli = await buildOrchestratorCliInputFromFeatArgs({ agent: 'debug' } as FeatRunArgs, {
      projectDir: process.cwd(),
      saifDir: 'saifac',
      config: {} as SaifacConfig,
    });
    expect(cli.agentProfileId).toBe('debug');
    expect(cli.agentInstallScript).toContain('[agent-install/debug]');
    expect(cli.agentScript).toBeTruthy();
  });
});

describe('resolveStorageOverrides', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consolaErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // @ts-expect-error allow mock implementation of exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    consolaErrorSpy = vi.spyOn(consola, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consolaErrorSpy.mockRestore();
  });

  it('rejects unknown storage keys', () => {
    resolveStorageOverrides(readStorageStringFromCli({ storage: 'badkey=local' }), undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consolaErrorSpy).toHaveBeenCalledWith(expect.stringContaining('unknown key "badkey"'));
  });

  it('accepts valid storage keys', () => {
    const overrides = resolveStorageOverrides(
      readStorageStringFromCli({
        storage: 'runs=local,tasks=s3://bucket/tasks',
      }),
      undefined,
    );
    expect(exitSpy).not.toHaveBeenCalled();
    expect(overrides.storages).toEqual({
      runs: 'local',
      tasks: 's3://bucket/tasks',
    });
  });
});

describe('scriptSourcePathForReporting', () => {
  it('returns a relative path when the script is under projectDir', () => {
    const proj = resolve('/tmp/saifac-proj');
    const script = resolve('/tmp/saifac-proj/scripts/hook.sh');
    expect(scriptSourcePathForReporting(proj, script)).toMatch(/scripts[/\\]hook\.sh$/);
  });

  it('returns an absolute path when the script is outside projectDir', () => {
    const proj = resolve('/tmp/saifac-proj');
    const script = resolve('/opt/saifac/builtin.sh');
    expect(scriptSourcePathForReporting(proj, script)).toBe(script);
  });
});
