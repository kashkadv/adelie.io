// Connect invitations (ADR-0012): random single-use tokens; only their hash and an encrypted copy
// are stored. Pure helpers — unit-tested.
import { createHash, randomBytes } from 'node:crypto';

export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

/** 256-bit random token, URL-safe. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Lookup key stored in the database (the token itself is not). */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Encryption context of the stored token copy: bound to its hash. */
export function invitationAad(tokenHash: string): string {
  return `invitation:${tokenHash}`;
}

/** Well-formed token: base64url of 32 bytes. Cheap check before a database lookup. */
export function isInvitationToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export type InvitationStatus = 'valid' | 'used' | 'revoked' | 'expired';

export function invitationStatus(
  inv: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now = new Date(),
): InvitationStatus {
  if (inv.revokedAt) return 'revoked';
  if (inv.usedAt) return 'used';
  if (inv.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
