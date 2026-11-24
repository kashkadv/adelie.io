// The I/O of hits (ADR-0037): what sites (Flipper) and the shop (Etsy orders) say about products
// over the period, and what has been published for them. The ranking itself is in hits.ts.
import type { PrismaClient } from '@adelie/db';
import { linkKey, productKeys } from '@adelie/platforms';
import { countsAsSale } from '../sales/sales.js';
import {
  addSignals,
  noSignals,
  rankHits,
  type Hit,
  type HitCandidate,
  type HitSettings,
  type Signals,
} from './hits.js';

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

interface Where {
  projectId: string;
  workspaceId: string;
}

/** Accounts that can be a hit source: sites with Flipper, and the Etsy shop. */
export async function hitSources(db: PrismaClient, { projectId, workspaceId }: Where) {
  const accounts = await db.socialAccount.findMany({
    where: {
      projectId,
      workspaceId,
      hiddenAt: null,
      connection: { status: { not: 'REVOKED' } },
      OR: [{ platform: 'ETSY' }, { platform: 'WEBSITE', trackedSite: { isNot: null } }],
    },
    select: { id: true, platform: true, username: true, displayName: true },
    orderBy: { createdAt: 'asc' },
  });
  return accounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    name: a.displayName ?? a.username ?? a.platform,
  }));
}

/** The hits of one direction: weighed, with what has been published for each. */
export async function directionHits(
  db: PrismaClient,
  { projectId, workspaceId }: Where,
  settings: HitSettings,
  today: string,
): Promise<Hit[]> {
  const since = new Date(Date.now() - settings.days * DAY);
  const accounts = await db.socialAccount.findMany({
    where: { projectId, workspaceId, id: { in: settings.accountIds } },
    select: { id: true, platform: true, trackedSite: { select: { id: true } } },
  });

  // Signals per product of a channel: (account, the channel's own id of the product).
  const signals = new Map<string, Signals>(); // `${accountId}\u0000${item}`
  const bump = (accountId: string, item: string | null, add: Partial<Signals>) => {
    if (!item) return;
    const k = `${accountId}\u0000${item}`;
    signals.set(k, addSignals(signals.get(k) ?? noSignals(), add));
  };

  for (const a of accounts) {
    if (a.platform === 'WEBSITE' && a.trackedSite) {
      const sid = a.trackedSite.id;
      const [views, stages] = await Promise.all([
        db.$queryRaw<{ item: string; n: number }[]>`
          SELECT properties->>'item_id' AS item, count(*)::int AS n
          FROM website_event
          WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
            AND name = 'ProductView' AND properties->>'item_id' IS NOT NULL
          GROUP BY 1`,
        // Started checkouts and purchases carry their products in `items`.
        db.$queryRaw<{ name: string; item: string; n: number }[]>`
          SELECT e.name, i->>'item_id' AS item, count(*)::int AS n
          FROM website_event e,
               jsonb_array_elements(CASE WHEN jsonb_typeof(e.properties->'items') = 'array'
                                         THEN e.properties->'items' ELSE '[]'::jsonb END) i
          WHERE e."siteId" = ${sid}::uuid AND e."occurredAt" >= ${since} AND NOT e."isBot"
            AND e.name IN ('Purchase', 'BeginCheckout') AND i->>'item_id' IS NOT NULL
          GROUP BY 1, 2`,
      ]);
      for (const v of views) bump(a.id, v.item, { views: v.n });
      for (const s of stages) {
        bump(a.id, s.item, s.name === 'Purchase' ? { purchases: s.n } : { checkouts: s.n });
      }
    } else if (a.platform === 'ETSY') {
      const lines = await db.shopOrderItem.findMany({
        where: { order: { accountId: a.id, orderedAt: { gte: since }, isPaid: true } },
        select: { quantity: true, productExternalId: true, order: { select: { status: true } } },
      });
      for (const l of lines) {
        if (countsAsSale(l.order.status)) {
          bump(a.id, l.productExternalId, { purchases: l.quantity });
        }
      }
    }
  }
  if (!signals.size) return [];

  // The channels' own ids → products of the project (a site's item is its feed id or an article).
  const items = [...signals.keys()].map((k) => k.split('\u0000') as [string, string]);
  const products = await db.shopProduct.findMany({
    where: {
      projectId,
      workspaceId,
      accountId: { in: settings.accountIds },
      OR: [
        { externalId: { in: items.map(([, i]) => i) } },
        { articles: { hasSome: items.map(([, i]) => i) } },
      ],
    },
    select: {
      id: true,
      accountId: true,
      externalId: true,
      articles: true,
      title: true,
      url: true,
      state: true,
      account: { select: { platform: true } },
    },
  });

  // One entry per product across channels (shared article), signals added up.
  const groupKey = (p: { id: string; articles: string[] }) => [...p.articles].sort()[0] ?? p.id;
  const groups = new Map<string, { products: typeof products; signals: Signals }>();
  for (const [accountId, item] of items) {
    const p = products.find(
      (x) => x.accountId === accountId && (x.externalId === item || x.articles.includes(item)),
    );
    if (!p || p.state === 'sold_out' || p.state === 'inactive') continue;
    const key = groupKey(p);
    const g = groups.get(key) ?? { products: [], signals: noSignals() };
    if (!g.products.some((x) => x.id === p.id)) g.products.push(p);
    g.signals = addSignals(g.signals, signals.get(`${accountId}\u0000${item}`)!);
    groups.set(key, g);
  }

  // Siblings on other channels count too: a pin to the Etsy listing covers the product.
  const articles = [
    ...new Set([...groups.values()].flatMap((g) => g.products.flatMap((p) => p.articles))),
  ];
  const siblings = articles.length
    ? await db.shopProduct.findMany({
        where: { projectId, workspaceId, articles: { hasSome: articles } },
        select: {
          id: true,
          externalId: true,
          articles: true,
          url: true,
          account: { select: { platform: true } },
        },
      })
    : [];

  const candidates: HitCandidate[] = [];
  const relatedOf = new Map<string, Related[]>();
  for (const [key, g] of groups) {
    const own = new Set(g.products.map((p) => p.id));
    const related: Related[] = [
      ...g.products.map((p) => ({
        id: p.id,
        externalId: p.externalId,
        url: p.url,
        platform: p.account.platform,
      })),
      ...siblings
        .filter(
          (s) =>
            !own.has(s.id) &&
            s.articles.some((a) => g.products.some((p) => p.articles.includes(a))),
        )
        .map((s) => ({
          id: s.id,
          externalId: s.externalId,
          url: s.url,
          platform: s.account.platform,
        })),
    ];
    const main = g.products.find((p) => p.url) ?? g.products[0]!;
    candidates.push({
      key,
      productId: main.id,
      title: main.title,
      url: main.url,
      signals: g.signals,
      coverage: { pins90: 0, lastPin: null, pinTitles: [], inCalendar: [] },
    });
    relatedOf.set(key, related);
  }

  await attachCoverage(db, { projectId, workspaceId }, candidates, relatedOf);
  return rankHits(candidates, today);
}

/** A product of a hit on some channel: what its keys are made of. */
interface Related {
  id: string;
  externalId: string;
  url: string | null;
  platform: string;
}

/** What has been published for each candidate (own posts leading to it) and what is planned. */
async function attachCoverage(
  db: PrismaClient,
  { projectId, workspaceId }: Where,
  candidates: HitCandidate[],
  relatedOf: Map<string, Related[]>,
) {
  const keysOf = new Map<string, string[]>();
  const idsOf = new Map<string, string[]>();
  for (const c of candidates) {
    const related = relatedOf.get(c.key)!;
    const keys = new Set<string>();
    for (const r of related) {
      for (const k of productKeys({
        platform: r.platform,
        externalId: r.externalId,
        url: r.url,
      })) {
        keys.add(k);
      }
    }
    const own = linkKey(c.url);
    if (own) keys.add(own);
    keysOf.set(c.key, [...keys]);
    idsOf.set(
      c.key,
      related.map((r) => r.id),
    );
  }

  const allKeys = [...new Set([...keysOf.values()].flat())];
  const since90 = new Date(Date.now() - 90 * DAY);
  const [links, planned] = await Promise.all([
    allKeys.length
      ? db.socialPostLink.findMany({
          where: {
            projectId,
            workspaceId,
            key: { in: allKeys },
            post: { isOwn: true, publishedAt: { gte: since90 } },
          },
          select: { key: true, post: { select: { id: true, title: true, publishedAt: true } } },
        })
      : [],
    db.calendarItem.findMany({
      where: {
        projectId,
        workspaceId,
        productId: { in: [...idsOf.values()].flat() },
        suggestion: null,
        OR: [{ date: null }, { date: { gte: new Date(Date.now() - 14 * DAY) } }],
        status: { not: 'published' },
      },
      select: { productId: true, title: true },
    }),
  ]);

  for (const c of candidates) {
    const keys = new Set(keysOf.get(c.key));
    const posts = new Map<string, { title: string | null; at: Date }>();
    for (const l of links) {
      if (keys.has(l.key) && l.post.publishedAt) {
        posts.set(l.post.id, { title: l.post.title, at: l.post.publishedAt });
      }
    }
    const sorted = [...posts.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
    const ids = new Set(idsOf.get(c.key));
    c.coverage = {
      pins90: sorted.length,
      lastPin: sorted[0] ? day(sorted[0].at) : null,
      pinTitles: sorted
        .slice(0, 3)
        .map((p) => (p.title ?? '').slice(0, 120))
        .filter(Boolean),
      inCalendar: planned.filter((p) => p.productId && ids.has(p.productId)).map((p) => p.title),
    };
  }
}
