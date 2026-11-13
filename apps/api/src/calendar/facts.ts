// What Adelie already knows about a project (ADR-0031): per connected account, the numbers that
// matter for planning — audience, content, sales, site traffic — counted from synced data. Shown
// in the brief and sent with every AI request, so the owner does not collect them by hand.
// No buyer data: countries and products only, as shares and counts. Void orders are left out the
// same way as in Sales (`countsAsSale`).
import type { Prisma as PrismaClient } from '../db.js';
import { countsAsSale } from '../sales/sales.js';

const DAY = 86_400_000;
const round = (n: number) => Math.round(n);

export interface ProjectFacts {
  pinterest: {
    name: string;
    followers: number | null;
    pins: number;
    pinsToSite: number;
    pinsToEtsy: number;
    last30: { impressions: number; saves: number; outboundClicks: number };
    top: { title: string; impressions: number; outboundClicks: number }[];
  }[];
  instagram: {
    name: string;
    followers: number | null;
    posts: number;
    last30: { reach: number; views: number; likes: number; saves: number; linkTaps: number };
    top: { title: string; reach: number; saves: number }[];
  }[];
  tiktok: { name: string; followers: number | null; videos: number | null }[];
  etsy: {
    name: string;
    activeListings: number;
    withoutTags: number;
    orders12m: number;
    revenue12m: number;
    currency: string | null;
    avgOrder: number | null;
    countries: { code: string; share: number }[];
    topProducts: { title: string; sold: number }[];
    reviews: number | null;
    favorers: number | null;
  }[];
  sites: {
    name: string;
    products: number;
    categories: { name: string; count: number }[];
    flipper: {
      visits30: number;
      visitors30: number;
      channels: { name: string; visits: number }[];
    } | null;
  }[];
  links: number;
}

/** Collects the project's facts from what the sync and Flipper stored. */
export async function projectFacts(
  db: PrismaClient,
  projectId: string,
  workspaceId: string,
): Promise<ProjectFacts> {
  const since30 = new Date(Date.now() - 30 * DAY);
  const since12m = new Date(Date.now() - 365 * DAY);
  const accounts = await db.socialAccount.findMany({
    where: {
      projectId,
      workspaceId,
      hiddenAt: null,
      connection: { status: { not: 'REVOKED' } },
    },
    select: {
      id: true,
      platform: true,
      externalId: true,
      username: true,
      displayName: true,
      trackedSite: { select: { id: true } },
    },
  });
  const nameOf = (a: (typeof accounts)[number]) => a.displayName ?? a.username ?? a.platform;
  // The project's own sites (a website's account id is its feed address): links keyed by them.
  const siteHosts = accounts.flatMap((a) => {
    if (a.platform !== 'WEBSITE') return [];
    try {
      return [new URL(a.externalId).hostname.replace(/^www\./, '').toLowerCase()];
    } catch {
      return [];
    }
  });

  /** Latest value of an account metric, and sums over 30 days of daily ones. */
  const metrics = async (accountId: string, latestKeys: string[], sumKeys: string[]) => {
    const rows = await db.$queryRaw<{ key: string; latest: number | null; sum30: number | null }[]>`
      SELECT d.key,
        (array_agg(v.value ORDER BY v.date DESC) FILTER (WHERE v.value IS NOT NULL))[1] AS latest,
        sum(v.value) FILTER (WHERE v.date >= ${since30}::date)::float8 AS sum30
      FROM account_metric_value v JOIN metric_definition d ON d.id = v."metricId"
      WHERE v."accountId" = ${accountId}::uuid AND v."dimensionKey" = ''
        AND d.key = ANY(${[...latestKeys, ...sumKeys]}::text[])
      GROUP BY d.key`;
    const latest = (k: string) => rows.find((r) => r.key === k)?.latest ?? null;
    const sum = (k: string) => round(rows.find((r) => r.key === k)?.sum30 ?? 0);
    return { latest, sum };
  };

  const facts: ProjectFacts = {
    pinterest: [],
    instagram: [],
    tiktok: [],
    etsy: [],
    sites: [],
    links: 0,
  };

  for (const a of accounts) {
    if (a.platform === 'PINTEREST') {
      const m = await metrics(a.id, ['followers'], ['impressions', 'saves', 'outbound_clicks']);
      const [pins, toSite, toEtsy, top] = await Promise.all([
        db.socialPost.count({ where: { accountId: a.id } }),
        db.socialPost.count({
          where: {
            accountId: a.id,
            links: { some: { OR: siteHosts.map((h) => ({ key: { startsWith: `url:${h}` } })) } },
          },
        }),
        db.socialPost.count({
          where: { accountId: a.id, links: { some: { key: { startsWith: 'etsy:' } } } },
        }),
        db.postMetricsLatest.findMany({
          where: { accountId: a.id, impressions: { not: null } },
          orderBy: { impressions: 'desc' },
          take: 3,
          select: {
            impressions: true,
            outboundClicks: true,
            post: { select: { title: true, description: true } },
          },
        }),
      ]);
      facts.pinterest.push({
        name: nameOf(a),
        followers: m.latest('followers'),
        pins,
        pinsToSite: toSite,
        pinsToEtsy: toEtsy,
        last30: {
          impressions: m.sum('impressions'),
          saves: m.sum('saves'),
          outboundClicks: m.sum('outbound_clicks'),
        },
        top: top.map((p) => ({
          title: (p.post.title || p.post.description || '').replace(/\s+/g, ' ').slice(0, 100),
          impressions: p.impressions ?? 0,
          outboundClicks: p.outboundClicks ?? 0,
        })),
      });
    } else if (a.platform === 'INSTAGRAM') {
      const m = await metrics(
        a.id,
        ['followers'],
        ['reach', 'views', 'likes', 'saves', 'profile_link_taps'],
      );
      const [posts, top] = await Promise.all([
        db.socialPost.count({ where: { accountId: a.id } }),
        db.postMetricsLatest.findMany({
          where: { accountId: a.id, reach: { not: null } },
          orderBy: { reach: 'desc' },
          take: 3,
          select: {
            reach: true,
            saves: true,
            post: { select: { title: true, description: true } },
          },
        }),
      ]);
      facts.instagram.push({
        name: nameOf(a),
        followers: m.latest('followers'),
        posts,
        last30: {
          reach: m.sum('reach'),
          views: m.sum('views'),
          likes: m.sum('likes'),
          saves: m.sum('saves'),
          linkTaps: m.sum('profile_link_taps'),
        },
        top: top.map((p) => ({
          title: (p.post.title || p.post.description || '').replace(/\s+/g, ' ').slice(0, 100),
          reach: p.reach ?? 0,
          saves: p.saves ?? 0,
        })),
      });
    } else if (a.platform === 'TIKTOK') {
      const m = await metrics(a.id, ['followers', 'videos'], []);
      facts.tiktok.push({
        name: nameOf(a),
        followers: m.latest('followers'),
        videos: m.latest('videos'),
      });
    } else if (a.platform === 'ETSY') {
      const m = await metrics(a.id, ['reviews', 'favorers'], []);
      const [active, withoutTags, orders, sold] = await Promise.all([
        db.shopProduct.count({ where: { accountId: a.id, state: 'active' } }),
        db.shopProduct.count({
          where: { accountId: a.id, state: 'active', tags: { isEmpty: true } },
        }),
        db.shopOrder.findMany({
          where: { accountId: a.id, orderedAt: { gte: since12m } },
          select: { status: true, total: true, currency: true, country: true },
        }),
        db.$queryRaw<{ title: string; sold: number }[]>`
          SELECT p.title, sum(i.quantity)::int AS sold
          FROM shop_order_item i JOIN shop_order o ON o.id = i."orderId"
          JOIN shop_product p ON p.id = i."productId"
          WHERE o."accountId" = ${a.id}::uuid AND o."orderedAt" >= ${since12m}
            AND (o.status IS NULL OR lower(o.status) NOT IN ('canceled', 'cancelled', 'fully refunded'))
          GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      ]);
      const sales = orders.filter((o) => countsAsSale(o.status));
      const revenue = sales.reduce((n, o) => n + (o.total ?? 0), 0) / 100;
      const byCountry = new Map<string, number>();
      for (const o of sales)
        if (o.country) byCountry.set(o.country, (byCountry.get(o.country) ?? 0) + 1);
      facts.etsy.push({
        name: nameOf(a),
        activeListings: active,
        withoutTags,
        orders12m: sales.length,
        revenue12m: round(revenue),
        currency: sales[0]?.currency ?? null,
        avgOrder: sales.length ? round(revenue / sales.length) : null,
        countries: [...byCountry]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 5)
          .map(([code, n]) => ({ code, share: round((n / sales.length) * 100) })),
        topProducts: sold.map((s) => ({ title: s.title.slice(0, 100), sold: s.sold })),
        reviews: m.latest('reviews'),
        favorers: m.latest('favorers'),
      });
    } else if (a.platform === 'WEBSITE') {
      const [products, categories] = await Promise.all([
        db.shopProduct.count({ where: { accountId: a.id, state: { not: 'removed' } } }),
        db.shopProduct.groupBy({
          by: ['category'],
          where: { accountId: a.id, state: { not: 'removed' }, category: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { category: 'desc' } },
          take: 8,
        }),
      ]);
      let flipper: ProjectFacts['sites'][number]['flipper'] = null;
      const tracking =
        a.trackedSite &&
        (await db.websiteEvent.findFirst({
          where: { siteId: a.trackedSite.id },
          select: { id: true },
        }));
      if (a.trackedSite && tracking) {
        const site = a.trackedSite.id;
        const [totals, channels] = await Promise.all([
          db.$queryRaw<{ visits: number; visitors: number }[]>`
            SELECT (count(DISTINCT "sessionId") FILTER (WHERE consent)
                + count(*) FILTER (WHERE NOT consent))::int AS visits,
              count(DISTINCT coalesce("visitorId", "dailyId"))::int AS visitors
            FROM website_event
            WHERE "siteId" = ${site}::uuid AND name = 'PageView' AND NOT "isBot"
              AND "occurredAt" >= ${since30}`,
          db.$queryRaw<{ name: string; visits: number }[]>`
            SELECT coalesce("channel", 'Direct') AS name,
              (count(DISTINCT "sessionId") FILTER (WHERE consent)
                + count(*) FILTER (WHERE NOT consent))::int AS visits
            FROM website_event
            WHERE "siteId" = ${site}::uuid AND name = 'PageView' AND NOT "isBot"
              AND "occurredAt" >= ${since30}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
        ]);
        flipper = {
          visits30: totals[0]?.visits ?? 0,
          visitors30: totals[0]?.visitors ?? 0,
          channels,
        };
      }
      facts.sites.push({
        name: nameOf(a),
        products,
        categories: categories.map((c) => ({ name: c.category!, count: c._count._all })),
        flipper,
      });
    }
  }
  facts.links = await db.trackedLink.count({ where: { projectId, workspaceId, archivedAt: null } });
  return facts;
}
