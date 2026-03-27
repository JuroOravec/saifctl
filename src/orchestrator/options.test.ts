/**
 * Unit tests for orchestrator option merge and model override parsing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consola } from '../logger.js';
import { parseModelOverridesCliDelta } from './options.js';

describe('parseModelOverridesCliDelta', () => {
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
    parseModelOverridesCliDelta({ model: 'bad-agent=openai/gpt-4o' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consolaErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown agent "bad-agent"'),
    );
  });

  it('rejects unknown agent in --base-url', () => {
    // KEY_EQ_PATTERN (\w+=) only matches keys without hyphens; use badagent so it's parsed as key=value
    parseModelOverridesCliDelta({ 'base-url': 'badagent=https://api.example.com/v1' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consolaErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown agent "badagent"'),
    );
  });

  it('accepts valid agent names', () => {
    const overrides = parseModelOverridesCliDelta({
      model: 'coder=openai/gpt-4o,vague-specs-check=openai/gpt-4o-mini',
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(overrides).toBeDefined();
    expect(overrides!.agentModels).toEqual({
      coder: 'openai/gpt-4o',
      'vague-specs-check': 'openai/gpt-4o-mini',
    });
  });
});
