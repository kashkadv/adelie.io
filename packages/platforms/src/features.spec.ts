import { describe, expect, it } from 'vitest';
import { hasFeature, missingFeatures, requestedScopes } from './features.js';

describe('connection features', () => {
  it('asks for every scope of every feature', () => {
    expect(requestedScopes('PINTEREST')).toEqual([
      'user_accounts:read',
      'pins:read',
      'boards:read',
      'ads:read',
    ]);
  });

  it('a connection made before a feature existed lacks it', () => {
    const old = ['boards:read', 'pins:read', 'user_accounts:read'];
    expect(missingFeatures('PINTEREST', old)).toEqual(['audience']);
    expect(hasFeature('PINTEREST', [...old, 'ads:read'], 'audience')).toBe(true);
    expect(missingFeatures('INSTAGRAM', ['instagram_basic', 'instagram_manage_insights'])).toEqual(
      [],
    );
  });
});
