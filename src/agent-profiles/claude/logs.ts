/**
 * Claude Code stream-json formatter.
 *
 * `claude -p ... --output-format stream-json` emits one JSON object per
 * newline-delimited line. We split on `\n` (no `--JSON Event--`-style
 * delimiter unlike OpenHands) and format each event into a short, scannable
 * terminal line.
 *
 * Event shapes we surface (extracted from observed runs):
 *
 *   { type: 'assistant', message: { content: [{ type: 'thinking', thinking: "…" }, …] } }
 *     → [think] <first 200 chars>
 *
 *   { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {…} }] } }
 *     → [tool] <Name>(<key args>)
 *
 *   { type: 'assistant', message: { content: [{ type: 'text', text: "…" }] } }
 *     → [agent] <first 200 chars>      (model's natural-language reply)
 *
 *   { type: 'user', message: { content: [{ type: 'tool_result', content: "…" }] } }
 *     → [result] <first 200 chars> (or "[result] <numLines> lines")
 *
 *   { type: 'system', subtype: "…", … }  → [system] <subtype>
 *
 *   { type: 'result', subtype: 'success' | 'error', … } → [done] <subtype>
 *
 * Anything we can't classify falls back to printing the JSON as-is so no
 * information is silently dropped.
 */

import type { AgentLogLinePrefix, AgentStdoutStrategy } from '../../orchestrator/logs.js';

/** Newline-delimited JSON: append, emit complete lines, keep trailing partial. */
function appendInsideWindow(input: {
  state: { buf: string };
  chunk: string;
  emitSegment: (segment: string) => void;
}): void {
  const { state, chunk, emitSegment } = input;
  state.buf += chunk;
  const parts = state.buf.split('\n');
  state.buf = parts.pop() ?? '';
  for (const p of parts) {
    if (p.trim()) emitSegment(p);
  }
}

function flushInsideWindow(input: {
  state: { buf: string };
  emitSegment: (segment: string) => void;
}): void {
  const { state, emitSegment } = input;
  if (state.buf.trim()) emitSegment(state.buf);
  state.buf = '';
}

/** One-line summary of `tool_use.input` for the most common tool names. */
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const path = typeof input.file_path === 'string' ? input.file_path : '';
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  const command = typeof input.command === 'string' ? input.command : '';
  const offset = typeof input.offset === 'number' ? input.offset : undefined;

  switch (name) {
    case 'Read': {
      const off = offset !== undefined ? `:${offset}` : '';
      return path ? `${path}${off}` : '';
    }
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return path;
    case 'Grep': {
      const inPath = typeof input.path === 'string' ? input.path : '';
      return inPath ? `${pattern} in ${inPath}` : pattern;
    }
    case 'Glob': {
      const inPath = typeof input.path === 'string' ? input.path : '';
      return inPath ? `${pattern} in ${inPath}` : pattern;
    }
    case 'Bash':
      return command.replaceAll('\n', ' ').slice(0, 140);
    case 'WebFetch':
      return typeof input.url === 'string' ? input.url : '';
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : [];
      const inProg = todos.filter((t) => t.status === 'in_progress').map((t) => t.content);
      const done = todos.filter((t) => t.status === 'completed').map((t) => t.content);
      const parts = [
        done.length ? `✓ ${done.length}` : '',
        inProg.length ? `→ ${inProg[0]}` : '',
      ].filter(Boolean);
      return parts.join(' | ');
    }
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : '';
      const subtype = typeof input.subagent_type === 'string' ? input.subagent_type : '';
      return [subtype, desc].filter(Boolean).join(': ');
    }
    default: {
      // Generic: pick the first string-valued prop, truncated.
      for (const [k, v] of Object.entries(input)) {
        if (typeof v === 'string' && v.trim()) {
          return `${k}=${v.slice(0, 80)}`;
        }
      }
      return '';
    }
  }
}

/** Truncate a single string for one-line display; collapse newlines to spaces. */
function compact(text: string, max = 200): string {
  const oneLine = text.replaceAll('\n', ' ').replaceAll(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * Format one stream-json event into a short, scannable terminal line.
 * Unknown shapes pass through as raw JSON so nothing is silently lost.
 */
export function formatClaudeSegment(segment: string, linePrefix: AgentLogLinePrefix): void {
  const tag = linePrefix === 'inspect' ? 'inspect' : 'agent';
  const trimmed = segment.trim();
  if (!trimmed) return;

  if (!trimmed.startsWith('{')) {
    // Not JSON: preserve line.
    process.stdout.write(`${trimmed}\n`);
    return;
  }

  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    process.stdout.write(`${trimmed}\n`);
    return;
  }

  const type = typeof evt.type === 'string' ? evt.type : '';

  if (type === 'assistant' || type === 'user') {
    const message = evt.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content)
      ? (message.content as Record<string, unknown>[])
      : [];
    if (content.length === 0) return;

    for (const block of content) {
      const blockType = typeof block.type === 'string' ? block.type : '';
      if (blockType === 'thinking') {
        const t = typeof block.thinking === 'string' ? block.thinking : '';
        if (t) process.stdout.write(`[think] ${compact(t)}\n`);
      } else if (blockType === 'tool_use') {
        const name = typeof block.name === 'string' ? block.name : 'tool';
        const input =
          (block.input as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>);
        const summary = summarizeToolInput(name, input);
        process.stdout.write(`[${tag}] ${name}${summary ? `(${summary})` : ''}\n`);
      } else if (blockType === 'text') {
        const t = typeof block.text === 'string' ? block.text : '';
        if (t.trim()) process.stdout.write(`[${tag}] ${compact(t)}\n`);
      } else if (blockType === 'tool_result') {
        const c = block.content;
        let text = '';
        if (typeof c === 'string') {
          text = c;
        } else if (Array.isArray(c)) {
          // Some tools emit content as [{type:'text', text:'…'}]; stitch together.
          const parts = (c as Record<string, unknown>[])
            .map((p) => (typeof p.text === 'string' ? p.text : ''))
            .filter(Boolean);
          text = parts.join('\n');
        }
        const lineCount = text.split('\n').filter((l) => l.trim()).length;
        const isError = block.is_error === true;
        const marker = isError ? '✗' : '';
        if (text.length <= 200) {
          process.stdout.write(`[result] ${marker}${marker ? ' ' : ''}${compact(text, 200)}\n`);
        } else {
          process.stdout.write(`[result] ${marker}${marker ? ' ' : ''}${lineCount} lines\n`);
        }
      } else {
        // Unknown content block kind — show its keys so a future schema bump surfaces.
        process.stdout.write(`[${tag}] (${blockType}) ${compact(JSON.stringify(block), 160)}\n`);
      }
    }
    return;
  }

  if (type === 'system') {
    // Per-subtype enrichment based on Claude Code headless docs
    // (https://code.claude.com/docs/en/headless#stream-responses):
    //   - init           → model, tools, plugin status
    //   - api_retry      → attempt count + retry delay + error category
    //   - plugin_install → install status (started / installed / failed / completed)
    //   - compact_boundary → conversation history was compacted
    // Anything else falls back to printing the subtype.
    const subtype = typeof evt.subtype === 'string' ? evt.subtype : '';
    if (subtype === 'init') {
      const model = typeof evt.model === 'string' ? evt.model : '';
      const tools = Array.isArray(evt.tools) ? evt.tools.length : 0;
      const plugins = Array.isArray(evt.plugins) ? evt.plugins.length : 0;
      const errs = Array.isArray(evt.plugin_errors) ? evt.plugin_errors.length : 0;
      const parts = [
        model || 'init',
        tools ? `${tools} tools` : '',
        plugins ? `${plugins} plugins` : '',
        errs ? `${errs} plugin errors` : '',
      ].filter(Boolean);
      process.stdout.write(`[system] ${parts.join(' • ')}\n`);
      return;
    }
    if (subtype === 'api_retry') {
      const attempt = typeof evt.attempt === 'number' ? evt.attempt : 0;
      const maxRetries = typeof evt.max_retries === 'number' ? evt.max_retries : 0;
      const delayMs = typeof evt.retry_delay_ms === 'number' ? evt.retry_delay_ms : 0;
      const error = typeof evt.error === 'string' ? evt.error : '';
      const status = typeof evt.error_status === 'number' ? evt.error_status : '';
      const detail =
        [error, status ? `HTTP ${status}` : ''].filter(Boolean).join(' ') || 'unknown';
      process.stdout.write(
        `[system] retry ${attempt}/${maxRetries} in ${delayMs}ms (${detail})\n`,
      );
      return;
    }
    if (subtype === 'plugin_install') {
      const status = typeof evt.status === 'string' ? evt.status : 'unknown';
      const name = typeof evt.name === 'string' ? evt.name : '';
      const error = typeof evt.error === 'string' ? evt.error : '';
      const tail = [name, error].filter(Boolean).join(': ');
      process.stdout.write(`[system] plugin_install ${status}${tail ? ` (${tail})` : ''}\n`);
      return;
    }
    process.stdout.write(`[system] ${subtype || compact(trimmed, 160)}\n`);
    return;
  }

  if (type === 'result') {
    const subtype = typeof evt.subtype === 'string' ? evt.subtype : '';
    const numTurns = typeof evt.num_turns === 'number' ? evt.num_turns : undefined;
    const totalCost =
      typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd.toFixed(3) : undefined;
    const parts = [subtype, numTurns ? `${numTurns} turns` : '', totalCost ? `$${totalCost}` : '']
      .filter(Boolean)
      .join(' • ');
    process.stdout.write(`[done] ${parts || subtype}\n`);
    return;
  }

  // Unknown event type — pass raw JSON through so nothing is silently dropped.
  process.stdout.write(`${trimmed}\n`);
}

/** Wired into the orchestrator mux: split on `\n`, then pretty-print each line. */
export const claudeStdoutStrategy: AgentStdoutStrategy = {
  appendInsideWindow,
  flushInsideWindow,
  formatSegment: formatClaudeSegment,
};
