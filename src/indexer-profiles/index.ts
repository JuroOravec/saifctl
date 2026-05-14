/**
 * Indexer profile registry.
 *
 * Add new profiles to the `indexerProfiles` map below and to
 * SUPPORTED_INDEXER_PROFILE_IDS in types.ts.
 */

import { shotgunIndexerProfile } from './shotgun/profile.js';
import type { IndexerProfile, SupportedIndexerProfileId } from './types.js';

export type { IndexerGetToolOpts, IndexerInitOpts, IndexerProfile } from './types.js';

/** Registry mapping every supported indexer profile id to its {@link IndexerProfile}. */
export const SUPPORTED_INDEXER_PROFILES = {
  shotgun: shotgunIndexerProfile,
} satisfies Record<SupportedIndexerProfileId, IndexerProfile>;

const indexerProfiles: Record<SupportedIndexerProfileId, IndexerProfile> =
  SUPPORTED_INDEXER_PROFILES;

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
