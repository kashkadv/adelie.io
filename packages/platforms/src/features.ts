// Features of a connection and the permissions (OAuth scopes) each needs. Adelie compares what a
// connection was granted with what its features need: a missing permission is shown with an
// "update access" action that re-runs consent for the same account — never a disconnect.
import type { Platform } from './types.js';

export interface PlatformFeature {
  /** Stable id, used in the UI texts (`Accounts.features.<id>`). */
  id: string;
  scopes: readonly string[];
  /** Optional features only hint; without a core feature the connection cannot work. */
  optional: boolean;
}

export const PLATFORM_FEATURES: Record<Platform, readonly PlatformFeature[]> = {
  PINTEREST: [
    { id: 'core', scopes: ['user_accounts:read', 'pins:read', 'boards:read'], optional: false },
    // Audience insights (age, gender, countries, interests) live under the ad account.
    { id: 'audience', scopes: ['ads:read'], optional: true },
  ],
  INSTAGRAM: [
    { id: 'core', scopes: ['instagram_basic', 'instagram_manage_insights'], optional: false },
  ],
  ETSY: [{ id: 'core', scopes: ['shops_r', 'listings_r', 'transactions_r'], optional: false }],
  TIKTOK: [
    {
      id: 'core',
      scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'],
      optional: false,
    },
  ],
  // A website feed needs no permissions.
  WEBSITE: [],
};

/** Every scope a new or updated connection asks for. */
export function requestedScopes(platform: Platform): string[] {
  return [...new Set(PLATFORM_FEATURES[platform].flatMap((f) => f.scopes))];
}

/** Features whose permissions the connection lacks. */
export function missingFeatures(platform: Platform, granted: readonly string[]): string[] {
  return PLATFORM_FEATURES[platform]
    .filter((f) => !f.scopes.every((s) => granted.includes(s)))
    .map((f) => f.id);
}

export function hasFeature(platform: Platform, granted: readonly string[], id: string): boolean {
  return !missingFeatures(platform, granted).includes(id);
}
