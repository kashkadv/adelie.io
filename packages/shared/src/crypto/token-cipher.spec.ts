import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTokenCipher, tokenCipherFromEnv } from './token-cipher.js';

const key1 = randomBytes(32).toString('base64');
const key2 = randomBytes(32).toString('base64');
const aad = 'ws-1:PINTEREST:user-1:access';

describe('createTokenCipher', () => {
  const cipher = createTokenCipher({ keys: { 1: key1 }, currentVersion: 1 });

  it('round-trips a token', () => {
    const encrypted = cipher.encrypt('pina_secret-token', aad);
    expect(encrypted).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(encrypted).not.toContain('secret');
    expect(cipher.decrypt(encrypted, aad)).toBe('pina_secret-token');
  });

  it('uses a fresh IV for every value', () => {
    expect(cipher.encrypt('same', aad)).not.toBe(cipher.encrypt('same', aad));
  });

  it('rejects a ciphertext moved to another context', () => {
    const encrypted = cipher.encrypt('token', aad);
    expect(() => cipher.decrypt(encrypted, 'ws-2:PINTEREST:user-1:access')).toThrow();
  });

  it('rejects tampered data', () => {
    const [v, iv, tag, data] = cipher.encrypt('token', aad).split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0]! ^= 1;
    expect(() =>
      cipher.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), aad),
    ).toThrow();
  });

  it('rejects malformed values and unknown key versions', () => {
    expect(() => cipher.decrypt('not-a-token', aad)).toThrow('Malformed');
    const other = createTokenCipher({ keys: { 2: key2 }, currentVersion: 2 });
    expect(() => cipher.decrypt(other.encrypt('t', aad), aad)).toThrow('v2 is not configured');
  });

  it('rejects keys of the wrong length', () => {
    expect(() =>
      createTokenCipher({
        keys: { 1: Buffer.from('short').toString('base64') },
        currentVersion: 1,
      }),
    ).toThrow('32 bytes');
  });
});

describe('key rotation', () => {
  it('decrypts old values with a previous key and encrypts new ones with the current key', () => {
    const old = createTokenCipher({ keys: { 1: key1 }, currentVersion: 1 });
    const legacy = old.encrypt('old-token', aad);

    const rotated = tokenCipherFromEnv({
      TOKEN_ENCRYPTION_KEY: key2,
      TOKEN_ENCRYPTION_KEY_VERSION: '2',
      TOKEN_ENCRYPTION_PREVIOUS_KEYS: `1:${key1}`,
    });
    expect(rotated.decrypt(legacy, aad)).toBe('old-token');
    expect(rotated.keyVersionOf(legacy)).toBe(1);
    expect(rotated.keyVersionOf(rotated.encrypt('new', aad))).toBe(2);
  });
});

describe('tokenCipherFromEnv', () => {
  it('requires TOKEN_ENCRYPTION_KEY', () => {
    expect(() => tokenCipherFromEnv({})).toThrow('TOKEN_ENCRYPTION_KEY');
  });

  it('defaults to key version 1', () => {
    expect(tokenCipherFromEnv({ TOKEN_ENCRYPTION_KEY: key1 }).keyVersion).toBe(1);
  });

  it('rejects the placeholder from .env.example', () => {
    expect(() => tokenCipherFromEnv({ TOKEN_ENCRYPTION_KEY: 'change-me' })).toThrow('32 bytes');
  });
});
