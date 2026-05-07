import { describe, expect, it, vi } from 'vitest';

import type { GitProvider } from '../../git/types.js';
import * as loggerModule from '../../logger.js';
import type { Feature } from '../../specs/discover.js';
import {
  computeRunCommitsDiffHash,
  defaultHostApplyBranchName,
  HOST_APPLY_DIFF_HASH_LEN,
  pushHostApplyBranch,
  resolveHostApplyBranchName,
} from './apply-patch.js';

describe('host apply branch naming', () => {
  it('computes stable diff hash (length HOST_APPLY_DIFF_HASH_LEN)', () => {
    const commits = [
      { message: 'a', diff: 'diff1\n' },
      { message: 'b', diff: 'diff2\n' },
    ];
    const h = computeRunCommitsDiffHash(commits);
    expect(h).toHaveLength(HOST_APPLY_DIFF_HASH_LEN);
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(computeRunCommitsDiffHash(commits)).toBe(h);
  });

  it('default branch uses saifctl/<feature>-<runId>-<hash>', () => {
    const commits = [{ message: 'a', diff: 'x\n' }];
    const b = defaultHostApplyBranchName({
      featureName: 'my-feature',
      runId: 'r1',
      commits,
    });
    expect(b).toMatch(new RegExp(`^saifctl/my-feature-r1-[0-9a-f]{${HOST_APPLY_DIFF_HASH_LEN}}$`));
  });

  it('resolveHostApplyBranchName uses override when set', () => {
    const commits = [{ message: 'a', diff: 'x\n' }];
    expect(
      resolveHostApplyBranchName({
        featureName: 'f',
        runId: 'r',
        commits,
        targetBranch: 'custom/name',
      }),
    ).toBe('custom/name');
    expect(
      resolveHostApplyBranchName({ featureName: 'f', runId: 'r', commits, targetBranch: null }),
    ).toMatch(new RegExp(`^saifctl/f-r-[0-9a-f]{${HOST_APPLY_DIFF_HASH_LEN}}$`));
  });
});

describe('pushHostApplyBranch — post-apply hint', () => {
  it('when push is null, prints all three follow-up commands with runId interpolated', async () => {
    // Capture consola.log output without depending on real terminal width.
    const captured: string[] = [];
    const logSpy = vi
      .spyOn(loggerModule.consola, 'log')
      .mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });

    try {
      // Minimal fake provider — pushHostApplyBranch only consults it when push is non-null.
      const fakeProvider: Partial<GitProvider> = {};
      await pushHostApplyBranch({
        cwd: '/tmp/nonexistent',
        projectDir: '/tmp/nonexistent',
        branchName: 'saifctl/my-feature-vb8hq1p-4cf733',
        feature: { name: 'my-feature' } as Feature,
        runId: 'vb8hq1p',
        patchFile: '/tmp/nonexistent.patch',
        push: null,
        pr: false,
        gitProvider: fakeProvider as GitProvider,
        llm: {} as never,
      });
    } finally {
      logSpy.mockRestore();
    }

    const joined = captured.join('\n');
    // Branch name appears.
    expect(joined).toMatch(/saifctl\/my-feature-vb8hq1p-4cf733/);
    // All three follow-up paths are mentioned with the runId interpolated.
    expect(joined).toMatch(/saifctl run merge vb8hq1p/);
    expect(joined).toMatch(/saifctl run apply vb8hq1p --push <target>/);
    expect(joined).toMatch(/saifctl run export vb8hq1p/);
  });
});
