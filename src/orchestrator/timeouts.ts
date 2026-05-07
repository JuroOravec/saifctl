/**
 * Timeout configuration: parsing, formatting, and CLI/config resolution.
 *
 * Two independent timeouts gate `feat run`:
 *
 *   - **Run timeout** (`runMs`): wall-clock from the start of `feat run` (or
 *     `run start <id>` resume) until completion. Default: unbounded (`null`).
 *     Wraps the entire iterative loop in a top-level AbortController.
 *
 *   - **Subtask timeout** (`subtaskMs`): wall-clock per individual subtask.
 *     Resets when a new subtask becomes active (prompt-write); fires if the
 *     subtask-done signal isn't received within the budget. Default: 1 hour.
 *     `null` disables the per-subtask timer entirely (only the run timer
 *     remains, if set).
 *
 * Both timeouts, when fired, abort the run with the same save-artifact-and-
 * resume semantics as an in-container error. `saifctl run start <id>` resumes
 * from the last successful subtask cursor.
 *
 * Replaces the previously-hardcoded `AGENT_TIMEOUT_MS = 20 * 60 * 1000`
 * constant in `src/engines/{docker,local}/index.ts`. That constant was a
 * container-lifetime watchdog masquerading as a per-subtask timeout — it
 * caused phased-feature runs (177+ subtasks for saifdocs) to fail at the
 * 20-minute mark regardless of individual subtask health.
 */

/** Resolved, internal-shape timeouts. `null` = unbounded (run) / disabled (subtask). */
export interface TimeoutsConfig {
  /** Total wall-clock budget for the whole run; `null` = unbounded (default). */
  runMs: number | null;
  /** Per-subtask wall-clock budget; `null` = disabled. Default: 1 hour. */
  subtaskMs: number | null;
}

/** User-facing input shape — string duration, raw ms, `'none'`/`null` for unbounded, `undefined` for "use default". */
export type TimeoutInput = number | string | null | undefined;

/** Built-in defaults. `runMs` is unbounded so users opt in to a hard cap; `subtaskMs` defaults to 1h to catch a hung agent fast. */
export const DEFAULT_TIMEOUTS: TimeoutsConfig = {
  runMs: null,
  subtaskMs: 60 * 60 * 1000,
};

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

/**
 * Parse a {@link TimeoutInput} into a `number | null`.
 *
 * Accepts:
 *   - `null` → `null` (unbounded)
 *   - `'none'` / `'NONE'` (case-insensitive) → `null`
 *   - a finite non-negative `number` → that number, treated as ms
 *   - a string of digits → parsed as integer ms (e.g. `'3600000'` → `3600000`)
 *   - a duration string like `'1h'`, `'90m'`, `'30s'`, `'1h30m'`, `'2h15m30s'`
 *     (compounding allowed, units must appear in non-increasing order)
 *
 * Throws `TypeError` on `undefined` (caller must decide default vs. explicit unset).
 * Throws `Error` on any other malformed input.
 */
export function parseDuration(input: TimeoutInput, fieldLabel: string): number | null {
  if (input === undefined) {
    throw new TypeError(
      `parseDuration(${fieldLabel}): got undefined; the caller should resolve the default before calling`,
    );
  }
  if (input === null) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || !Number.isInteger(input)) {
      throw new Error(
        `${fieldLabel}: expected a non-negative integer (milliseconds), got ${String(input)}`,
      );
    }
    return input;
  }

  // String form. Strip + lowercase for unit parsing.
  const raw = input.trim();
  if (raw === '') {
    throw new Error(
      `${fieldLabel}: empty string is not a valid duration (use 'none' for unbounded)`,
    );
  }
  if (raw.toLowerCase() === 'none') return null;

  // Bare digits → treat as ms.
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${fieldLabel}: invalid numeric duration "${input}"`);
    }
    return n;
  }

  // Duration grammar: <int><unit> (s|m|h), compounding e.g. 1h30m. Unit may
  // not repeat. We accept any order to avoid surprising users, but values
  // are summed.
  const lower = raw.toLowerCase();
  const re = /(\d+)\s*([smh])/g;
  let match: RegExpExecArray | null;
  let total = 0;
  let consumed = 0;
  const seenUnits = new Set<string>();
  while ((match = re.exec(lower)) !== null) {
    const [whole, digits, unit] = match;
    if (seenUnits.has(unit)) {
      throw new Error(`${fieldLabel}: unit '${unit}' appears more than once in "${input}"`);
    }
    seenUnits.add(unit);
    const n = Number(digits);
    total += n * (UNIT_MS[unit] ?? 0);
    consumed += whole.length;
  }
  // Reject anything left over that isn't whitespace.
  const leftover = lower.replace(re, '').trim();
  if (consumed === 0 || leftover.length > 0) {
    throw new Error(
      `${fieldLabel}: could not parse "${input}" as a duration. ` +
        `Use 'none', a millisecond integer (3600000), or units (1h / 90m / 30s / 1h30m).`,
    );
  }
  return total;
}

/**
 * Format a millisecond duration as a compact human string.
 * Used in log/error messages so timeouts read naturally.
 *
 * Examples: `0` → `'0s'`, `5400000` → `'1h30m'`, `null` → `'unbounded'`.
 */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return 'unbounded';
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / UNIT_MS.h);
  const m = Math.floor((ms - h * UNIT_MS.h) / UNIT_MS.m);
  const s = Math.floor((ms - h * UNIT_MS.h - m * UNIT_MS.m) / UNIT_MS.s);
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  // Sub-second case: show ms.
  if (parts.length === 0) parts.push(`${ms}ms`);
  return parts.join('');
}

/** Inputs to {@link resolveTimeouts}. CLI > config > built-in default. */
export interface ResolveTimeoutsParams {
  /** Raw `--run-timeout` flag value (string), if provided. */
  cliRun?: TimeoutInput;
  /** Raw `--subtask-timeout` flag value (string), if provided. */
  cliSubtask?: TimeoutInput;
  /** Resolved `defaults.timeouts.run` from the saifctl config file, if any. */
  configRun?: TimeoutInput;
  /** Resolved `defaults.timeouts.subtask` from the saifctl config file, if any. */
  configSubtask?: TimeoutInput;
}

/**
 * Cascade-resolve the effective timeouts. Resolution order, highest priority
 * first:
 *
 *   1. CLI flag (`cliRun` / `cliSubtask`)
 *   2. Config file (`configRun` / `configSubtask`)
 *   3. Built-in default ({@link DEFAULT_TIMEOUTS})
 *
 * `undefined` at a layer means "fall through". `null` and `'none'` are
 * **explicit** unbounded/disabled values — they DO take effect when set at a
 * higher layer (so a CLI flag of `none` overrides a config that sets a
 * bound).
 */
export function resolveTimeouts(params: ResolveTimeoutsParams = {}): TimeoutsConfig {
  const runMs =
    params.cliRun !== undefined
      ? parseDuration(params.cliRun, '--run-timeout')
      : params.configRun !== undefined
        ? parseDuration(params.configRun, 'defaults.timeouts.run')
        : DEFAULT_TIMEOUTS.runMs;

  const subtaskMs =
    params.cliSubtask !== undefined
      ? parseDuration(params.cliSubtask, '--subtask-timeout')
      : params.configSubtask !== undefined
        ? parseDuration(params.configSubtask, 'defaults.timeouts.subtask')
        : DEFAULT_TIMEOUTS.subtaskMs;

  return { runMs, subtaskMs };
}
