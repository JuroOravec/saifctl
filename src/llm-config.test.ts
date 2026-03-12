/**
 * Unit tests for LLM config resolution and validation.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  isSupportedAgentName,
  resolveAgentLlmConfig,
  SUPPORTED_AGENT_NAMES,
} from './llm-config.js';

describe('llm-config', () => {
  beforeEach(() => {
    // Ensure at least one provider has a key for resolution tests
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });

  describe('isSupportedAgentName', () => {
    it('returns true for supported agents', () => {
      for (const name of SUPPORTED_AGENT_NAMES) {
        expect(isSupportedAgentName(name)).toBe(true);
      }
    });

    it('returns false for unknown agents', () => {
      expect(isSupportedAgentName('bad-agent')).toBe(false);
      expect(isSupportedAgentName('')).toBe(false);
      expect(isSupportedAgentName('Coder')).toBe(false); // case-sensitive
    });
  });

  describe('resolveAgentLlmConfig', () => {
    it('throws for unknown agent name', () => {
      expect(() => resolveAgentLlmConfig('unknown-agent', {})).toThrow(
        /Unknown agent "unknown-agent"/,
      );
      expect(() => resolveAgentLlmConfig('unknown-agent', {})).toThrow(
        new RegExp(SUPPORTED_AGENT_NAMES.join(', ')),
      );
    });

    it('resolves config for supported agent', () => {
      const config = resolveAgentLlmConfig('coder', {});
      expect(config.provider).toBeDefined();
      expect(config.modelId).toBeDefined();
      expect(config.apiKey).toBe('sk-test-key');
    });
  });
});
