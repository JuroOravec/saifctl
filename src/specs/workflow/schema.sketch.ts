/**
 * Block 0.3 — Workflow schema SKETCH (Zod → JSON Schema target).
 *
 * Per implementation-plan.md §3 Block 0 task 0.3: minimal-but-shaped Zod
 * covering the workflow top-level + 2 source types (github / s3) + 2 sink
 * types (s3 / email) + 1 step kind (leaf). Validates the canonical-shape
 * decisions from workflow-api.md §15.28 + custom-keyword preservation per
 * §15.23 H35 Refresh 6 BEFORE Block 1.1 lands the full schema. Replaced
 * wholesale by `src/specs/workflow/schema.ts` once Block 1.1 ships.
 *
 * Source-of-truth for v1 schema is workflow-api.md §4 / §5 / §6 / §7.
 *
 * Custom-keyword channel: per-type credential fields wrap their inner
 * schema in `sensitive(...)`, which encodes a leading tag in the field's
 * description. `saifctl/features/workflow-api/derive-workflow-schema.ts`
 * post-processes the generated JSON Schema to lift the tag into the
 * JSON-Schema-level `x-saifctl-sensitive: true` keyword (matches
 * workflow-api.md §5.3 + implementation-plan.md Block 1.1 metadata).
 */
import { z } from 'zod';

/** Marker prefix on a Zod `.describe()` that the derive script lifts to
 *  `x-saifctl-sensitive: true` on the JSON Schema property. */
export const SENSITIVE_DESCRIBE_TAG = '@saifctl:sensitive';

/** Tags a schema as a sensitive credential field. The marker travels via
 *  the field's description so it survives the Zod → JSON Schema emit;
 *  the derive script strips the marker and adds the JSON Schema custom
 *  keyword. Used on per-type credential fields (§5.3). */
function sensitive<T extends z.ZodTypeAny>(schema: T, doc: string): T {
  return schema.describe(`${SENSITIVE_DESCRIBE_TAG} ${doc}`) as T;
}

// ---------------------------------------------------------------------------
// Resource ID grammar (§15.11) — shared across inputs / sources / sinks /
// steps. CEL-identifier-compatible.
// ---------------------------------------------------------------------------

const RESOURCE_ID_REGEX = /^[a-z][a-z0-9_]*$/;
const resourceIdSchema = z
  .string()
  .min(1)
  .regex(RESOURCE_ID_REGEX, 'must match /^[a-z][a-z0-9_]*$/ (§15.11)');

// ---------------------------------------------------------------------------
// Inputs (§15.24, minimal — full input-type catalogue lands in Block 1.1
// / Block 6).
// ---------------------------------------------------------------------------

const inputSchema = z
  .object({
    type: z.enum(['string', 'number', 'boolean', 'secret']),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Sources (§5) — `github` + `s3`. Discriminated union on `type:` per
// §15.28 point 3.
// ---------------------------------------------------------------------------

const githubSourceSchema = z
  .object({
    id: resourceIdSchema,
    type: z.literal('github'),
    url: z.string().min(1).describe('Repo as `owner/repo` or full URL'),
    ref: z.string().optional().describe('Branch / tag / commit SHA'),
    path: z.string().optional().describe('Sparse-checkout sub-path within the repo'),
    token: sensitive(z.string().optional(), 'GitHub access token'),
    saveAs: z
      .string()
      .min(1)
      .describe('Workspace-relative path; no `/workspace/` prefix; no `..` segments (§5.2)'),
  })
  .strict();

const s3SourceSchema = z
  .object({
    id: resourceIdSchema,
    type: z.literal('s3'),
    uri: z.string().min(1).describe('s3:// URI; trailing `/` denotes a prefix (directory)'),
    region: z.string().min(1).describe('AWS region'),
    endpoint: z.string().optional().describe('S3-compatible endpoint (MinIO / Wasabi / Ceph)'),
    accessKeyId: sensitive(z.string().optional(), 'AWS access key ID'),
    secretAccessKey: sensitive(z.string().optional(), 'AWS secret access key'),
    sessionToken: sensitive(z.string().optional(), 'AWS STS session token'),
    saveAs: z.string().min(1),
  })
  .strict();

const sourceSchema = z.discriminatedUnion('type', [githubSourceSchema, s3SourceSchema]);

// ---------------------------------------------------------------------------
// Sinks (§7) — `s3` + `email`. Discriminated union on `type:` per §15.28
// point 3.
// ---------------------------------------------------------------------------

const s3SinkSchema = z
  .object({
    id: resourceIdSchema,
    type: z.literal('s3'),
    uri: z.string().min(1),
    file: z.string().min(1).describe('Workspace-source file or directory'),
    region: z.string().min(1),
    accessKeyId: sensitive(z.string().optional(), 'AWS access key ID'),
    secretAccessKey: sensitive(z.string().optional(), 'AWS secret access key'),
    after: z.string().min(1).describe('Bare step ref OR CEL predicate (§7.3)'),
  })
  .strict();

const emailSinkSchema = z
  .object({
    id: resourceIdSchema,
    type: z.literal('email'),
    smtp: z
      .object({
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean().optional().describe('true = implicit TLS; default false = STARTTLS'),
        user: z.string().optional(),
        password: sensitive(z.string().optional(), 'SMTP password'),
      })
      .strict(),
    from: z.string().min(1),
    to: z.array(z.string()).min(1),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    bodyHtml: z.boolean().optional(),
    attachments: z.array(z.string()).optional(),
    after: z.string().min(1),
  })
  .strict();

const sinkSchema = z.discriminatedUnion('type', [s3SinkSchema, emailSinkSchema]);

// ---------------------------------------------------------------------------
// Steps (§6) — leaf only in the sketch. If-wrapper and subworkflow kinds
// land in Block 1.1 alongside the presence-of-key discriminator
// (`spec` / `if`+`steps` / `workflow`) per §6.1.
// ---------------------------------------------------------------------------

const exportTypeShorthand = z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object']);
const exportTypeLonghand = z
  .object({
    type: exportTypeShorthand,
  })
  .strict();
const exportEntrySchema = z.union([exportTypeShorthand, exportTypeLonghand]);

const leafStepSchema = z
  .object({
    id: resourceIdSchema,
    spec: z.string().min(1).describe('Inline spec text OR a path to a spec file (§6.3)'),
    if: z.string().optional().describe('CEL predicate (§6.5)'),
    exports: z.record(z.string(), exportEntrySchema).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Workflow top-level (§4 + §15.28).
// ---------------------------------------------------------------------------

const metadataSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const workflowSchema = z
  .object({
    schemaVersion: z.literal(1),
    metadata: metadataSchema,
    inputs: z.record(z.string(), inputSchema).optional(),
    sources: z.array(sourceSchema).optional(),
    steps: z.array(leafStepSchema).min(1),
    sinks: z.array(sinkSchema).optional(),
  })
  .strict();

export type Workflow = z.infer<typeof workflowSchema>;
