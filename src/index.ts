/**
 * Main package entry for @safe-ai-factory/saifctl (SaifCTL).
 */

export { cli } from './cli/index.js';
export type { SaifctlConfig } from './config/schema.js';
export {
  type ConsolaInstance,
  logger,
  LogLevels,
  outputCliData,
  setVerboseLogging,
} from './logger.js';
