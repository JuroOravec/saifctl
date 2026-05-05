import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyStagedFiles } from './stage-files.js';

describe('applyStagedFiles', () => {
  let saifctlPath: string;

  beforeEach(async () => {
    saifctlPath = await mkdtemp(join(tmpdir(), 'saifctl-stage-test-'));
  });
  afterEach(async () => {
    await rm(saifctlPath, { recursive: true, force: true });
  });

  it('is a no-op (and clears any prior staging) when files is empty', async () => {
    // Pre-populate to verify cleanup
    await applyStagedFiles(saifctlPath, [{ src: { kind: 'inline', content: 'x' }, dst: '/dst' }]);
    await applyStagedFiles(saifctlPath, []);
    await expect(stat(join(saifctlPath, '.stage'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('writes inline content to .stage/<idx> and emits apply.sh', async () => {
    await applyStagedFiles(saifctlPath, [
      {
        src: { kind: 'inline', content: 'hello world' },
        dst: '/etc/foo.txt',
        mode: 0o600,
        owner: 'unpriv',
      },
    ]);

    const stageFile = await readFile(join(saifctlPath, '.stage', '0'), 'utf8');
    expect(stageFile).toBe('hello world');

    const applyScript = await readFile(join(saifctlPath, '.stage', 'apply.sh'), 'utf8');
    expect(applyScript).toContain("cp '/saifctl/.stage/0' '/etc/foo.txt'");
    expect(applyScript).toContain("chmod 600 '/etc/foo.txt'");
    expect(applyScript).toContain('chown "$(id -u "$SAIFCTL_UNPRIV_USER")"');
    expect(applyScript).toMatch(/^#!\/bin\/bash/);
    expect(applyScript).toContain('set -euo pipefail');
  });

  it('reads from a host file path when src.kind is "file"', async () => {
    const hostFile = join(saifctlPath, 'source.txt');
    await (await import('node:fs/promises')).writeFile(hostFile, 'from-host');
    await applyStagedFiles(saifctlPath, [
      {
        src: { kind: 'file', path: hostFile },
        dst: '/dst.txt',
        mode: 0o644,
      },
    ]);
    const staged = await readFile(join(saifctlPath, '.stage', '0'), 'utf8');
    expect(staged).toBe('from-host');
  });

  it('resolves ~/ in dst to the unpriv home shell substitution', async () => {
    await applyStagedFiles(saifctlPath, [
      {
        src: { kind: 'inline', content: 'creds' },
        dst: '~/.claude/.credentials.json',
        mode: 0o600,
        owner: 'unpriv',
      },
    ]);
    const apply = await readFile(join(saifctlPath, '.stage', 'apply.sh'), 'utf8');
    // Should expand ~/ to a `getent passwd` lookup so the apply.sh is portable
    // across different unpriv UIDs declared in different Dockerfile.coder images.
    expect(apply).toContain('getent passwd "$SAIFCTL_UNPRIV_USER"');
    expect(apply).toContain('/.claude/.credentials.json');
  });

  it("chowns the parent dir (recursively) for owner: 'unpriv' before the cp", async () => {
    // Why this matters: mkdir -p as root creates each path level with
    // root:root ownership. Without a follow-up chown, the unpriv user can't
    // write peer files in the parent dir at runtime — e.g. claude-code
    // creates ~/.claude/session-env/ at first run, which fails with EACCES
    // when ~/.claude/ is root-owned.
    await applyStagedFiles(saifctlPath, [
      {
        src: { kind: 'inline', content: 'creds' },
        dst: '/home/saifctl/.claude/.credentials.json',
        mode: 0o600,
        owner: 'unpriv',
      },
    ]);
    const apply = await readFile(join(saifctlPath, '.stage', 'apply.sh'), 'utf8');
    // The apply.sh should chown the parent dir before the cp. Recursive so
    // multi-level mkdir -p creations all end up unpriv-owned.
    expect(apply).toMatch(
      /chown -R "\$\(id -u "\$SAIFCTL_UNPRIV_USER"\)":"\$\(id -g "\$SAIFCTL_UNPRIV_USER"\)" '\/home\/saifctl\/\.claude'\s*\ncp /,
    );
  });

  it('omits chown for owner: root', async () => {
    await applyStagedFiles(saifctlPath, [
      {
        src: { kind: 'inline', content: 'x' },
        dst: '/etc/system.conf',
        mode: 0o644,
        owner: 'root',
      },
    ]);
    const apply = await readFile(join(saifctlPath, '.stage', 'apply.sh'), 'utf8');
    expect(apply).not.toContain('chown');
    expect(apply).toContain("chmod 644 '/etc/system.conf'");
  });

  it('overwrites prior staging on a second invocation (idempotent)', async () => {
    await applyStagedFiles(saifctlPath, [{ src: { kind: 'inline', content: 'first' }, dst: '/a' }]);
    await applyStagedFiles(saifctlPath, [
      { src: { kind: 'inline', content: 'second' }, dst: '/b' },
      { src: { kind: 'inline', content: 'third' }, dst: '/c' },
    ]);
    expect(await readFile(join(saifctlPath, '.stage', '0'), 'utf8')).toBe('second');
    expect(await readFile(join(saifctlPath, '.stage', '1'), 'utf8')).toBe('third');
    // First run's index 0 was overwritten; no stale .stage/1 from the empty
    // prior run beyond what the second run wrote.
    const apply = await readFile(join(saifctlPath, '.stage', 'apply.sh'), 'utf8');
    expect(apply).not.toContain('first');
  });
});
