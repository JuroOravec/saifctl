/**
 * Unit tests for CLI utility functions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseModelOverrides, parseStorageOverrides } from './utils.js';

describe('parseModelOverrides', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // @ts-expect-error allow mock implementation of exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('rejects unknown agent in --model', () => {
    parseModelOverrides({ model: 'bad-agent=openai/gpt-4o' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown agent "bad-agent"'),
    );
  });

  it('rejects unknown agent in --base-url', () => {
    // KEY_EQ_PATTERN (\w+=) only matches keys without hyphens; use badagent so it's parsed as key=value
    parseModelOverrides({ 'base-url': 'badagent=https://api.example.com/v1' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown agent "badagent"'),
    );
  });

  it('accepts valid agent names', () => {
    const overrides = parseModelOverrides({
      model: 'coder=openai/gpt-4o,results-judge=openai/gpt-4o-mini',
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(overrides.agentModels).toEqual({
      coder: 'openai/gpt-4o',
      'results-judge': 'openai/gpt-4o-mini',
    });
  });
});

describe('parseStorageOverrides', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // @ts-expect-error allow mock implementation of exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('rejects unknown storage keys', () => {
    parseStorageOverrides({ storage: 'badkey=local' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('unknown key "badkey"'));
  });

  it('accepts valid storage keys', () => {
    const overrides = parseStorageOverrides({
      storage: 'runs=local,tasks=s3://bucket/tasks',
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(overrides.storages).toEqual({
      runs: 'local',
      tasks: 's3://bucket/tasks',
    });
  });
});
