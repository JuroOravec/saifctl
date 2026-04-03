/**
 * Indexer profile registry.
 *
 * Add new profiles to the `indexerProfiles` map below and to
 * SUPPORTED_INDEXER_PROFILE_IDS in types.ts.
 */

import { shotgunIndexerProfile } from './shotgun/profile.js';
import type { IndexerProfile, SupportedIndexerProfileId } from './types.js';

export {
  type IndexerGetToolOpts,
  type IndexerInitOpts,
  type IndexerProfile,
  SUPPORTED_INDEXER_PROFILE_IDS,
} from './types.js';

const indexerProfiles: Record<SupportedIndexerProfileId, IndexerProfile> = {
  shotgun: shotgunIndexerProfile,
};

/** No indexer unless the user passes `--indexer` or sets `defaults.indexerProfile`. */
export const DEFAULT_INDEXER_PROFILE: IndexerProfile | undefined = undefined;

/**
 * Resolves an indexer profile by id. Returns `undefined` when id is empty, missing, or `none`.
 * Throws if the id is not recognised.
 */
export function resolveIndexerProfile(id?: string): IndexerProfile | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed || trimmed === 'none') return undefined;
  const profile = indexerProfiles[trimmed as SupportedIndexerProfileId];
  if (!profile) {
    const valid = Object.keys(indexerProfiles).join(', ');
    throw new Error(`Unknown indexer profile "${trimmed}". Valid options: ${valid}, none`);
  }
  return profile;
}
