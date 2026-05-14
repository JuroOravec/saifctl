#!/usr/bin/env tsx
/**
 * Block 0.3 — Derive `workflow-schema.json` from the Zod sketch.
 *
 * Per workflow-api.md §15.28 point 6 (Zod is the source of truth, JSON
 * Schema is derived) + §15.23 H35 Refresh 6. Replaced wholesale once
 * Block 1.1's full schema ships; the build wiring carries forward.
 *
 * Side-channel: properties tagged via `sensitive(...)` in the Zod sketch
 * carry a `@saifctl:sensitive` prefix on their JSON-Schema `description`.
 * The post-pass below strips the prefix and lifts it to the custom
 * `x-saifctl-sensitive: true` keyword that Block 0.5's Pydantic codegen
 * (and any future JSON-Schema validators) read.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zodToJsonSchema } from 'zod-to-json-schema';

import { SENSITIVE_DESCRIBE_TAG, workflowSchema } from '../src/specs/workflow/schema.sketch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../saifctl/features/workflow-api/workflow-schema.json');

const jsonSchema = zodToJsonSchema(workflowSchema, {
  name: 'Workflow',
  $refStrategy: 'root',
  target: 'jsonSchema7',
});

/** zod-to-json-schema emits `discriminatedUnion` as `anyOf` with no
 *  OpenAPI-style `discriminator` keyword. datamodel-codegen needs the
 *  explicit annotation (and `oneOf` framing) to emit
 *  `Annotated[Union[...], Field(discriminator='type')]` on the Python
 *  side — without it Pydantic v2 falls back to smart-union, which works
 *  but produces worse error messages. The post-pass walks the schema
 *  for `anyOf` arrays whose every member is an object with `type:
 *  { const: '<lit>' }`, converts to `oneOf`, and adds
 *  `discriminator: { propertyName: 'type' }`. This is the ~30 LOC
 *  fallback post-processor referenced in implementation-plan.md
 *  Block 0.5. */
function injectDiscriminators(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) injectDiscriminators(child);
    return;
  }
  const obj = node as Record<string, unknown>;
  const anyOf = obj.anyOf;
  if (Array.isArray(anyOf) && anyOf.length >= 2) {
    const allHaveTypeConst = anyOf.every((variant) => {
      if (variant === null || typeof variant !== 'object') return false;
      const v = variant as Record<string, unknown>;
      const props = v.properties;
      if (props === null || typeof props !== 'object') return false;
      const typeProp = (props as Record<string, unknown>).type;
      if (typeProp === null || typeof typeProp !== 'object') return false;
      return typeof (typeProp as Record<string, unknown>).const === 'string';
    });
    if (allHaveTypeConst) {
      obj.oneOf = anyOf;
      delete obj.anyOf;
      obj.discriminator = { propertyName: 'type' };
    }
  }
  for (const v of Object.values(obj)) injectDiscriminators(v);
}

/** Walks the emitted JSON Schema; for any node whose `description`
 *  starts with the SENSITIVE_DESCRIBE_TAG, strip the tag and set
 *  `x-saifctl-sensitive: true`. */
function liftSensitiveTag(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) liftSensitiveTag(child);
    return;
  }
  const obj = node as Record<string, unknown>;
  const desc = obj.description;
  if (typeof desc === 'string' && desc.startsWith(SENSITIVE_DESCRIBE_TAG)) {
    obj['x-saifctl-sensitive'] = true;
    const stripped = desc.slice(SENSITIVE_DESCRIBE_TAG.length).trim();
    if (stripped.length > 0) {
      obj.description = stripped;
    } else {
      delete obj.description;
    }
  }
  for (const v of Object.values(obj)) liftSensitiveTag(v);
}

injectDiscriminators(jsonSchema);
liftSensitiveTag(jsonSchema);

writeFileSync(OUTPUT_PATH, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
