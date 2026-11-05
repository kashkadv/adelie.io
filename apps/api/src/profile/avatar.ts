// Avatar upload: the browser resizes the photo to 256×256 and sends it as a data URL (ADR-0010).
// The server only checks type (by magic bytes, not the declared type) and size.

export const AVATAR_MAX_BYTES = 150 * 1024;

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/webp': (b) =>
    b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

export type AvatarResult =
  { ok: true; mime: string; data: Buffer } | { ok: false; error: 'invalidImage' | 'tooLarge' };

export function parseAvatarDataUrl(input: unknown): AvatarResult {
  if (typeof input !== 'string') return { ok: false, error: 'invalidImage' };
  const match = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match) return { ok: false, error: 'invalidImage' };
  const mime = match[1]!;
  const data = Buffer.from(match[2]!, 'base64');
  if (data.length > AVATAR_MAX_BYTES) return { ok: false, error: 'tooLarge' };
  if (!SIGNATURES[mime]!(data)) return { ok: false, error: 'invalidImage' };
  return { ok: true, mime, data };
}
