/**
 * Unit tests for agent-runner utilities.
 *
 * Focuses on the pure, side-effect-free helpers that can run without Docker
 * or the filesystem.
 */

import { describe, expect, it, vi } from 'vitest';

import { consola } from '../logger.js';
import { filterAgentEnv } from '../provisioners/docker/agent-log.js';

describe('filterAgentEnv', () => {
  it('passes through non-reserved keys unchanged', () => {
    const input = { AIDER_MODEL: 'gpt-4o', CUSTOM_KEY: 'hello' };
    expect(filterAgentEnv(input)).toEqual(input);
  });

  it('strips SAIFAC_INITIAL_TASK', () => {
    const result = filterAgentEnv({ SAIFAC_INITIAL_TASK: 'evil', SAFE: 'ok' });
    expect(result).not.toHaveProperty('SAIFAC_INITIAL_TASK');
    expect(result).toHaveProperty('SAFE', 'ok');
  });

  it('strips all reserved SAIFAC_* keys', () => {
    const reserved: Record<string, string> = {
      SAIFAC_INITIAL_TASK: '1',
      SAIFAC_GATE_RETRIES: '2',
      SAIFAC_GATE_SCRIPT: '3',
      SAIFAC_STARTUP_SCRIPT: '4',
      SAIFAC_AGENT_SCRIPT: '5',
      SAIFAC_TASK_PATH: '6',
    };
    const result = filterAgentEnv({ ...reserved, USER_KEY: 'keep' });
    for (const key of Object.keys(reserved)) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result).toHaveProperty('USER_KEY', 'keep');
  });

  it('strips any SAIFAC_ prefixed key (prefix-based blocking)', () => {
    const result = filterAgentEnv({ SAIFAC_FUTURE_VAR: 'x', SAIFAC_CUSTOM: 'y', SAFE: 'z' });
    expect(result).not.toHaveProperty('SAIFAC_FUTURE_VAR');
    expect(result).not.toHaveProperty('SAIFAC_CUSTOM');
    expect(result).toHaveProperty('SAFE', 'z');
  });

  it('strips SAIFAC_WORKSPACE_BASE', () => {
    const result = filterAgentEnv({ SAIFAC_WORKSPACE_BASE: '/workspace', KEEP: 'yes' });
    expect(result).not.toHaveProperty('SAIFAC_WORKSPACE_BASE');
    expect(result).toHaveProperty('KEEP', 'yes');
  });

  it('strips LLM_API_KEY, LLM_MODEL, LLM_PROVIDER, and LLM_BASE_URL', () => {
    const result = filterAgentEnv({
      LLM_API_KEY: 'secret',
      LLM_MODEL: 'gpt-4o',
      LLM_PROVIDER: 'anthropic',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      AGENT_SETTING: 'fine',
    });
    expect(result).not.toHaveProperty('LLM_API_KEY');
    expect(result).not.toHaveProperty('LLM_MODEL');
    expect(result).not.toHaveProperty('LLM_PROVIDER');
    expect(result).not.toHaveProperty('LLM_BASE_URL');
    expect(result).toHaveProperty('AGENT_SETTING', 'fine');
  });

  it('strips REVIEWER_LLM_API_KEY, REVIEWER_LLM_MODEL, REVIEWER_LLM_PROVIDER, and REVIEWER_LLM_BASE_URL', () => {
    const result = filterAgentEnv({
      REVIEWER_LLM_API_KEY: 'secret',
      REVIEWER_LLM_MODEL: 'gpt-4o',
      REVIEWER_LLM_PROVIDER: 'anthropic',
      REVIEWER_LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      AGENT_SETTING: 'fine',
    });
    expect(result).not.toHaveProperty('REVIEWER_LLM_API_KEY');
    expect(result).not.toHaveProperty('REVIEWER_LLM_MODEL');
    expect(result).not.toHaveProperty('REVIEWER_LLM_PROVIDER');
    expect(result).not.toHaveProperty('REVIEWER_LLM_BASE_URL');
    expect(result).toHaveProperty('AGENT_SETTING', 'fine');
  });

  it('emits a consola.warn for each stripped key', () => {
    const warn = vi.spyOn(consola, 'warn').mockImplementation(() => {});
    filterAgentEnv({ SAIFAC_INITIAL_TASK: 'x', LLM_API_KEY: 'y', SAFE: 'z' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('SAIFAC_INITIAL_TASK');
    expect(warn.mock.calls[1][0]).toContain('LLM_API_KEY');
    warn.mockRestore();
  });

  it('returns an empty object when all keys are reserved', () => {
    const result = filterAgentEnv({ SAIFAC_INITIAL_TASK: 'x', SAIFAC_WORKSPACE_BASE: 'y' });
    expect(result).toEqual({});
  });

  it('returns an empty object when input is empty', () => {
    expect(filterAgentEnv({})).toEqual({});
  });
});
