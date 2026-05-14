/**
 * Block 0.3 — sketch round-trip tests.
 *
 * Parses every workflow under `saifctl/features/workflow-api/
 * workflow-fixtures/` against the Zod sketch. Block 0.5's Pydantic
 * codegen smoke test parses the same fixtures via Pydantic — together
 * they verify the Zod → JSON Schema → Pydantic chain end-to-end
 * (acceptance criterion in implementation-plan.md §3.2).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowSchema } from './schema.sketch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(
  __dirname,
  '../../../saifctl/features/workflow-api/workflow-fixtures',
);

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.workflow.json'))
  .sort();

describe('workflow schema sketch — Zod round-trip', () => {
  it('finds at least three fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of fixtures) {
    it(`parses ${file}`, () => {
      const raw = JSON.parse(readFileSync(resolve(FIXTURES_DIR, file), 'utf8')) as unknown;
      const parsed = workflowSchema.parse(raw);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.metadata.name.length).toBeGreaterThan(0);
    });
  }

  it('rejects an unknown top-level key', () => {
    const bad = {
      schemaVersion: 1,
      metadata: { name: 'bad' },
      steps: [{ id: 'a', spec: 'x' }],
      extraTopLevel: true,
    };
    expect(() => workflowSchema.parse(bad)).toThrow();
  });

  it('rejects an invalid source-type discriminator', () => {
    const bad = {
      schemaVersion: 1,
      metadata: { name: 'bad' },
      sources: [{ id: 'x', type: 'ftp', url: 'foo/bar', saveAs: '/' }],
      steps: [{ id: 'a', spec: 'x' }],
    };
    expect(() => workflowSchema.parse(bad)).toThrow();
  });
});
