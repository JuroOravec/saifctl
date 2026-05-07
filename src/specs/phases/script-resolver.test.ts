/**
 * Tests for the per-phase script-path resolver (per-phase-config phase 7.2).
 *
 * Verifies the phase → feature → project precedence from design §4.3, the
 * out-of-project guard, the typed errors, and the file-content read.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isInsideProject,
  resolveAndReadScript,
  resolveFeatureLevelScriptPath,
  resolveScriptPath,
  ScriptNotARegularFileError,
  ScriptNotFoundError,
  ScriptOutsideProjectError,
} from './script-resolver.js';

let projectDir: string;
let featureDir: string;
let phaseDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'saifctl-script-resolver-'));
  featureDir = join(projectDir, 'saifctl', 'features', 'feat');
  phaseDir = join(featureDir, 'phases', '01-core');
  await mkdir(phaseDir, { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('resolveScriptPath — precedence', () => {
  it('returns the phase-dir match first when the file exists at every level', async () => {
    await writeFile(join(phaseDir, 'gate.sh'), 'phase\n', 'utf8');
    await writeFile(join(featureDir, 'gate.sh'), 'feature\n', 'utf8');
    await writeFile(join(projectDir, 'gate.sh'), 'project\n', 'utf8');

    const r = await resolveScriptPath('gate.sh', {
      phaseAbsolutePath: phaseDir,
      featureAbsolutePath: featureDir,
      projectDir,
      fieldPath: 'gate.script',
    });

    expect(r.resolvedFrom).toBe('phase');
    expect(r.absolutePath).toContain(`${phaseDir}/gate.sh`);
  });

  it('falls back to feature dir when phase dir does not have the file', async () => {
    await writeFile(join(featureDir, 'shared-gate.sh'), 'feature\n', 'utf8');
    await writeFile(join(projectDir, 'shared-gate.sh'), 'project\n', 'utf8');

    const r = await resolveScriptPath('shared-gate.sh', {
      phaseAbsolutePath: phaseDir,
      featureAbsolutePath: featureDir,
      projectDir,
      fieldPath: 'gate.script',
    });

    expect(r.resolvedFrom).toBe('feature');
    expect(r.absolutePath).toContain(`${featureDir}/shared-gate.sh`);
  });

  it('falls back to project dir when neither phase nor feature has the file', async () => {
    await mkdir(join(projectDir, 'scripts'), { recursive: true });
    await writeFile(join(projectDir, 'scripts', 'lint.sh'), 'project\n', 'utf8');

    const r = await resolveScriptPath('scripts/lint.sh', {
      phaseAbsolutePath: phaseDir,
      featureAbsolutePath: featureDir,
      projectDir,
      fieldPath: 'gate.script',
    });

    expect(r.resolvedFrom).toBe('project');
    expect(r.absolutePath).toContain(`${projectDir}/scripts/lint.sh`);
  });
});

describe('resolveScriptPath — error cases', () => {
  it('throws ScriptNotFoundError when the path resolves nowhere', async () => {
    await expect(
      resolveScriptPath('missing.sh', {
        phaseAbsolutePath: phaseDir,
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'gate.script',
      }),
    ).rejects.toBeInstanceOf(ScriptNotFoundError);
  });

  it('ScriptNotFoundError lists every searched location for diagnostics', async () => {
    try {
      await resolveScriptPath('missing.sh', {
        phaseAbsolutePath: phaseDir,
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'gate.script',
      });
      throw new Error('expected ScriptNotFoundError');
    } catch (err) {
      expect(err).toBeInstanceOf(ScriptNotFoundError);
      const e = err as ScriptNotFoundError;
      expect(e.searched).toHaveLength(3);
      expect(e.searched.some((p) => p.startsWith(phaseDir))).toBe(true);
      expect(e.searched.some((p) => p.startsWith(featureDir))).toBe(true);
      expect(e.searched.some((p) => p.startsWith(projectDir))).toBe(true);
    }
  });

  it('ScriptNotFoundError message includes the source label when provided', async () => {
    try {
      await resolveScriptPath('ghost.sh', {
        phaseAbsolutePath: phaseDir,
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'agent.script',
        sourceLabel: 'phase 01-core',
      });
      throw new Error('expected ScriptNotFoundError');
    } catch (err) {
      const e = err as ScriptNotFoundError;
      expect(e.message).toContain('agent.script');
      expect(e.message).toContain('phase 01-core');
    }
  });

  it('throws ScriptOutsideProjectError when an absolute path is passed', async () => {
    await expect(
      resolveScriptPath('/etc/passwd', {
        phaseAbsolutePath: phaseDir,
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'gate.script',
      }),
    ).rejects.toBeInstanceOf(ScriptOutsideProjectError);
  });

  it('throws ScriptNotARegularFileError when the path resolves to a directory', async () => {
    // A user mis-typing `gate.script: somedir/` (with the dir actually
    // existing) should get a clear "not a regular file" error rather than
    // a cryptic EISDIR from the eventual `readUtf8`.
    await mkdir(join(phaseDir, 'gate.sh'), { recursive: true });

    await expect(
      resolveScriptPath('gate.sh', {
        phaseAbsolutePath: phaseDir,
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'gate.script',
      }),
    ).rejects.toBeInstanceOf(ScriptNotARegularFileError);
  });

  it('throws ScriptOutsideProjectError when a symlink escapes the project root', async () => {
    // Create a file outside the project, then symlink to it from inside.
    const outside = await mkdtemp(join(tmpdir(), 'saifctl-script-outside-'));
    try {
      const outsideFile = join(outside, 'gate.sh');
      await writeFile(outsideFile, 'evil\n', 'utf8');
      await symlink(outsideFile, join(phaseDir, 'gate.sh'));

      await expect(
        resolveScriptPath('gate.sh', {
          phaseAbsolutePath: phaseDir,
          featureAbsolutePath: featureDir,
          projectDir,
          fieldPath: 'gate.script',
        }),
      ).rejects.toBeInstanceOf(ScriptOutsideProjectError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('resolveAndReadScript', () => {
  it('returns the file content alongside the resolution metadata', async () => {
    await writeFile(join(phaseDir, 'gate.sh'), '#!/bin/sh\nexit 0\n', 'utf8');

    const r = await resolveAndReadScript('gate.sh', {
      phaseAbsolutePath: phaseDir,
      featureAbsolutePath: featureDir,
      projectDir,
      fieldPath: 'gate.script',
    });

    expect(r.content).toBe('#!/bin/sh\nexit 0\n');
    expect(r.resolvedFrom).toBe('phase');
  });

  it('propagates ScriptNotFoundError when nothing resolves', async () => {
    await expect(
      resolveAndReadScript('missing.sh', {
        phaseAbsolutePath: phaseDir,
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'gate.script',
      }),
    ).rejects.toBeInstanceOf(ScriptNotFoundError);
  });
});

describe('resolveFeatureLevelScriptPath (phase 7.5c)', () => {
  // Sister of resolveScriptPath without the phase root. Used by the
  // run-level baseline in `options.ts` to resolve `feature.yml` /
  // `phases.defaults` Level-2 declarations of cedar / startup / install.
  // Closes review H1 (cedar was passed straight to readUtf8 cwd-relative)
  // and H2 (startup/install were resolved project-rooted only, skipping
  // the design.md §4.3 feature-root step).

  it('returns the feature-dir match when the file lives at the feature root', async () => {
    await writeFile(join(featureDir, 'strict.cedar'), 'permit(...)', 'utf8');
    const r = await resolveFeatureLevelScriptPath('strict.cedar', {
      featureAbsolutePath: featureDir,
      projectDir,
      fieldPath: 'container.cedar',
    });
    expect(r.resolvedFrom).toBe('feature');
    // realpath() resolves /var/folders → /private/var/folders on macOS, so
    // compare via endsWith rather than full equality.
    expect(r.absolutePath.endsWith('saifctl/features/feat/strict.cedar')).toBe(true);
  });

  it('falls back to the project-dir match when the feature dir does not have it', async () => {
    await writeFile(join(projectDir, 'strict.cedar'), 'permit(...)', 'utf8');
    const r = await resolveFeatureLevelScriptPath('strict.cedar', {
      featureAbsolutePath: featureDir,
      projectDir,
      fieldPath: 'container.cedar',
    });
    expect(r.resolvedFrom).toBe('project');
    // Trailing path segment, since macOS realpath() symlink-expands.
    expect(r.absolutePath.endsWith('/strict.cedar')).toBe(true);
    expect(r.absolutePath).not.toContain('/features/');
  });

  it('prefers the feature dir over the project dir when the same path exists at both', async () => {
    await writeFile(join(featureDir, 'startup.sh'), 'feature\n', 'utf8');
    await writeFile(join(projectDir, 'startup.sh'), 'project\n', 'utf8');
    const r = await resolveFeatureLevelScriptPath('startup.sh', {
      featureAbsolutePath: featureDir,
      projectDir,
      fieldPath: 'container.startup',
    });
    expect(r.resolvedFrom).toBe('feature');
  });

  it('throws ScriptNotFoundError when the file is missing at both roots', async () => {
    await expect(
      resolveFeatureLevelScriptPath('missing.sh', {
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'container.startup',
      }),
    ).rejects.toBeInstanceOf(ScriptNotFoundError);
  });

  it('rejects an absolute path with ScriptOutsideProjectError', async () => {
    await expect(
      resolveFeatureLevelScriptPath('/etc/passwd', {
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'container.cedar',
      }),
    ).rejects.toBeInstanceOf(ScriptOutsideProjectError);
  });

  it('rejects a symlink that escapes the project root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'saifctl-out-'));
    try {
      const escapeTarget = join(outside, 'evil.cedar');
      await writeFile(escapeTarget, 'forbid(...)', 'utf8');
      await symlink(escapeTarget, join(featureDir, 'strict.cedar'));
      await expect(
        resolveFeatureLevelScriptPath('strict.cedar', {
          featureAbsolutePath: featureDir,
          projectDir,
          fieldPath: 'container.cedar',
        }),
      ).rejects.toBeInstanceOf(ScriptOutsideProjectError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a directory at the resolved path with ScriptNotARegularFileError', async () => {
    await mkdir(join(featureDir, 'startup.sh'), { recursive: true });
    await expect(
      resolveFeatureLevelScriptPath('startup.sh', {
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'container.startup',
      }),
    ).rejects.toBeInstanceOf(ScriptNotARegularFileError);
  });

  // Critical for review H1: this resolver is the difference between
  // `feature.yml: container: cedar: ./strict.cedar` doing what the user
  // intends (load the file from feature dir) vs. the previous behaviour
  // of `readUtf8('./strict.cedar')` resolving relative to cwd.
  it('does NOT resolve relative to process cwd (the H1 trap shape)', async () => {
    await writeFile(join(featureDir, 'strict.cedar'), 'feature\n', 'utf8');
    // Place a different file at the *cwd* — the resolver must NOT pick it up.
    const cwdEvil = await mkdtemp(join(tmpdir(), 'saifctl-cwd-evil-'));
    const oldCwd = process.cwd();
    try {
      process.chdir(cwdEvil);
      await writeFile(join(cwdEvil, 'strict.cedar'), 'evil\n', 'utf8');
      const r = await resolveFeatureLevelScriptPath('strict.cedar', {
        featureAbsolutePath: featureDir,
        projectDir,
        fieldPath: 'container.cedar',
      });
      expect(r.absolutePath).toContain('/features/feat/strict.cedar');
      expect(r.absolutePath).not.toContain('saifctl-cwd-evil');
    } finally {
      process.chdir(oldCwd);
      await rm(cwdEvil, { recursive: true, force: true });
    }
  });
});

describe('isInsideProject helper', () => {
  it('returns true for paths under the project root', async () => {
    await writeFile(join(phaseDir, 'inside.sh'), 'x', 'utf8');
    expect(await isInsideProject(join(phaseDir, 'inside.sh'), projectDir)).toBe(true);
  });

  it('returns false for paths outside the project root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'saifctl-out-'));
    try {
      const f = join(outside, 'outside.sh');
      await writeFile(f, 'x', 'utf8');
      expect(await isInsideProject(f, projectDir)).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
