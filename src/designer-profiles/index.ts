/**
 * Designer profile registry.
 *
 * Add new profiles to the `designerProfiles` map below and to
 * SUPPORTED_DESIGNER_PROFILE_IDS in types.ts.
 */

import { shotgunDesignerProfile } from './shotgun/profile.js';
import type { DesignerProfile, SupportedDesignerProfileId } from './types.js';

export {
  type DesignerBaseOpts,
  type DesignerProfile,
  type DesignerRunOpts,
  SUPPORTED_DESIGNER_PROFILE_IDS,
} from './types.js';

const designerProfiles: Record<SupportedDesignerProfileId, DesignerProfile> = {
  shotgun: shotgunDesignerProfile,
};

export const DEFAULT_DESIGNER_PROFILE: DesignerProfile = shotgunDesignerProfile;

/**
 * Resolves a designer profile by id. Returns DEFAULT_DESIGNER_PROFILE when id is empty/undefined.
 * Throws if the id is not recognised.
 */
export function resolveDesignerProfile(id?: string): DesignerProfile {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return DEFAULT_DESIGNER_PROFILE;
  const profile = designerProfiles[trimmed as SupportedDesignerProfileId];
  if (!profile) {
    const valid = Object.keys(designerProfiles).join(', ');
    throw new Error(`Unknown designer profile "${trimmed}". Valid options: ${valid}`);
  }
  return profile;
}
