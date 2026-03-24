/**
 * Unit tests for config schema validation.
 */

import { describe, expect, it } from 'vitest';

import { saifacConfigSchema } from './schema.js';

describe('saifacConfigSchema', () => {
  describe('agentModels', () => {
    it('accepts valid agent keys', () => {
      const result = saifacConfigSchema.parse({
        defaults: {
          agentModels: { coder: 'openai/gpt-4o', 'vague-specs-check': 'openai/gpt-4o-mini' },
        },
      });
      expect(result.defaults?.agentModels).toEqual({
        coder: 'openai/gpt-4o',
        'vague-specs-check': 'openai/gpt-4o-mini',
      });
    });

    it('rejects unknown agent keys', () => {
      expect(() =>
        saifacConfigSchema.parse({
          defaults: {
            agentModels: { 'bad-agent': 'openai/gpt-4o' },
          },
        }),
      ).toThrow(/agentModels keys must be one of/);
    });

    it('accepts undefined agentModels', () => {
      const result = saifacConfigSchema.parse({ defaults: {} });
      expect(result.defaults?.agentModels).toBeUndefined();
    });
  });

  describe('agentBaseUrls', () => {
    it('accepts valid agent keys', () => {
      const result = saifacConfigSchema.parse({
        defaults: {
          agentBaseUrls: { coder: 'https://api.example.com/v1' },
        },
      });
      expect(result.defaults?.agentBaseUrls).toEqual({
        coder: 'https://api.example.com/v1',
      });
    });

    it('rejects unknown agent keys', () => {
      expect(() =>
        saifacConfigSchema.parse({
          defaults: {
            agentBaseUrls: { unknown: 'https://api.example.com/v1' },
          },
        }),
      ).toThrow(/agentBaseUrls keys must be one of/);
    });
  });

  describe('storages', () => {
    it('accepts valid storage keys', () => {
      const result = saifacConfigSchema.parse({
        defaults: {
          storages: { runs: 'local', tasks: 's3://bucket/tasks' },
        },
      });
      expect(result.defaults?.storages).toEqual({
        runs: 'local',
        tasks: 's3://bucket/tasks',
      });
    });

    it('rejects unknown storage keys', () => {
      expect(() =>
        saifacConfigSchema.parse({
          defaults: {
            storages: { badkey: 'local' },
          },
        }),
      ).toThrow(/storages keys must be one of/);
    });
  });
});
