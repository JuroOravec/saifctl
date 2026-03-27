/**
 * AgentProfile — describes a coding agent and its runtime requirements.
 *
 * Supported profiles: openhands | aider | claude | codex | gemini | qwen | opencode | copilot | kilocode | mini-swe-agent | terminus | forge | deepagents | debug
 *
 * The profile is mainly used by:
 *   - sandbox.ts                  → writes agent.sh + agent-install.sh to sandbox
 *   - coder-start.sh             → runs agent-install.sh before the loop
 */

import type { AgentStdoutStrategy } from '../orchestrator/logs.js';

export interface AgentProfile {
  /**
   * Profile identifier used in --agent CLI flag.
   * One of the SUPPORTED_AGENT_PROFILE_IDS.
   */
  id: SupportedAgentProfileId;

  /** Human-readable display name (e.g. "OpenHands", "Aider"). */
  displayName: string;

  /**
   * Structured stdout handling inside the `[SAIFAC:AGENT_*]` window (segment split + per-segment CLI formatting).
   * Use `null` when the agent emits plain line-oriented output (line-wise events + `[prefix]` formatting).
   */
  stdoutStrategy: AgentStdoutStrategy | null;
}

export const SUPPORTED_AGENT_PROFILE_IDS = [
  'openhands',
  'aider',
  'claude',
  'codex',
  'gemini',
  'qwen',
  'opencode',
  'copilot',
  'kilocode',
  'mini-swe-agent',
  'terminus',
  'forge',
  'deepagents',
  'debug',
] as const;
export type SupportedAgentProfileId = (typeof SUPPORTED_AGENT_PROFILE_IDS)[number];
