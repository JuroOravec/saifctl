import type { AgentProfile } from '../types.js';

export const debugProfile: AgentProfile = {
  id: 'debug',
  displayName: 'Debug (no LLM)',
  defaultLogFormat: 'raw',
};
