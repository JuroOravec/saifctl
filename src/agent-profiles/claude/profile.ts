import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import type { AgentPrepareResult, AgentProfile } from '../types.js';
import { claudeStdoutStrategy } from './logs.js';

const DEFAULT_HOST_CRED_PATH = join(homedir(), '.claude', '.credentials.json');

/** Agent profile for Anthropic's Claude Code CLI. */
export const claudeProfile: AgentProfile = {
  id: 'claude',
  displayName: 'Claude Code',
  stdoutStrategy: claudeStdoutStrategy,

  options: [
    {
      name: 'max',
      type: 'boolean',
      description:
        "Use the host's Claude Max OAuth credentials (~/.claude/.credentials.json) instead of an Anthropic API key. Mutually exclusive with ANTHROPIC_API_KEY / LLM_API_KEY for the claude profile.",
      default: false,
    },
    {
      name: 'credentials',
      type: 'string',
      secret: true,
      description:
        'Custom path to a Claude Code credentials JSON file (overrides the default ~/.claude/.credentials.json location). Implies --claude-max.',
      validate: async (value) => {
        if (value === undefined || value === null || value === '') return;
        if (typeof value !== 'string') {
          throw new Error('--claude-credentials must be a string path');
        }
        const stats = await stat(value).catch(() => null);
        if (!stats || !stats.isFile()) {
          throw new Error(`--claude-credentials path does not exist or is not a file: ${value}`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readFile(value, 'utf8'));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`--claude-credentials is not valid JSON: ${value} (${msg})`);
        }
        const oauth = (parsed as { claudeAiOauth?: { accessToken?: unknown } } | null)
          ?.claudeAiOauth;
        if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
          throw new Error(`--claude-credentials missing claudeAiOauth.accessToken: ${value}`);
        }
      },
    },
    {
      name: 'effort',
      type: 'string',
      description:
        'Claude session effort tier; forwarded to `claude --effort <level>`. One of: low | medium | high | xhigh | max. When unset, claude uses its own session default. Honored per-subtask via the subtask-env file (phase `agent.options.effort` wins over feature wins over `agentOptions.claude.effort` in saifctl/config.ts).',
      validate: async (value) => {
        if (value === undefined || value === null || value === '') return;
        const allowed = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
        if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
          throw new Error(`must be one of ${allowed.join(' | ')} (got: ${JSON.stringify(value)})`);
        }
      },
    },
  ],

  prepareAgentEnv: async ({ options, unprivHome }): Promise<AgentPrepareResult> => {
    const explicitPath =
      typeof options.credentials === 'string' && options.credentials !== ''
        ? options.credentials
        : undefined;
    const useOauth = options.max === true || explicitPath !== undefined;
    if (!useOauth) {
      // No-op: claude profile falls back to ANTHROPIC_API_KEY / LLM_API_KEY path
      return {};
    }

    const credPath = resolvePath(explicitPath ?? DEFAULT_HOST_CRED_PATH);
    const content = await readFile(credPath);

    return {
      stageFiles: [
        {
          src: { kind: 'inline', content },
          dst: `${unprivHome}/.claude/.credentials.json`,
          mode: 0o600,
          owner: 'unpriv',
        },
      ],
      env: {
        // agent.sh checks this to skip the ANTHROPIC_API_KEY requirement and
        // unset any inherited API_KEY env var (which would otherwise override
        // the OAuth tokens claude reads from .credentials.json).
        SAIFCTL_CLAUDE_AUTH_MODE: 'oauth',
      },
    };
  },
};
