/**
 * Load saifac config from saifDir using cosmiconfig.
 *
 * Config can be written as config.json, config.yml, config.js, config.ts, etc.
 * Returns empty defaults when no config file exists.
 */

import { resolve } from 'node:path';

import { cosmiconfig } from 'cosmiconfig';

import { consola } from '../logger.js';
import { pathExists } from '../utils/io.js';
import { type SaifacConfig, saifacConfigSchema } from './schema.js';

const EXPLORER = cosmiconfig('saifac', {
  searchPlaces: [
    'config.ts',
    'config.js',
    'config.mjs',
    'config.json',
    'config.yaml',
    'config.yml',
    'config.cjs',
  ],
  searchStrategy: 'none' as const,
});

/**
 * Load config from saifDir. Resolves saifDir relative to projectDir when saifDir
 * is not absolute.
 *
 * @param saifDir - Path to saifac directory (default "saifac", can be relative to cwd or projectDir)
 * @param projectDir - Project root (for resolving relative saifDir when needed)
 * @returns Parsed and validated config, or empty defaults if no file found
 */
export async function loadSaifacConfig(saifDir: string, projectDir: string): Promise<SaifacConfig> {
  const configDir = resolve(projectDir, saifDir);
  if (!(await pathExists(configDir))) {
    return {};
  }

  const result = await EXPLORER.search(configDir);
  if (!result?.config) {
    return {};
  }

  try {
    return saifacConfigSchema.parse(result.config);
  } catch (err) {
    consola.error(`Error parsing config at ${result.filepath}:`);
    consola.error(err);
    process.exit(1);
  }
}
