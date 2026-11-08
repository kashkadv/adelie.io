import { describe, expect, it } from 'vitest';
import { STATE_TTL_MS, createState, verifyState, pkceFor } from './oauth-state.js';

const secret = 'test-secret-test-secret-test-secret';
const data = { userId: 'u1', workspaceId: 'w1', projectId: 'p1', platform: 'pinterest' };

describe('OAuth state', () => {
  it('round-trips and carries the binding', () => {
    const state = verifyState(createState(data, secret, 1000), secret, 2000);
    expect(state).toMatchObject(data);
  });

  it('is unique per call', () => {
    expect(createState(data, secret)).not.toBe(createState(data, secret));
  });

  it('expires', () => {
    const token = createState(data, secret, 0);
    expect(verifyState(token, secret, STATE_TTL_MS + 1)).toBeNull();
  });

  it('rejects tampering and a wrong secret', () => {
    const token = createState(data, secret);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...data, userId: 'attacker', exp: Date.now() + 1e6 }),
    ).toString('base64url');
    expect(verifyState(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifyState(`${payload}.${sig}x`, secret)).toBeNull();
    expect(verifyState(token, 'another-secret-another-secret-xx')).toBeNull();
    expect(verifyState('garbage', secret)).toBeNull();
  });
});

describe('pkceFor', () => {
  it('derives a stable RFC 7636 pair per state', () => {
    const a = pkceFor('state-1', 'secret');
    expect(a).toEqual(pkceFor('state-1', 'secret'));
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).not.toBe(a.verifier);
    expect(pkceFor('state-2', 'secret').verifier).not.toBe(a.verifier);
  });
});
