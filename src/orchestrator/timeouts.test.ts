import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMEOUTS,
  formatDurationMs,
  parseDuration,
  resolveTimeouts,
} from './timeouts.js';

describe('parseDuration', () => {
  it('returns null for null input', () => {
    expect(parseDuration(null, 'x')).toBeNull();
  });

  it('returns null for "none" (case-insensitive)', () => {
    expect(parseDuration('none', 'x')).toBeNull();
    expect(parseDuration('NONE', 'x')).toBeNull();
    expect(parseDuration('  none  ', 'x')).toBeNull();
  });

  it('throws on undefined (caller resolves default)', () => {
    expect(() => parseDuration(undefined, 'x')).toThrow(/undefined/);
  });

  it('passes through non-negative integer ms', () => {
    expect(parseDuration(0, 'x')).toBe(0);
    expect(parseDuration(3600000, 'x')).toBe(3_600_000);
  });

  it('rejects negative, fractional, and non-finite numbers', () => {
    expect(() => parseDuration(-1, 'x')).toThrow();
    expect(() => parseDuration(1.5, 'x')).toThrow();
    expect(() => parseDuration(Infinity, 'x')).toThrow();
    expect(() => parseDuration(NaN, 'x')).toThrow();
  });

  it('parses bare numeric strings as ms', () => {
    expect(parseDuration('3600000', 'x')).toBe(3_600_000);
    expect(parseDuration('0', 'x')).toBe(0);
  });

  it('parses single-unit duration strings', () => {
    expect(parseDuration('30s', 'x')).toBe(30_000);
    expect(parseDuration('5m', 'x')).toBe(5 * 60_000);
    expect(parseDuration('1h', 'x')).toBe(60 * 60_000);
  });

  it('parses compound duration strings', () => {
    expect(parseDuration('1h30m', 'x')).toBe(90 * 60_000);
    expect(parseDuration('2h15m30s', 'x')).toBe(2 * 60 * 60_000 + 15 * 60_000 + 30 * 1000);
    expect(parseDuration('1H30M', 'x')).toBe(90 * 60_000); // case-insensitive
  });

  it('rejects empty string', () => {
    expect(() => parseDuration('', 'x')).toThrow(/empty/);
    expect(() => parseDuration('   ', 'x')).toThrow(/empty/);
  });

  it('rejects unknown units and garbage', () => {
    expect(() => parseDuration('5x', 'x')).toThrow();
    expect(() => parseDuration('5d', 'x')).toThrow(); // days not supported
    expect(() => parseDuration('1h trailing junk', 'x')).toThrow();
    expect(() => parseDuration('not-a-duration', 'x')).toThrow();
  });

  it('rejects repeated units in compound forms', () => {
    expect(() => parseDuration('1h2h', 'x')).toThrow(/'h'.*more than once/);
    expect(() => parseDuration('30s30s', 'x')).toThrow();
  });

  it('field label appears in error messages', () => {
    expect(() => parseDuration('garbage', '--run-timeout')).toThrow(/--run-timeout/);
  });
});

describe('formatDurationMs', () => {
  it('returns "unbounded" for null', () => {
    expect(formatDurationMs(null)).toBe('unbounded');
  });

  it('formats sub-second durations as ms', () => {
    expect(formatDurationMs(0)).toBe('0s');
    expect(formatDurationMs(500)).toBe('500ms');
  });

  it('formats whole-unit durations', () => {
    expect(formatDurationMs(30_000)).toBe('30s');
    expect(formatDurationMs(5 * 60_000)).toBe('5m');
    expect(formatDurationMs(60 * 60_000)).toBe('1h');
  });

  it('formats compound durations', () => {
    expect(formatDurationMs(90 * 60_000)).toBe('1h30m');
    expect(formatDurationMs(2 * 60 * 60_000 + 15 * 60_000 + 30 * 1000)).toBe('2h15m30s');
  });

  it('round-trips through parseDuration for common cases', () => {
    for (const ms of [30_000, 60_000, 60 * 60_000, 90 * 60_000, 7200 * 1000]) {
      expect(parseDuration(formatDurationMs(ms), 'x')).toBe(ms);
    }
  });
});

describe('resolveTimeouts', () => {
  it('returns built-in defaults when nothing is provided', () => {
    expect(resolveTimeouts()).toEqual(DEFAULT_TIMEOUTS);
    expect(resolveTimeouts({})).toEqual(DEFAULT_TIMEOUTS);
  });

  it('CLI overrides config (run timeout)', () => {
    const r = resolveTimeouts({ cliRun: '2h', configRun: '8h' });
    expect(r.runMs).toBe(2 * 60 * 60_000);
  });

  it('CLI overrides config (subtask timeout)', () => {
    const r = resolveTimeouts({ cliSubtask: '15m', configSubtask: '1h' });
    expect(r.subtaskMs).toBe(15 * 60_000);
  });

  it('config used when CLI is absent', () => {
    const r = resolveTimeouts({ configRun: '4h', configSubtask: '30m' });
    expect(r.runMs).toBe(4 * 60 * 60_000);
    expect(r.subtaskMs).toBe(30 * 60_000);
  });

  it('explicit "none" CLI overrides bounded config', () => {
    const r = resolveTimeouts({ cliRun: 'none', configRun: '8h' });
    expect(r.runMs).toBeNull();
  });

  it('explicit null CLI overrides bounded config', () => {
    const r = resolveTimeouts({ cliRun: null, configRun: '8h' });
    expect(r.runMs).toBeNull();
  });

  it('accepts raw ms numbers in config', () => {
    const r = resolveTimeouts({ configRun: 60_000, configSubtask: 3600_000 });
    expect(r.runMs).toBe(60_000);
    expect(r.subtaskMs).toBe(3_600_000);
  });

  it('subtask "none" disables the per-subtask timer', () => {
    const r = resolveTimeouts({ cliSubtask: 'none' });
    expect(r.subtaskMs).toBeNull();
  });

  it('default subtask is 1 hour, default run is unbounded', () => {
    expect(DEFAULT_TIMEOUTS.subtaskMs).toBe(60 * 60_000);
    expect(DEFAULT_TIMEOUTS.runMs).toBeNull();
  });
});
