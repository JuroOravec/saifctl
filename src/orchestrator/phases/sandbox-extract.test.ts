import { describe, expect, it } from 'vitest';

import { filterUnifiedDiffByPrefix } from './sandbox-extract.js';

describe('filterUnifiedDiffByPrefix', () => {
  it('keeps sections under includePrefix and drops excludePrefix', () => {
    const patch = [
      'diff --git a/saifctl/features/keep/a.md b/saifctl/features/keep/a.md',
      '--- a/saifctl/features/keep/a.md',
      '+++ b/saifctl/features/keep/a.md',
      '+x',
      '',
      'diff --git a/saifctl/features/exclude/b.md b/saifctl/features/exclude/b.md',
      '--- a/saifctl/features/exclude/b.md',
      '+++ b/saifctl/features/exclude/b.md',
      '+y',
      '',
      'diff --git a/other/c.md b/other/c.md',
      '--- a/other/c.md',
      '+++ b/other/c.md',
      '+z',
    ].join('\n');

    const out = filterUnifiedDiffByPrefix({
      patch,
      includePrefix: 'saifctl/features/',
      excludePrefix: 'saifctl/features/exclude/',
    });

    expect(out).toContain('saifctl/features/keep/a.md');
    expect(out).not.toContain('saifctl/features/exclude/b.md');
    expect(out).not.toContain('other/c.md');
  });

  it('omits exclude when excludePrefix is empty', () => {
    const patch =
      'diff --git a/saifctl/features/a.md b/saifctl/features/a.md\n' +
      '--- a/saifctl/features/a.md\n' +
      '+++ b/saifctl/features/a.md\n';
    const out = filterUnifiedDiffByPrefix({
      patch,
      includePrefix: 'saifctl/features/',
      excludePrefix: '',
    });
    expect(out).toContain('saifctl/features/a.md');
  });
});
