import type { AgentProfile } from '../types.js';
import { openhandsStdoutStrategy } from './logs.js';

export const openhandsProfile: AgentProfile = {
  id: 'openhands',
  displayName: 'OpenHands',
  stdoutStrategy: openhandsStdoutStrategy,
};
