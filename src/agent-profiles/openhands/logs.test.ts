import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatOpenHandsSegment } from './logs.js';

describe('formatOpenHandsSegment', () => {
  let writes: string[];

  beforeEach(() => {
    writes = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses inspect tag when linePrefix is inspect', () => {
    formatOpenHandsSegment(
      '{"kind":"ActionEvent","thought":[],"action":{"kind":"TerminalAction","command":"ls","summary":"run"}}',
      'inspect',
    );
    expect(writes.some((w) => w.includes('[inspect]'))).toBe(true);
    expect(writes.some((w) => w.includes('[agent]'))).toBe(false);
  });
});
