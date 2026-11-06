import { describe, expect, it } from 'vitest';
import { STATE_TTL_MS, createState, verifyState } from './oauth-state.js';

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
