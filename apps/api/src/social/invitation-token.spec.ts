import { describe, expect, it } from 'vitest';
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationStatus,
  isInvitationToken,
} from './invitation-token.js';

describe('invitation tokens', () => {
  it('are random, well-formed and hashed deterministically', () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).not.toBe(b);
    expect(isInvitationToken(a)).toBe(true);
    expect(hashInvitationToken(a)).toBe(hashInvitationToken(a));
    expect(hashInvitationToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(a)).not.toContain(a);
  });

  it('rejects malformed tokens', () => {
    expect(isInvitationToken('short')).toBe(false);
    expect(isInvitationToken('x'.repeat(42) + '!')).toBe(false);
  });

  it('status: revoked > used > expired > valid', () => {
    const now = new Date('2026-11-06T12:00Z');
    const future = new Date('2026-11-10T00:00Z');
    const past = new Date('2026-11-01T00:00Z');
    expect(invitationStatus({ usedAt: null, revokedAt: null, expiresAt: future }, now)).toBe(
      'valid',
    );
    expect(invitationStatus({ usedAt: null, revokedAt: null, expiresAt: past }, now)).toBe(
      'expired',
    );
    expect(invitationStatus({ usedAt: now, revokedAt: null, expiresAt: future }, now)).toBe('used');
    expect(invitationStatus({ usedAt: now, revokedAt: now, expiresAt: past }, now)).toBe('revoked');
  });
});
