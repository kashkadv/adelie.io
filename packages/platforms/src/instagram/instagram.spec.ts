import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http.js';
import { isAdapterError } from '../errors.js';
import type { PostsPage } from '../types.js';
import { InstagramAdapter } from './adapter.js';
import { chunkDays, mapMedia, mapTimeSeries, statusFor } from './mapping.js';

const TODAY = '2026-11-07';
const IG = '17841445843555583';

function http(routes: Record<string, (unknown | Response)[]>) {
  const seen: { url: URL; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, init: init ?? {} });
    const next = routes[url.pathname]?.shift();
    if (next === undefined) return new Response('{}', { status: 404 });
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next), { status: 200 });
  });
  const client = new HttpClient({
    baseUrl: 'https://graph.facebook.com',
    fetch: fetchFn as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { client, seen };
}

const adapter = new InstagramAdapter({ appId: 'APP', appSecret: 'shh', configId: 'CFG' });

describe('InstagramAdapter OAuth', () => {
  it('builds the Facebook Login for Business URL with the read-only configuration', () => {
    const url = new URL(adapter.authorizeUrl('st-1', 'https://api/social/instagram/callback'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'APP',
      config_id: 'CFG',
      redirect_uri: 'https://api/social/instagram/callback',
      response_type: 'code',
      override_default_response_type: 'true',
      state: 'st-1',
    });
  });

  it('exchanges the code and finds the granted Instagram accounts', async () => {
    const { client, seen } = http({
      '/v27.0/oauth/access_token': [{ access_token: 'EAA_T', token_type: 'bearer' }],
      '/v27.0/debug_token': [
        { data: { is_valid: true, scopes: ['instagram_basic', 'instagram_manage_insights'] } },
      ],
      '/v27.0/me/assigned_instagram_accounts': [{ data: [{ id: IG }] }],
    });
    const tokens = await adapter.exchangeCode('CODE', 'https://cb', client);
    expect(tokens).toEqual({
      accessToken: 'EAA_T',
      scopes: ['instagram_basic', 'instagram_manage_insights'],
      accountIds: [IG],
    });
    expect(seen[0]!.url.searchParams.get('client_secret')).toBe('shh');
    expect(seen[1]!.url.searchParams.get('access_token')).toBe('APP|shh');
    expect((seen[2]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer EAA_T');
  });

  it('cannot refresh — a rejected system-user token means reconnecting', async () => {
    await expect(adapter.refreshToken()).rejects.toSatisfy((e) =>
      isAdapterError(e, 'REAUTH_REQUIRED'),
    );
  });
});

describe('InstagramAdapter data', () => {
  const ctx = (client: HttpClient) => ({
    accessToken: 'EAA_T',
    accountExternalId: IG,
    http: client,
    today: TODAY,
  });

  it('reads the profile of the named account', async () => {
    const { client, seen } = http({
      [`/v27.0/${IG}`]: [
        {
          id: IG,
          username: 'adelie.if',
          name: "Кав'ярня Adélie",
          followers_count: 415,
          follows_count: 91,
          media_count: 21,
        },
      ],
    });
    const a = await adapter.getAccount(ctx(client));
    expect(a).toMatchObject({
      externalId: IG,
      username: 'adelie.if',
      displayName: "Кав'ярня Adélie",
      followersCount: 415,
      followingCount: 91,
      postsCount: 21,
    });
    expect(a.metrics).toEqual([
      {
        providerKey: 'followers_count',
        scope: 'ACCOUNT',
        date: TODAY,
        value: 415,
        dataStatus: 'READY',
      },
    ]);
    expect(seen[0]!.url.searchParams.get('access_token')).toBeNull(); // token only in the header
  });

  it('lists media with nested lifetime insights, following cursors', async () => {
    const insights = (reach: number) => ({
      data: [
        { name: 'reach', period: 'lifetime', values: [{ value: reach }] },
        { name: 'saved', period: 'lifetime', values: [{ value: 3 }] },
      ],
    });
    const { client, seen } = http({
      [`/v27.0/${IG}/media`]: [
        {
          data: [
            {
              id: 'm1',
              caption: 'V60 із льодом.\nШматочок тарту',
              media_type: 'IMAGE',
              media_product_type: 'FEED',
              permalink: 'https://www.instagram.com/p/x/',
              media_url: 'https://cdn/x.jpg',
              timestamp: '2022-08-03T10:54:15+0000',
              insights: insights(139),
            },
          ],
          paging: { cursors: { after: 'CUR' }, next: 'https://next' },
        },
        {
          data: [
            {
              id: 'm2',
              media_type: 'VIDEO',
              media_product_type: 'REELS',
              thumbnail_url: 'https://cdn/t.jpg',
              insights: insights(41),
            },
          ],
          paging: { cursors: { after: 'END' } },
        },
      ],
    });
    const pages: PostsPage[] = [];
    for await (const page of adapter.listPosts(ctx(client))) pages.push(page);
    expect(pages).toHaveLength(2);
    expect(seen[1]!.url.searchParams.get('after')).toBe('CUR');
    expect(seen[0]!.url.searchParams.get('fields')).toContain('insights.metric(views,reach');
    expect(pages[0]!.posts[0]).toMatchObject({
      externalId: 'm1',
      contentType: 'IMAGE',
      title: 'V60 із льодом.',
      thumbnailUrl: 'https://cdn/x.jpg',
      url: 'https://www.instagram.com/p/x/',
    });
    expect(pages[1]!.posts[0]).toMatchObject({
      contentType: 'VIDEO',
      thumbnailUrl: 'https://cdn/t.jpg',
    });
    expect(pages[0]!.metrics).toEqual([
      {
        providerKey: 'reach',
        scope: 'POST',
        postExternalId: 'm1',
        date: TODAY,
        value: 139,
        dataStatus: 'READY',
      },
      {
        providerKey: 'saved',
        scope: 'POST',
        postExternalId: 'm1',
        date: TODAY,
        value: 3,
        dataStatus: 'READY',
      },
    ]);
  });

  it('account metrics: 30-day series chunks plus one totals request per day', async () => {
    const series = {
      data: [
        {
          name: 'reach',
          period: 'day',
          values: [
            { value: 5, end_time: '2026-11-05T07:00:00+0000' },
            { value: 7, end_time: '2026-11-06T07:00:00+0000' },
          ],
        },
      ],
    };
    const totals = (v: number) => ({
      data: [{ name: 'views', period: 'day', total_value: { value: v } }],
    });
    const { client, seen } = http({
      [`/v27.0/${IG}/insights`]: [series, totals(10), totals(12)],
    });
    const points = await adapter.getAccountMetrics(ctx(client), {
      from: '2026-11-04',
      to: '2026-11-05',
    });
    expect(seen).toHaveLength(3);
    expect(seen[0]!.url.searchParams.get('metric_type')).toBe('time_series');
    expect(seen[0]!.url.searchParams.get('until')).toBe('2026-11-06');
    expect(seen[1]!.url.searchParams.get('since')).toBe('2026-11-04');
    expect(seen[1]!.url.searchParams.get('until')).toBe('2026-11-05');
    expect(points).toEqual([
      { providerKey: 'reach', scope: 'ACCOUNT', date: '2026-11-04', value: 5, dataStatus: 'READY' },
      { providerKey: 'reach', scope: 'ACCOUNT', date: '2026-11-05', value: 7, dataStatus: 'READY' },
      {
        providerKey: 'views',
        scope: 'ACCOUNT',
        date: '2026-11-04',
        value: 10,
        dataStatus: 'READY',
      },
      {
        providerKey: 'views',
        scope: 'ACCOUNT',
        date: '2026-11-05',
        value: 12,
        dataStatus: 'READY',
      },
    ]);
  });

  it('maps Graph errors: 190 → reconnect, 10 → not available, 4 → rate limited', async () => {
    const err = (code: number) =>
      new Response(JSON.stringify({ error: { code, message: 'x' } }), { status: 400 });
    const { client } = http({ [`/v27.0/${IG}`]: [err(190), err(10), err(4)] });
    for (const kind of ['REAUTH_REQUIRED', 'NOT_AVAILABLE', 'RATE_LIMITED'] as const) {
      await expect(adapter.getAccount(ctx(client))).rejects.toSatisfy((e) =>
        isAdapterError(e, kind),
      );
    }
  });
});

describe('Instagram mapping', () => {
  it('a time-series value belongs to the day before its end_time', () => {
    expect(
      mapTimeSeries(
        [{ name: 'reach', values: [{ value: 1, end_time: '2026-11-07T07:00:00+0000' }] }],
        TODAY,
      ),
    ).toEqual([
      {
        providerKey: 'reach',
        scope: 'ACCOUNT',
        date: '2026-11-06',
        value: 1,
        dataStatus: 'PROCESSING',
      },
    ]);
  });

  it('the last two days are preliminary', () => {
    expect(statusFor('2026-11-06', TODAY)).toBe('PROCESSING');
    expect(statusFor('2026-11-05', TODAY)).toBe('READY');
  });

  it('splits long ranges into 30-day chunks', () => {
    expect(chunkDays('2026-08-10', '2026-11-07')).toEqual([
      { from: '2026-08-10', to: '2026-09-08' },
      { from: '2026-09-09', to: '2026-10-08' },
      { from: '2026-10-09', to: '2026-11-07' },
    ]);
  });

  it('carousels and unknown types', () => {
    expect(mapMedia({ id: 'c', media_type: 'CAROUSEL_ALBUM' }).contentType).toBe('CAROUSEL');
    expect(mapMedia({ id: 'o' }).contentType).toBe('OTHER');
  });
});
