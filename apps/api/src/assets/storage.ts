import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@adelie/db';

/**
 * Library files (ADR-0040 §9, ADR-0042): stored under ASSETS_DIR (the server's `/srv/adelie-assets` volume; a folder
 * outside git in development), served only through the API.
 */
export const ASSETS_DIR = resolve(
  process.env['ASSETS_DIR'] ?? new URL('../../../../.data/assets', import.meta.url).pathname,
);

export const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Width and height of a PNG or JPEG from its header (no image library needed). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** The request body as bytes, up to `limit`; null when larger. */
export function readBinary(req: Request, limit: number): Promise<Buffer | null> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        ok(null);
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

/** Writes a file and records it in the library. */
export async function saveAsset(
  db: PrismaClient,
  a: {
    workspaceId: string;
    projectId: string;
    role: string;
    origin: string;
    mime: string;
    data: Buffer;
    parentId?: string | null;
    recipe?: unknown;
  },
) {
  const ext = MIME_EXT[a.mime];
  if (!ext) throw new Error(`unsupported type ${a.mime}`);
  const id = randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  const path = join(a.projectId, month, `${id}.${ext}`);
  const full = join(ASSETS_DIR, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, a.data);
  const size = imageSize(a.data);
  return db.asset.create({
    data: {
      workspaceId: a.workspaceId,
      projectId: a.projectId,
      role: a.role,
      origin: a.origin,
      path,
      mime: a.mime,
      width: size?.width ?? null,
      height: size?.height ?? null,
      bytes: a.data.length,
      sha256: createHash('sha256').update(a.data).digest('hex'),
      parentId: a.parentId ?? null,
      ...(a.recipe !== undefined ? { recipe: a.recipe as Prisma.InputJsonValue } : {}),
    },
  });
}

/** Absolute path of a stored file; refuses anything outside ASSETS_DIR. */
export function assetFile(path: string): string | null {
  const full = resolve(ASSETS_DIR, path);
  return full.startsWith(ASSETS_DIR + '/') ? full : null;
}
