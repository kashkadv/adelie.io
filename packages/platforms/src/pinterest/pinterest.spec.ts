import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http.js';
import type { PostsPage } from '../types.js';
import { PinterestAdapter } from './adapter.js';
import {
  contentType,
  mapAccountAnalytics,
  mapPin,
  mapPinMetrics,
  type PinterestPin,
} from './mapping.js';

const TODAY = '2026-11-06';

function http(routes: Record<string, unknown[]>) {
  const seen: { url: URL; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, init: init ?? {} });
    const queue = routes[url.pathname];
    const next = queue?.shift();
    if (next === undefined) return new Response('{}', { status: 404 });
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next), { status: 200 });
  });
  const client = new HttpClient({
    baseUrl: 'https://api.pinterest.com',
    fetch: fetchFn as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { client, seen };
}

const adapter = new PinterestAdapter({ appId: '1635003', appSecret: 'shh' });

describe('PinterestAdapter OAuth', () => {
  it('builds the consent URL with read-only scopes and state', () => {
    const url = new URL(
      adapter.authorizeUrl('st-123', 'http://localhost:4000/social/pinterest/callback'),
    );
    expect(url.origin + url.pathname).toBe('https://www.pinterest.com/oauth/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1635003',
      redirect_uri: 'http://localhost:4000/social/pinterest/callback',
      response_type: 'code',
      scope: 'user_accounts:read,pins:read,boards:read,ads:read',
      state: 'st-123',
    });
  });

  it('exchanges the code with Basic auth and parses expiry and scopes', async () => {
    const { client, seen } = http({
      '/v5/oauth/token': [
        {
          access_token: 'pina_A',
          refresh_token: 'pinr_R',
          expires_in: 2592000,
          refresh_token_expires_in: 31536000,
          scope: 'boards:read pins:read user_accounts:read',
        },
      ],
    });
    const tokens = await adapter.exchangeCode('CODE', 'http://cb', client);
    expect(tokens).toMatchObject({
      accessToken: 'pina_A',
      refreshToken: 'pinr_R',
      scopes: ['boards:read', 'pins:read', 'user_accounts:read'],
    });
    expect(tokens.accessTokenExpiresAt).toBeInstanceOf(Date);
    const req = seen[0]!;
    expect((req.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('1635003:shh').toString('base64')}`,
    );
    expect(req.init.body).toBe(
      'grant_type=authorization_code&code=CODE&redirect_uri=http%3A%2F%2Fcb',
    );
  });

  it('keeps the old refresh token when Pinterest does not rotate it', async () => {
    const { client } = http({ '/v5/oauth/token': [{ access_token: 'pina_B', expires_in: 10 }] });
    await expect(adapter.refreshToken('pinr_OLD', client)).resolves.toMatchObject({
      accessToken: 'pina_B',
      refreshToken: 'pinr_OLD',
    });
  });

  it('a rejected refresh token means the user must reconnect', async () => {
    const { client } = http({
      '/v5/oauth/token': [new Response(JSON.stringify({ code: 1 }), { status: 400 })],
    });
    await expect(adapter.refreshToken('bad', client)).rejects.toMatchObject({
      kind: 'REAUTH_REQUIRED',
    });
  });
});

describe('PinterestAdapter data', () => {
  it('maps the profile; -1 means unavailable, not zero', async () => {
    const { client } = http({
      '/v5/user_account': [
        {
          username: 'gushka',
          business_name: 'Gushka',
          account_type: 'BUSINESS',
          follower_count: 120,
          following_count: 3,
          pin_count: 450,
          monthly_views: -1,
        },
      ],
    });
    const account = await adapter.getAccount({ accessToken: 't', http: client, today: TODAY });
    expect(account).toMatchObject({
      externalId: 'gushka',
      displayName: 'Gushka',
      followersCount: 120,
      postsCount: 450,
    });
    expect(account.metrics).toEqual([
      {
        providerKey: 'follower_count',
        scope: 'ACCOUNT',
        date: TODAY,
        value: 120,
        dataStatus: 'READY',
      },
      {
        providerKey: 'monthly_views',
        scope: 'ACCOUNT',
        date: TODAY,
        value: null,
        dataStatus: 'UNAVAILABLE',
      },
    ]);
  });

  it('pages through pins via bookmark and returns lifetime pin metrics', async () => {
    const pin = (id: string): PinterestPin => ({
      id,
      created_at: '2026-10-01T10:00:00Z',
      board_id: 'b1',
      title: `Pin ${id}`,
      media: { media_type: 'image', images: { '600x': { url: `https://i/${id}.jpg` } } },
      pin_metrics: {
        '90d': { impression: 5 },
        lifetime_metrics: { impression: 50, save: 2, clickthrough: 1 },
      },
    });
    const { client, seen } = http({
      '/v5/pins': [
        { items: [pin('p1'), pin('p2')], bookmark: 'NEXT' },
        { items: [pin('p3')], bookmark: null },
      ],
    });
    const pages: PostsPage[] = [];
    for await (const page of adapter.listPosts({ accessToken: 't', http: client, today: TODAY })) {
      pages.push(page);
    }
    expect(pages.map((p) => p.posts.map((x) => x.externalId))).toEqual([['p1', 'p2'], ['p3']]);
    expect(seen[1]!.url.searchParams.get('bookmark')).toBe('NEXT');
    expect(seen[0]!.url.searchParams.get('pin_metrics')).toBe('true');
    expect(pages[0]!.posts[0]).toMatchObject({
      url: 'https://www.pinterest.com/pin/p1/',
      contentType: 'IMAGE',
      thumbnailUrl: 'https://i/p1.jpg',
      boardExternalId: 'b1',
    });
    expect(pages[0]!.metrics.filter((m) => m.postExternalId === 'p1')).toEqual([
      {
        providerKey: 'IMPRESSION',
        scope: 'POST',
        postExternalId: 'p1',
        date: TODAY,
        value: 50,
        dataStatus: 'READY',
      },
      {
        providerKey: 'SAVE',
        scope: 'POST',
        postExternalId: 'p1',
        date: TODAY,
        value: 2,
        dataStatus: 'READY',
      },
      {
        providerKey: 'OUTBOUND_CLICK',
        scope: 'POST',
        postExternalId: 'p1',
        date: TODAY,
        value: 1,
        dataStatus: 'READY',
      },
    ]);
  });

  it('maps HTTP errors to typed adapter errors', async () => {
    const { client } = http({
      '/v5/user_account': [
        new Response('{"code":2}', { status: 401 }),
        new Response('{"code":3}', { status: 403 }),
      ],
    });
    const ctx = { accessToken: 't', http: client };
    await expect(adapter.getAccount(ctx)).rejects.toMatchObject({ kind: 'TOKEN_EXPIRED' });
    await expect(adapter.getAccount(ctx)).rejects.toMatchObject({ kind: 'NOT_AVAILABLE' });
  });

  it('requests account analytics with metric types and the app_type split', async () => {
    const { client, seen } = http({
      '/v5/user_account/analytics': [{ MOBILE: { daily_metrics: [] } }],
    });
    await adapter.getAccountMetrics(
      { accessToken: 't', http: client },
      { from: '2026-08-08', to: '2026-11-05', dimension: 'app_type' },
    );
    const q = seen[0]!.url.searchParams;
    expect(q.get('start_date')).toBe('2026-08-08');
    expect(q.get('split_field')).toBe('APP_TYPE');
    expect(q.get('metric_types')).toContain('OUTBOUND_CLICK');
  });
});

describe('PinterestAdapter pin analytics', () => {
  it('requests one pin and returns daily POST points tied to it', async () => {
    const { client, seen } = http({
      '/v5/pins/987/analytics': [
        {
          all: {
            daily_metrics: [
              { date: '2026-11-05', data_status: 'READY', metrics: { IMPRESSION: 4, SAVE: 1 } },
            ],
            lifetime_metrics: { IMPRESSION: 100 },
          },
        },
      ],
    });
    const points = await adapter.getPostMetrics(
      { accessToken: 'at', http: client },
      { postExternalId: '987', from: '2026-08-09', to: '2026-11-06' },
    );
    const q = seen[0]!.url.searchParams;
    expect(q.get('start_date')).toBe('2026-08-09');
    expect(q.get('metric_types')).toBe('IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK');
    expect(points).toEqual([
      expect.objectContaining({
        providerKey: 'IMPRESSION',
        scope: 'POST',
        postExternalId: '987',
        date: '2026-11-05',
        value: 4,
      }),
      expect.objectContaining({
        providerKey: 'SAVE',
        scope: 'POST',
        postExternalId: '987',
        value: 1,
      }),
    ]);
  });
});

describe('mapping', () => {
  it('analytics: statuses, -1 and BEFORE_* become null with the original status kept', () => {
    const points = mapAccountAnalytics({
      all: {
        daily_metrics: [
          { date: '2026-11-04', data_status: 'READY', metrics: { IMPRESSION: 10, SAVE: -1 } },
          { date: '2026-11-05', data_status: 'PROCESSING', metrics: { IMPRESSION: 3 } },
          {
            date: '2026-08-01',
            data_status: 'BEFORE_BUSINESS_CREATED',
            metrics: { IMPRESSION: 0 },
          },
        ],
      },
    });
    expect(points).toEqual([
      {
        providerKey: 'IMPRESSION',
        scope: 'ACCOUNT',
        date: '2026-11-04',
        value: 10,
        dataStatus: 'READY',
        providerStatus: 'READY',
      },
      {
        providerKey: 'SAVE',
        scope: 'ACCOUNT',
        date: '2026-11-04',
        value: null,
        dataStatus: 'UNAVAILABLE',
        providerStatus: 'READY',
      },
      {
        providerKey: 'IMPRESSION',
        scope: 'ACCOUNT',
        date: '2026-11-05',
        value: 3,
        dataStatus: 'PROCESSING',
        providerStatus: 'PROCESSING',
      },
      {
        providerKey: 'IMPRESSION',
        scope: 'ACCOUNT',
        date: '2026-08-01',
        value: null,
        dataStatus: 'UNAVAILABLE',
        providerStatus: 'BEFORE_BUSINESS_CREATED',
      },
    ]);
  });

  it('analytics with a split: each group becomes a dimension value, totals are skipped', () => {
    const day = (n: number) => ({
      daily_metrics: [{ date: '2026-11-04', data_status: 'READY', metrics: { IMPRESSION: n } }],
    });
    const points = mapAccountAnalytics({ all: day(9), MOBILE: day(7), web: day(2) }, 'app_type');
    expect(points.map((p) => [p.dimensions, p.value])).toEqual([
      [{ app_type: 'MOBILE' }, 7],
      [{ app_type: 'WEB' }, 2],
    ]);
  });

  it('pins saved from other accounts are not own', () => {
    expect(mapPin({ id: '1', is_owner: false }).isOwn).toBe(false);
    expect(mapPin({ id: '2', is_owner: true }).isOwn).toBe(true);
    expect(mapPin({ id: '3' }).isOwn).toBe(true);
  });

  it('content type from creative_type and media_type', () => {
    expect(contentType({ id: '1', creative_type: 'SHOPPING' })).toBe('PRODUCT');
    expect(contentType({ id: '1', media: { media_type: 'multiple_images' } })).toBe('CAROUSEL');
    expect(contentType({ id: '1', media: { media_type: 'video' } })).toBe('VIDEO');
    expect(contentType({ id: '1', media: { media_type: 'image' } })).toBe('IMAGE');
    expect(contentType({ id: '1' })).toBe('OTHER');
  });

  it('non-numeric pin_metrics fields (last_updated) are not metrics', () => {
    const points = mapPinMetrics(
      {
        id: '1',
        pin_metrics: {
          lifetime_metrics: { impression: 7, comment: 0, last_updated: '2026-11-06T10:00:00' },
        },
      },
      TODAY,
    );
    expect(points.map((p) => [p.providerKey, p.value])).toEqual([
      ['IMPRESSION', 7],
      ['COMMENT', 0],
    ]);
  });

  it('pins without lifetime metrics yield no points', () => {
    expect(mapPinMetrics({ id: '1', pin_metrics: { '90d': { impression: 1 } } }, TODAY)).toEqual(
      [],
    );
  });
});

describe('Pinterest audience', () => {
  it('maps demographics and interests into sorted shares', async () => {
    const { mapAudience } = await import('./mapping.js');
    const a = mapAudience('engaged', {
      size: 12000,
      categories: [
        { key: 'home_decor', name: 'Home decor', ratio: 0.4 },
        { key: 'diy', name: 'DIY', ratio: 0.6 },
      ],
      demographics: {
        ages: [
          { key: '25-34', name: '25-34', ratio: 0.41 },
          { key: '18-24', name: '18-24', ratio: 0.2 },
        ],
        genders: [{ key: 'female', name: 'female', ratio: 0.8 }],
        devices: [],
      },
    });
    expect(a.size).toBe(12000);
    expect(a.groups['interests']?.map((s) => s.key)).toEqual(['diy', 'home_decor']);
    expect(a.groups['ages']?.[0]).toEqual({ key: '25-34', name: '25-34', ratio: 0.41 });
    expect(a.groups['devices']).toBeUndefined();
  });
});
