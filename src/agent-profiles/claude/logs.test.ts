import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeStdoutStrategy, formatClaudeSegment } from './logs.js';

describe('formatClaudeSegment', () => {
  let out: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    out = [];
    // @ts-expect-error process.stdout.write overloads don't fit vi.spyOn's signature
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((s: string | Uint8Array) => {
      out.push(typeof s === 'string' ? s : s.toString());
      return true;
    }) as never);
  });
  afterEach(() => writeSpy.mockRestore());

  it('formats an assistant.thinking block as [think]', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'thinking',
              thinking: 'Now let me look at the constants file to understand LLM_API_KEYS.',
            },
          ],
        },
      }),
      'agent',
    );
    expect(out.join('')).toBe(
      '[think] Now let me look at the constants file to understand LLM_API_KEYS.\n',
    );
  });

  it('formats an assistant.tool_use Grep call', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Grep',
              input: { pattern: 'LLM_API_KEYS', path: '/workspace/src', output_mode: 'content' },
            },
          ],
        },
      }),
      'agent',
    );
    expect(out.join('')).toBe('[agent] Grep(LLM_API_KEYS in /workspace/src)\n');
  });

  it('formats an assistant.tool_use Read call with file_path + offset', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: '/workspace/src/constants.ts', offset: 55, limit: 30 },
            },
          ],
        },
      }),
      'agent',
    );
    expect(out.join('')).toBe('[agent] Read(/workspace/src/constants.ts:55)\n');
  });

  it('formats a Bash tool_use, collapsing newlines', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'pnpm install\n# install deps' } },
          ],
        },
      }),
      'agent',
    );
    expect(out.join('')).toBe('[agent] Bash(pnpm install # install deps)\n');
  });

  it('formats an assistant.text block as [agent] with truncation', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'I will now implement the spec.' }] },
      }),
      'agent',
    );
    expect(out.join('')).toBe('[agent] I will now implement the spec.\n');
  });

  it('formats a short user.tool_result inline, with content text', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_xxx',
              content: 'src/constants.ts:59:export const LLM_API_KEYS = [',
            },
          ],
        },
      }),
      'agent',
    );
    expect(out.join('')).toMatch(
      /^\[result\] src\/constants\.ts:59:export const LLM_API_KEYS = \[\n$/,
    );
  });

  it('summarizes long tool_result as line-count', () => {
    const longLines = Array.from({ length: 30 }, (_, i) => `line ${i}: ${'x'.repeat(20)}`).join(
      '\n',
    );
    formatClaudeSegment(
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_xxx', content: longLines }],
        },
      }),
      'agent',
    );
    expect(out.join('')).toBe('[result] 30 lines\n');
  });

  it('marks tool_result errors with ✗', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_xxx',
              content: 'no such file',
              is_error: true,
            },
          ],
        },
      }),
      'agent',
    );
    expect(out.join('')).toBe('[result] ✗ no such file\n');
  });

  it('formats a result event with subtype + cost', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        num_turns: 12,
        total_cost_usd: 0.0234,
      }),
      'agent',
    );
    expect(out.join('')).toBe('[done] success • 12 turns • $0.023\n');
  });

  it('passes through unknown JSON shapes verbatim', () => {
    const raw = JSON.stringify({ type: 'wat', foo: 'bar' });
    formatClaudeSegment(raw, 'agent');
    expect(out.join('')).toBe(`${raw}\n`);
  });

  it('passes through non-JSON segments as plain text', () => {
    formatClaudeSegment('plain old log line', 'agent');
    expect(out.join('')).toBe('plain old log line\n');
  });

  it('uses [inspect] tag when linePrefix is inspect', () => {
    formatClaudeSegment(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x' } }] },
      }),
      'inspect',
    );
    expect(out.join('')).toBe('[inspect] Read(/x)\n');
  });
});

describe('claudeStdoutStrategy.appendInsideWindow', () => {
  it('splits newline-delimited JSON, keeps trailing partial in buf', () => {
    const segments: string[] = [];
    const state = { buf: '' };
    claudeStdoutStrategy.appendInsideWindow({
      state,
      chunk: '{"type":"a"}\n{"type":"b"}\n{"type":"par',
      emitSegment: (s) => segments.push(s),
    });
    expect(segments).toEqual(['{"type":"a"}', '{"type":"b"}']);
    expect(state.buf).toBe('{"type":"par');
    claudeStdoutStrategy.appendInsideWindow({
      state,
      chunk: 'tial"}\n',
      emitSegment: (s) => segments.push(s),
    });
    expect(segments).toEqual(['{"type":"a"}', '{"type":"b"}', '{"type":"partial"}']);
    expect(state.buf).toBe('');
  });

  it('flushInsideWindow emits any leftover buf', () => {
    const segments: string[] = [];
    const state = { buf: '{"type":"unfinished"}' };
    claudeStdoutStrategy.flushInsideWindow({
      state,
      emitSegment: (s) => segments.push(s),
    });
    expect(segments).toEqual(['{"type":"unfinished"}']);
    expect(state.buf).toBe('');
  });
});
