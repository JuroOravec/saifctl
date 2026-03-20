/**
 * Agent log utilities — filtering agentEnv reserved keys and pretty-printing
 * the OpenHands JSON event stream.
 *
 * Extracted from the former agent-runner.ts so DockerProvisioner can import
 * them without circular dependencies.
 */

import { consola } from '../../logger.js';

/**
 * Reserved env var prefixes and keys that must not be overridden by agentEnv.
 */
const RESERVED_ENV_KEYS = new Set([
  'SAIFAC_INITIAL_TASK',
  'SAIFAC_GATE_RETRIES',
  'SAIFAC_GATE_SCRIPT',
  'SAIFAC_REVIEWER_SCRIPT',
  'SAIFAC_STARTUP_SCRIPT',
  'SAIFAC_AGENT_START_SCRIPT',
  'SAIFAC_AGENT_SCRIPT',
  'SAIFAC_TASK_PATH',
  'SAIFAC_WORKSPACE_BASE',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'REVIEWER_LLM_PROVIDER',
  'REVIEWER_LLM_MODEL',
  'REVIEWER_LLM_API_KEY',
  'REVIEWER_LLM_BASE_URL',
]);

/**
 * Filters agentEnv, emitting warnings for any keys that shadow reserved
 * factory variables. Returns a safe copy.
 */
export function filterAgentEnv(agentEnv: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(agentEnv)) {
    if (key.startsWith('SAIFAC_') || RESERVED_ENV_KEYS.has(key)) {
      consola.warn(
        `[agent-runner] WARNING: --agent-env ${key} is a reserved factory variable and will be ignored.`,
      );
      continue;
    }
    result[key] = val;
  }
  return result;
}

/**
 * Prints a segment from OpenHands stdout in a compact, human-readable form.
 *
 * Only called when agentLogFormat === 'openhands'.
 */
export function printOpenHandsSegment(segment: string): void {
  const trimmed = segment.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('{')) {
    try {
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      const kind = typeof evt.kind === 'string' ? evt.kind : '';

      if (kind === 'ActionEvent') {
        const thoughts = Array.isArray(evt.thought)
          ? (evt.thought as Record<string, unknown>[])
          : [];
        for (const t of thoughts) {
          const text = typeof t.text === 'string' ? t.text.trim() : '';
          if (text) process.stdout.write(`[think] ${text.replaceAll('\n', ' ').slice(0, 200)}\n`);
        }

        const action = evt.action as Record<string, unknown> | undefined;
        const summary = typeof evt.summary === 'string' ? evt.summary : '';
        const actionKind = typeof action?.kind === 'string' ? action.kind : '';

        let label: string;
        if (actionKind === 'TerminalAction') {
          const cmd = typeof action?.command === 'string' ? action.command.trim() : '';
          label = summary ? `${summary}: ${cmd.slice(0, 120)}` : `$ ${cmd.slice(0, 140)}`;
        } else if (actionKind === 'TaskTrackerAction') {
          const tasks = Array.isArray(action?.task_list)
            ? (action.task_list as Record<string, unknown>[])
            : [];
          const inProgress = tasks.filter((t) => t.status === 'in_progress').map((t) => t.title);
          const done = tasks.filter((t) => t.status === 'done').map((t) => t.title);
          const parts = [
            done.length ? `✓ ${done.join(', ')}` : '',
            inProgress.length ? `→ ${inProgress.join(', ')}` : '',
          ].filter(Boolean);
          label = parts.length ? parts.join(' | ') : summary || actionKind;
        } else if (actionKind === 'ThinkAction') {
          return;
        } else {
          const path = typeof action?.path === 'string' ? ` ${action.path}` : '';
          label = summary || `${actionKind}${path}`;
        }
        process.stdout.write(`[agent] ${label}\n`);
      } else if (kind === 'ObservationEvent') {
        const obs = evt.observation as Record<string, unknown> | undefined;
        if (obs?.is_error === true) {
          const content = obs?.content;
          const first = Array.isArray(content)
            ? (content[0] as Record<string, unknown>)
            : undefined;
          const text = typeof first?.text === 'string' ? first.text : '';
          process.stdout.write(`[agent] ✗ error: ${String(text).slice(0, 200)}\n`);
        }
      } else if (trimmed) {
        process.stdout.write(`${trimmed}\n`);
      }
      return;
    } catch {
      // Not valid JSON — fall through to plain print
    }
  }

  for (const line of trimmed.split('\n')) {
    if (line.trim()) process.stdout.write(`${line}\n`);
  }
}
