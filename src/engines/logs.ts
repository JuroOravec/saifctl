/**
 * Infrastructure-wide log lines from a {@link Engine} (containers + child stderr).
 * Distinct from {@link AgentLogEvent} (structured agent stdout between sentinels).
 */

export type EngineLogSource = 'staging' | 'test-runner' | 'coder' | 'inspect';

export interface EngineLogEvent {
  source: EngineLogSource;
  stream: 'stdout' | 'stderr';
  /**
   * Docker container name for `[name] line` formatting (staging / test-runner).
   * Omitted for Leash/docker child stderr (coder / inspect).
   */
  containerLabel?: string;
  /** One line (container logs) or arbitrary chunk (child stderr). */
  raw: string;
}

export type EngineOnLog = (event: EngineLogEvent) => void;

/**
 * Default: container lines → stdout with `[label]`; bare coder/inspect stderr → process.stderr.
 *
 * NOTE: This does NOT go through our logging system (consola), because
 * we're streaming 3rd party logs directly.
 */
export function defaultEngineLog(e: EngineLogEvent): void {
  if (e.containerLabel !== undefined) {
    process.stdout.write(`[${e.containerLabel}] ${e.raw}\n`);
    return;
  }
  if (e.stream === 'stderr') {
    process.stderr.write(e.raw);
  } else {
    process.stdout.write(e.raw);
  }
}
