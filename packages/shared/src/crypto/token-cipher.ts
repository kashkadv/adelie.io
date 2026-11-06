// Encryption of social platform tokens at rest (stage-2 data model, SocialConnection).
// AES-256-GCM with a random 96-bit IV per value. The envelope carries the key version so keys
// can be rotated: new values use the current key, old ones still decrypt with previous keys.
// Node-only: import from '@adelie/shared/crypto', never from frontend code.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Encrypted value: `v<keyVersion>.<iv>.<authTag>.<ciphertext>`, parts base64url. */
export type EncryptedToken = string;

export interface TokenCipher {
  /** Version of the key used for new values (store it in SocialConnection.keyVersion). */
  readonly keyVersion: number;
  /**
   * @param aad Context the value is bound to (e.g. workspace, platform, field). Decryption with
   *   a different context fails, so a ciphertext copied to another row is useless.
   */
  encrypt(plaintext: string, aad: string): EncryptedToken;
  decrypt(value: EncryptedToken, aad: string): string;
  /** Key version of an envelope, for finding values to re-encrypt after rotation. */
  keyVersionOf(value: EncryptedToken): number;
}

export interface TokenCipherOptions {
  /** Base64-encoded 32-byte keys by version. */
  keys: Record<number, string>;
  currentVersion: number;
}

function decodeKey(version: number, base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`Token encryption key v${version} must be ${KEY_BYTES} bytes (base64)`);
  }
  return key;
}

function parseEnvelope(value: EncryptedToken) {
  const parts = value.split('.');
  const match = /^v(\d+)$/.exec(parts[0] ?? '');
  if (parts.length !== 4 || !match) throw new Error('Malformed encrypted token');
  const [, iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64url'));
  if (iv!.length !== IV_BYTES || tag!.length !== TAG_BYTES) {
    throw new Error('Malformed encrypted token');
  }
  return { version: Number(match[1]), iv: iv!, tag: tag!, data: data! };
}

export function createTokenCipher({ keys, currentVersion }: TokenCipherOptions): TokenCipher {
  const keyring = new Map<number, Buffer>();
  for (const [version, base64] of Object.entries(keys)) {
    keyring.set(Number(version), decodeKey(Number(version), base64));
  }
  const currentKey = keyring.get(currentVersion);
  if (!currentKey) throw new Error(`Token encryption key v${currentVersion} is not configured`);

  return {
    keyVersion: currentVersion,

    encrypt(plaintext, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, currentKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const parts = [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url'));
      return `v${currentVersion}.${parts.join('.')}`;
    },

    decrypt(value, aad) {
      const { version, iv, tag, data } = parseEnvelope(value);
      const key = keyring.get(version);
      if (!key) throw new Error(`Token encryption key v${version} is not configured`);
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      // final() throws if the key, context or data do not match (tampering or wrong row).
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },

    keyVersionOf(value) {
      return parseEnvelope(value).version;
    },
  };
}

/**
 * Builds the cipher from the environment:
 * - `TOKEN_ENCRYPTION_KEY` — current key (32 random bytes, base64);
 * - `TOKEN_ENCRYPTION_KEY_VERSION` — its version, default 1;
 * - `TOKEN_ENCRYPTION_PREVIOUS_KEYS` — optional `version:base64,…` kept for decrypting old values.
 */
export function tokenCipherFromEnv(env: NodeJS.ProcessEnv = process.env): TokenCipher {
  const current = env['TOKEN_ENCRYPTION_KEY'];
  if (!current) throw new Error('Missing required environment variable: TOKEN_ENCRYPTION_KEY');
  const currentVersion = Number(env['TOKEN_ENCRYPTION_KEY_VERSION'] ?? 1);
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error('TOKEN_ENCRYPTION_KEY_VERSION must be a positive integer');
  }

  const keys: Record<number, string> = {};
  for (const entry of (env['TOKEN_ENCRYPTION_PREVIOUS_KEYS'] ?? '').split(',')) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf(':');
    const version = Number(entry.slice(0, separator));
    if (separator < 1 || !Number.isInteger(version)) {
      throw new Error('TOKEN_ENCRYPTION_PREVIOUS_KEYS must look like "1:base64,2:base64"');
    }
    keys[version] = entry.slice(separator + 1).trim();
  }
  keys[currentVersion] = current;

  return createTokenCipher({ keys, currentVersion });
}

/**
 * Encryption context (AAD) of a social connection token: binds the ciphertext to its workspace,
 * platform, platform user and field, so a value copied to another row or field fails to decrypt.
 */
export function socialTokenAad(
  workspaceId: string,
  platform: string,
  externalUserId: string,
  field: 'access' | 'refresh',
): string {
  return `${workspaceId}:${platform}:${externalUserId}:${field}`;
}
