// OAuth `state` for connecting social accounts: a signed, short-lived token that binds the callback
// to whoever started it (CSRF protection; ADR-0011, ADR-0012). Stateless: HMAC-SHA256.
// Exactly one binding: `userId` (a signed-in member connects) or `invitationId` (connect by invitation).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OAuthState {
  /** Signed-in flow: the callback must come with this user's session. */
  userId?: string;
  /** Invitation flow: no session needed; the invitation must still be valid. */
  invitationId?: string;
  workspaceId: string;
  projectId: string;
  platform: string;
  /** Random nonce: two states are never equal. */
  nonce: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

export const STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createState(
  data: Omit<OAuthState, 'nonce' | 'exp'>,
  secret: string,
  now = Date.now(),
): string {
  const state: OAuthState = {
    ...data,
    nonce: randomBytes(12).toString('base64url'),
    exp: now + STATE_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the state if the signature is valid and it has not expired; otherwise null. */
export function verifyState(token: string, secret: string, now = Date.now()): OAuthState | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    return typeof state.exp === 'number' && state.exp > now ? state : null;
  } catch {
    return null;
  }
}
