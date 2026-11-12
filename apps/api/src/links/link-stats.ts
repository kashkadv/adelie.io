// What tracked links brought (ADR-0027): clicks on the short form, and on the project's sites with
// Flipper the visits and goals of events carrying a link's labels. Shared by Links and the calendar.
import { Prisma, type PrismaClient } from '@adelie/db';
import { goalSql, settingsOf } from '../flipper/site-kinds.js';
import { hostOfUrl } from './links.js';

export interface LinkLabelsRow {
  id: string;
  destination: string;
  source: string;
  medium: string;
  campaign: string | null;
  content: string;
}

export interface SiteResult {
  visits: number;
  visitors: number;
  conversions: number;
  value: number | null;
  currency: string | null;
}

/** Per link: clicks, and `site` (null when the destination is not a site with Flipper). */
export type LinkResult = { clicks: number; site: SiteResult | null };

const key = (l: { source: string; medium: string; campaign: string | null; content: string }) =>
  [l.source, l.medium, l.campaign ?? '', l.content].join('\u0000');

export async function linkResults(
  db: PrismaClient,
  projectId: string,
  workspaceId: string,
  links: LinkLabelsRow[],
  since: Date,
  until: Date = new Date(Date.now() + 60_000),
): Promise<Map<string, LinkResult>> {
  const ids = links.map((l) => l.id);
  const clicks = ids.length
    ? await db.$queryRaw<{ linkId: string; clicks: number }[]>`
        SELECT "linkId", count(*)::int AS clicks FROM link_click
        WHERE "linkId" = ANY(${ids}::uuid[]) AND "occurredAt" >= ${since} AND "occurredAt" < ${until} AND NOT "isBot"
        GROUP BY 1`
    : [];
  const clicksOf = new Map(clicks.map((c) => [c.linkId, c.clicks]));

  // Visits and goals: on the project's sites with Flipper, by the links' labels.
  const sites = links.length
    ? await db.trackedSite.findMany({
        where: { projectId, workspaceId: workspaceId },
        select: { id: true, allowedHosts: true, kind: true, goals: true, funnel: true },
      })
    : [];
  const bySite = new Map<
    string,
    {
      visits: number;
      visitors: number;
      conversions: number;
      value: number | null;
      currency: string | null;
    }
  >();
  for (const site of sites) {
    const hosts = site.allowedHosts.map((h) => h.replace(/^www\./, '').toLowerCase());
    const mine = links.filter((l) => hosts.includes(hostOfUrl(l.destination) ?? ''));
    if (!mine.length) continue;
    const { goals } = settingsOf(site);
    const anyGoal = goals.length
      ? Prisma.join(
          goals.map((g) => goalSql(g.rule)),
          ' OR ',
        )
      : Prisma.sql`false`;
    const valued = goals.filter((g) => g.valued);
    const anyValued = valued.length
      ? Prisma.join(
          valued.map((g) => goalSql(g.rule)),
          ' OR ',
        )
      : Prisma.sql`false`;
    const rows = await db.$queryRaw<
      {
        source: string;
        medium: string;
        campaign: string;
        content: string;
        visits: number;
        visitors: number;
        conversions: number;
        value: number | null;
      }[]
    >`
      SELECT "source", "medium", coalesce("campaign", '') AS campaign, "content",
        (count(DISTINCT "sessionId") FILTER (WHERE consent AND name = 'PageView')
          + count(*) FILTER (WHERE NOT consent AND name = 'PageView'))::int AS visits,
        count(DISTINCT coalesce("visitorId", "dailyId")) FILTER (WHERE name = 'PageView')::int AS visitors,
        count(*) FILTER (WHERE ${anyGoal})::int AS conversions,
        sum(CASE WHEN (${anyValued}) AND jsonb_typeof(properties->'value') = 'number'
          THEN (properties->>'value')::numeric END)::float8 AS value
      FROM website_event
      WHERE "siteId" = ${site.id}::uuid AND "occurredAt" >= ${since} AND "occurredAt" < ${until} AND NOT "isBot"
        AND "content" = ANY(${[...new Set(mine.map((l) => l.content))]}::text[])
      GROUP BY 1, 2, 3, 4`;
    // The site's currency: the latest one an event with a value reported (as Flipper shows it).
    const currency = valued.length
      ? ((
          await db.$queryRaw<{ currency: string | null }[]>`
            SELECT properties->>'currency' AS currency FROM website_event
            WHERE "siteId" = ${site.id}::uuid AND properties->>'currency' IS NOT NULL
            ORDER BY "occurredAt" DESC LIMIT 1`
        )[0]?.currency ?? null)
      : null;
    for (const r of rows) {
      bySite.set(key({ ...r, campaign: r.campaign || null }), {
        visits: r.visits,
        visitors: r.visitors,
        conversions: r.conversions,
        value: valued.length ? (r.value ?? 0) : null,
        currency,
      });
    }
  }
  const tracked = new Set(
    sites.flatMap((s) => s.allowedHosts.map((h) => h.replace(/^www\./, '').toLowerCase())),
  );

  return new Map(
    links.map((l) => [
      l.id,
      {
        clicks: clicksOf.get(l.id) ?? 0,
        site: tracked.has(hostOfUrl(l.destination) ?? '')
          ? (bySite.get(key(l)) ?? {
              visits: 0,
              visitors: 0,
              conversions: 0,
              value: null,
              currency: null,
            })
          : null,
      },
    ]),
  );
}
