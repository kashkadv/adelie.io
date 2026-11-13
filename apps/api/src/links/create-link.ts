// Creating a tracked link (ADR-0027), shared by Links and the places that make links for a
// publication (a research's pin, ADR-0032): a fresh code, checked labels unique among the
// project's active links, the short form written to Workers KV.
import type { Prisma as PrismaClient } from '../db.js';
import { buildLinkUrl, newLinkCode, parseLinkInput, type LinkInputError } from './links.js';
import { publishShortLink } from './short-links.js';

export const LINK_SELECT = {
  id: true,
  code: true,
  name: true,
  destination: true,
  source: true,
  medium: true,
  campaign: true,
  content: true,
  publishedAt: true,
  createdAt: true,
  archivedAt: true,
} as const;

export type CreateLinkResult<T> =
  { ok: true; link: T } | { ok: false; error: LinkInputError | 'taken'; linkId?: string };

export async function createTrackedLink(
  db: PrismaClient,
  where: { workspaceId: string; projectId: string },
  body: Record<string, unknown>,
) {
  let code = newLinkCode();
  while (await db.trackedLink.findUnique({ where: { code }, select: { id: true } })) {
    code = newLinkCode();
  }
  const parsed = parseLinkInput(body, code);
  if (!parsed.ok) return { ok: false, error: parsed.error } as const;
  const { labels } = parsed;
  const same = await db.trackedLink.findFirst({
    where: { ...where, archivedAt: null, ...labels },
    select: { id: true },
  });
  if (same) return { ok: false, error: 'taken', linkId: same.id } as const;
  let link = await db.trackedLink.create({
    data: { ...where, code, name: parsed.name, destination: parsed.destination, ...labels },
    select: LINK_SELECT,
  });
  if (await publishShortLink(link.code, buildLinkUrl(link.destination, link))) {
    link = await db.trackedLink.update({
      where: { id: link.id },
      data: { publishedAt: new Date() },
      select: LINK_SELECT,
    });
  }
  return { ok: true, link } as const;
}
