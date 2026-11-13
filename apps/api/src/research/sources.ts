// The sources of a niche research (ADR-0032): Pinterest Trends through the project's Pinterest
// connection, the Etsy market through the app's key. Each returns our own computations only.
import { HttpClient } from '@adelie/platforms';
import { config } from '../config.js';
import type { ConnectService } from '../social/connect.service.js';
import {
  etsyMarket,
  readTrends,
  relevantTrends,
  trendFilters,
  type EtsyListingLite,
  type EtsyMarket,
  type TagStat,
  type TrendKeyword,
} from './research.js';

/**
 * Growing and monthly-top keywords containing the niche's main words, in each region; only those
 * that share a specific word with the niche are kept (Trends lists only top keywords).
 */
export async function fetchTrends(
  connect: ConnectService,
  accountId: string,
  regions: string[],
  keywords: string[],
): Promise<TrendKeyword[]> {
  const filters = trendFilters(keywords);
  return connect.withAccount(accountId, async (_adapter, ctx) => {
    const out: TrendKeyword[] = [];
    for (const region of regions) {
      for (const filter of filters) {
        for (const type of ['growing', 'monthly'] as const) {
          const res = await ctx.http.request<unknown>({
            path: `/v5/trends/keywords/${encodeURIComponent(region)}/top/${type}`,
            query: { include_keywords: filter, limit: 50 },
            headers: { Authorization: `Bearer ${ctx.accessToken}` },
            bucket: 'trends',
          });
          out.push(...readTrends(region, res.body));
        }
      }
    }
    // The same keyword from "growing" and "monthly" in one region is one entry.
    const seen = new Map<string, TrendKeyword>();
    for (const t of out) seen.set(`${t.region}\u0000${t.keyword}`, t);
    return relevantTrends([...seen.values()], keywords);
  });
}

/** The top 100 active Etsy listings for each seed phrase, reduced to what they have in common. */
export async function fetchEtsyMarket(keywords: string[]): Promise<EtsyMarket[]> {
  const etsy = config.etsy;
  if (!etsy) throw new Error('Etsy is not configured');
  const http = new HttpClient({ baseUrl: 'https://api.etsy.com' });
  const out: EtsyMarket[] = [];
  for (const keyword of keywords.slice(0, 5)) {
    const res = await http.request<{ count?: number; results?: EtsyListingLite[] }>({
      path: '/v3/application/listings/active',
      query: { keywords: keyword, limit: 100, sort_on: 'score' },
      headers: { 'x-api-key': `${etsy.keystring}:${etsy.sharedSecret}` },
      bucket: 'etsy',
    });
    const listings = (res.body?.results ?? []).map((l) => ({
      title: l.title ?? '',
      tags: Array.isArray(l.tags) ? l.tags : [],
      price: l.price ?? null,
      num_favorers: l.num_favorers ?? 0,
    }));
    out.push(etsyMarket(keyword, res.body?.count ?? 0, listings));
  }
  return out;
}

/**
 * Etsy's numbers for each candidate tag: how many active listings carry the phrase, and over its top
 * 25 the median USD price and average favourites — one request per tag, five workers each keeping to
 * one request a second (Etsy allows 5 per second).
 */
export async function fetchTagStats(tags: string[]): Promise<TagStat[]> {
  const etsy = config.etsy;
  if (!etsy) throw new Error('Etsy is not configured');
  const http = new HttpClient({ baseUrl: 'https://api.etsy.com' });
  const queue = tags.slice(0, 80);
  const out = new Map<string, TagStat>();
  const worker = async () => {
    for (let tag = queue.shift(); tag !== undefined; tag = queue.shift()) {
      const started = Date.now();
      const res = await http.request<{ count?: number; results?: EtsyListingLite[] }>({
        path: '/v3/application/listings/active',
        query: { keywords: tag, limit: 25, sort_on: 'score' },
        headers: { 'x-api-key': `${etsy.keystring}:${etsy.sharedSecret}` },
        bucket: 'etsy',
      });
      const m = etsyMarket(
        tag,
        res.body?.count ?? 0,
        (res.body?.results ?? []).map((l) => ({
          title: l.title ?? '',
          tags: [],
          price: l.price ?? null,
          num_favorers: l.num_favorers ?? 0,
        })),
      );
      out.set(tag, {
        tag,
        count: m.count,
        priceMedian: m.priceUsd?.median ?? null,
        avgFavorers: m.avgFavorers,
      });
      const wait = 1000 - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return tags.flatMap((t) => (out.has(t) ? [out.get(t)!] : []));
}
