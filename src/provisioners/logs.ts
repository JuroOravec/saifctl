/**
 * Infrastructure-wide log lines from a {@link Provisioner} (containers + child stderr).
 * Distinct from {@link AgentLogEvent} (structured agent stdout between sentinels).
 */

export type ProvisionerLogSource = 'staging' | 'test-runner' | 'coder' | 'inspect';

export interface ProvisionerLogEvent {
  source: ProvisionerLogSource;
  stream: 'stdout' | 'stderr';
  /**
   * Docker container name for `[name] line` formatting (staging / test-runner).
   * Omitted for Leash/docker child stderr (coder / inspect).
   */
  containerLabel?: string;
  /** One line (container logs) or arbitrary chunk (child stderr). */
  raw: string;
}

export type ProvisionerOnLog = (event: ProvisionerLogEvent) => void;

/**
 * Default: container lines → stdout with `[label]`; bare coder/inspect stderr → process.stderr.
 *
 * NOTE: This does NOT go through our logging system (consola), because
 * we're streaming 3rd party logs directly.
 */
export function defaultProvisionerLog(e: ProvisionerLogEvent): void {
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
