import { describe, expect, it } from 'vitest';

import { appendCliExtraArgs } from './cliArgs.js';

describe('appendCliExtraArgs', () => {
  it('returns base when extra is empty or whitespace', () => {
    expect(appendCliExtraArgs('feat run -n foo', '')).toBe('feat run -n foo');
    expect(appendCliExtraArgs('feat run -n foo', '   \t')).toBe('feat run -n foo');
  });

  it('appends trimmed extra with a single space', () => {
    expect(appendCliExtraArgs('feat run -n foo', '--model x')).toBe('feat run -n foo --model x');
    expect(appendCliExtraArgs('run start abc', '  --no-reviewer  ')).toBe(
      'run start abc --no-reviewer',
    );
  });
});
