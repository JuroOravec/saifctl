/**
 * Unit tests for config schema validation.
 */

import { describe, expect, it } from 'vitest';

import { saifConfigSchema } from './schema.js';

describe('saifConfigSchema', () => {
  describe('agentModels', () => {
    it('accepts valid agent keys', () => {
      const result = saifConfigSchema.parse({
        defaults: {
          agentModels: { coder: 'openai/gpt-4o', 'results-judge': 'openai/gpt-4o-mini' },
        },
      });
      expect(result.defaults?.agentModels).toEqual({
        coder: 'openai/gpt-4o',
        'results-judge': 'openai/gpt-4o-mini',
      });
    });

    it('rejects unknown agent keys', () => {
      expect(() =>
        saifConfigSchema.parse({
          defaults: {
            agentModels: { 'bad-agent': 'openai/gpt-4o' },
          },
        }),
      ).toThrow(/agentModels keys must be one of/);
    });

    it('accepts undefined agentModels', () => {
      const result = saifConfigSchema.parse({ defaults: {} });
      expect(result.defaults?.agentModels).toBeUndefined();
    });
  });

  describe('agentBaseUrls', () => {
    it('accepts valid agent keys', () => {
      const result = saifConfigSchema.parse({
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
        saifConfigSchema.parse({
          defaults: {
            agentBaseUrls: { unknown: 'https://api.example.com/v1' },
          },
        }),
      ).toThrow(/agentBaseUrls keys must be one of/);
    });
  });

  describe('storages', () => {
    it('accepts valid storage keys', () => {
      const result = saifConfigSchema.parse({
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
        saifConfigSchema.parse({
          defaults: {
            storages: { badkey: 'local' },
          },
        }),
      ).toThrow(/storages keys must be one of/);
    });
  });
});
