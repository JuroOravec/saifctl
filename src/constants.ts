/**
 * Package-level constants. Prefer a single source of truth for paths that
 * must stay consistent regardless of where the process is invoked from.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the SAIFAC repository root.
 *
 * Resolved from this file's location (src/constants.ts → one level up = SAIFAC root).
 * Use this instead of computing the root from import.meta.url in other modules —
 * that pattern breaks when files live at different depths (e.g. scripts/ vs src/).
 */
export function getSaifRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(dirname(thisFile), '..');
}

/**
 * Workspace-relative path to the per-round agent task file (markdown).
 * Written by coder-start.sh before each inner gate round; read via `$SAIFAC_TASK_PATH`.
 */
export const SAIFAC_TASK_FILE_RELATIVE = '.saifac/task.md';

/** Absolute path to the task file under a workspace root (sandbox `code/` or `/workspace` in-container). */
export function saifacTaskFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.saifac', 'task.md');
}

/** Environment variable names for LLM API keys. At least one must be set for init and agent workflows. */
export const LLM_API_KEYS = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'DASHSCOPE_API_KEY',
] as const;

// ---------------------------------------------------------------------------
// Orchestrator defaults
// ---------------------------------------------------------------------------

/** Max full pipeline runs before giving up when not set via CLI or config. */
export const DEFAULT_ORCHESTRATOR_MAX_RUNS = 5;

/** Full test suite re-runs on failure when not set via CLI or config. */
export const DEFAULT_ORCHESTRATOR_TEST_RETRIES = 1;

/** Inner gate retries (agent → gate → feedback) when not set via CLI or config. */
export const DEFAULT_ORCHESTRATOR_GATE_RETRIES = 10;

/** Ambiguous-spec handling when not set via CLI or config. */
export const DEFAULT_RESOLVE_AMBIGUITY: 'off' | 'prompt' | 'ai' = 'ai';

/** Host-side dangerous debug when not set via CLI or config. */
export const DEFAULT_DANGEROUS_DEBUG = false;

/** Run the coder container with plain `docker run` (no Leash) when not set via CLI or config. */
export const DEFAULT_DANGEROUS_NO_LEASH = false;

/** Semantic reviewer enabled when not set via CLI or config. */
export const DEFAULT_REVIEWER_ENABLED = true;

/** Bundled Cedar policy when not set via CLI or config. */
export function defaultCedarPolicyPath(): string {
  return join(getSaifRoot(), 'src', 'orchestrator', 'policies', 'default.cedar');
}
