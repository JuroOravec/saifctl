/**
 * OpenHands-specific stdout: `--JSON Event--`-delimited segments inside the agent window,
 * plus CLI formatting for OpenHands JSON event shapes (ActionEvent, ObservationEvent, …).
 */

import type { AgentLogLinePrefix, AgentStdoutStrategy } from '../../orchestrator/logs.js';

/** OpenHands prints this between JSON event blobs; we split on it to get one segment per event. */
const JSON_EVENT_DELIM = '--JSON Event--';

/**
 * Incremental parser: append streaming chunks, emit complete segments (text between delimiters).
 * The trailing fragment after the last delimiter stays in `state.buf` until more data or flush.
 */
function appendInsideWindow(input: {
  state: { buf: string };
  chunk: string;
  emitSegment: (segment: string) => void;
}): void {
  const { state, chunk, emitSegment } = input;
  state.buf += chunk;
  const parts = state.buf.split(JSON_EVENT_DELIM);
  state.buf = parts.pop() ?? '';
  for (const p of parts) {
    if (p.trim()) emitSegment(p);
  }
}

/** End of stream: emit any leftover buffer (partial event or text after last delimiter). */
function flushInsideWindow(input: {
  state: { buf: string };
  emitSegment: (segment: string) => void;
}): void {
  const { state, emitSegment } = input;
  if (state.buf.trim()) emitSegment(state.buf);
  state.buf = '';
}

/**
 * OpenHands emits agent activity as JSON objects (often one per segment, split upstream on
 * `--JSON Event--`). Those blobs are verbose and hard to read in a terminal.
 *
 * This turns a single segment into short human lines: `ActionEvent` → `[think]` snippets plus
 * one `[agent]` / `[inspect]` summary (terminal commands, task tracker, file actions, etc.),
 * drops noisy `ThinkAction`, and surfaces `ObservationEvent` errors. Unknown JSON or parse
 * failures are printed as plain text (line-split) so nothing is lost.
 */
export function formatOpenHandsSegment(segment: string, linePrefix: AgentLogLinePrefix): void {
  const tag = linePrefix === 'inspect' ? 'inspect' : 'agent';
  const trimmed = segment.trim();
  if (!trimmed) return;

  // Prefer structured handling when the segment looks like a single JSON object.
  if (trimmed.startsWith('{')) {
    try {
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      const kind = typeof evt.kind === 'string' ? evt.kind : '';

      if (kind === 'ActionEvent') {
        // Model “thinking” lines first, then one summary line for what the agent did.
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
        // Shape the summary by action type so shells, task lists, and file ops are scannable.
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
          // Redundant with thought[] above; skip to avoid duplicate noise.
          return;
        } else {
          const path = typeof action?.path === 'string' ? ` ${action.path}` : '';
          label = summary || `${actionKind}${path}`;
        }
        process.stdout.write(`[${tag}] ${label}\n`);
      } else if (kind === 'ObservationEvent') {
        // Only surface failed observations; successes are usually redundant with ActionEvent.
        const obs = evt.observation as Record<string, unknown> | undefined;
        if (obs?.is_error === true) {
          const content = obs?.content;
          const first = Array.isArray(content)
            ? (content[0] as Record<string, unknown>)
            : undefined;
          const text = typeof first?.text === 'string' ? first.text : '';
          process.stdout.write(`[${tag}] ✗ error: ${String(text).slice(0, 200)}\n`);
        }
      } else if (trimmed) {
        // Known JSON wrapper but unhandled kind: show raw JSON once rather than dropping it.
        process.stdout.write(`${trimmed}\n`);
      }
      return;
    } catch {
      // Malformed JSON — fall through to line printing below.
    }
  }

  // Non-JSON segments (or JSON parse failure): preserve lines as OpenHands printed them.
  for (const line of trimmed.split('\n')) {
    if (line.trim()) process.stdout.write(`${line}\n`);
  }
}

/** Wired into the orchestrator mux: split on `--JSON Event--`, then pretty-print each piece. */
export const openhandsStdoutStrategy: AgentStdoutStrategy = {
  appendInsideWindow,
  flushInsideWindow,
  formatSegment: formatOpenHandsSegment,
};
