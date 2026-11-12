import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http.js';
import { isAdapterError } from '../errors.js';
import type { PostsPage } from '../types.js';
import { TiktokAdapter } from './adapter.js';
import { cleanShareUrl, mapAccount, mapVideo, mapVideoMetrics } from './mapping.js';

const TODAY = '2026-11-12';
const adapter = new TiktokAdapter({ clientKey: 'KEY', clientSecret: 'shh' });

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
    baseUrl: 'https://open.tiktokapis.com',
    fetch: fetchFn as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { client, seen };
}

const ok = <T>(data: T) => ({ data, error: { code: 'ok', message: '', log_id: 'L' } });
const user = {
  open_id: 'OPEN1',
  display_name: 'Tacho Mod',
  username: 'tacho.mod',
  avatar_large_url: 'https://p/av.jpg',
  follower_count: 120,
  following_count: 7,
  likes_count: 950,
  video_count: 3,
};
const video = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: '',
  video_description: 'First line\nsecond line #ets2',
  create_time: 1_762_900_000,
  cover_image_url: 'https://p/cover.jpg',
  share_url: `https://www.tiktok.com/@tacho.mod/video/${id}?utm_campaign=tt4d_open_api&utm_source=abc`,
  view_count: 1000,
  like_count: 50,
  comment_count: 5,
  share_count: 2,
  ...over,
});

describe('TiktokAdapter OAuth', () => {
  it('builds the authorize URL with the four read-only scopes', () => {
    const url = new URL(adapter.authorizeUrl('st-1', 'https://api/social/tiktok/callback'));
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: 'KEY',
      scope: 'user.info.basic,user.info.profile,user.info.stats,video.list',
      response_type: 'code',
      redirect_uri: 'https://api/social/tiktok/callback',
      state: 'st-1',
    });
  });

  it('exchanges the code (form body, flat answer) and reads the lifetimes', async () => {
    const { client, seen } = http({
      '/v2/oauth/token/': [
        {
          access_token: 'act.x',
          expires_in: 86400,
          open_id: 'OPEN1',
          refresh_token: 'rft.x',
          refresh_expires_in: 31536000,
          scope: 'user.info.basic,video.list',
          token_type: 'Bearer',
        },
      ],
    });
    const before = Date.now();
    const tokens = await adapter.exchangeCode('CODE', 'https://cb', client);
    expect(tokens.accessToken).toBe('act.x');
    expect(tokens.refreshToken).toBe('rft.x');
    expect(tokens.scopes).toEqual(['user.info.basic', 'video.list']);
    expect(tokens.accessTokenExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(tokens.refreshTokenExpiresAt!.getTime()).toBeGreaterThan(before + 300 * 86_400_000);
    const body = new URLSearchParams(String(seen[0]!.init.body));
    expect(Object.fromEntries(body)).toEqual({
      client_key: 'KEY',
      client_secret: 'shh',
      grant_type: 'authorization_code',
      code: 'CODE',
      redirect_uri: 'https://cb',
    });
  });

  it('a rejected code is INVALID even when TikTok answers 200 with an error field', async () => {
    const { client } = http({ '/v2/oauth/token/': [{ error: 'invalid_grant' }] });
    await expect(adapter.exchangeCode('BAD', 'https://cb', client)).rejects.toSatisfy((e) =>
      isAdapterError(e, 'INVALID'),
    );
  });

  it('refreshing keeps the old refresh token when none is returned, and asks to reconnect when rejected', async () => {
    const good = http({
      '/v2/oauth/token/': [{ access_token: 'act.2', expires_in: 86400, scope: 'video.list' }],
    });
    const tokens = await adapter.refreshToken('rft.old', good.client);
    expect(tokens.refreshToken).toBe('rft.old');

    const bad = http({
      '/v2/oauth/token/': [
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      ],
    });
    await expect(adapter.refreshToken('rft.old', bad.client)).rejects.toSatisfy((e) =>
      isAdapterError(e, 'REAUTH_REQUIRED'),
    );
  });
});

describe('TiktokAdapter data', () => {
  const ctx = (client: HttpClient) => ({ accessToken: 'act.x', http: client, today: TODAY });

  it('reads the profile with its stats, and snapshots as account metrics', async () => {
    const { client, seen } = http({ '/v2/user/info/': [ok({ user })] });
    const account = await adapter.getAccount(ctx(client));
    expect(account).toMatchObject({
      externalId: 'OPEN1',
      username: 'tacho.mod',
      displayName: 'Tacho Mod',
      avatarUrl: 'https://p/av.jpg',
      followersCount: 120,
      followingCount: 7,
      postsCount: 3,
    });
    expect(account.metrics.map((m) => [m.providerKey, m.value])).toEqual([
      ['follower_count', 120],
      ['likes_count', 950],
      ['video_count', 3],
    ]);
    expect((seen[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer act.x');
  });

  it('falls back to the basic profile when a scope is missing', async () => {
    const { client, seen } = http({
      '/v2/user/info/': [
        new Response(
          JSON.stringify({ error: { code: 'scope_not_authorized', message: 'no stats' } }),
          { status: 403 },
        ),
        ok({ user: { open_id: 'OPEN1', display_name: 'Tacho Mod' } }),
      ],
    });
    const account = await adapter.getAccount(ctx(client));
    expect(account.externalId).toBe('OPEN1');
    expect(account.followersCount).toBeNull(); // not reported, never 0
    expect(seen).toHaveLength(2);
    expect(seen[1]!.url.searchParams.get('fields')).not.toContain('follower_count');
  });

  it('pages through the videos by cursor, with lifetime counters', async () => {
    const { client, seen } = http({
      '/v2/video/list/': [
        ok({ videos: [video('1'), video('2')], cursor: 1_762_000_000_000, has_more: true }),
        ok({ videos: [video('3', { view_count: undefined })], cursor: 1, has_more: false }),
      ],
    });
    const pages: PostsPage[] = [];
    for await (const page of adapter.listPosts(ctx(client))) pages.push(page);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.posts.map((p) => p.externalId)).toEqual(['1', '2']);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ max_count: 20 });
    expect(JSON.parse(String(seen[1]!.init.body))).toEqual({
      max_count: 20,
      cursor: 1_762_000_000_000,
    });
    const third = pages[1]!.metrics.find((m) => m.providerKey === 'view_count')!;
    expect(third.value).toBeNull();
    expect(third.dataStatus).toBe('UNAVAILABLE');
  });

  it('maps API errors to typed errors, also when they come with status 200', async () => {
    const expired = http({
      '/v2/video/list/': [
        new Response(JSON.stringify({ error: { code: 'access_token_invalid' } }), { status: 401 }),
      ],
    });
    await expect(
      adapter.listPosts(ctx(expired.client))[Symbol.asyncIterator]().next(),
    ).rejects.toSatisfy((e) => isAdapterError(e, 'TOKEN_EXPIRED'));

    const limited = http({
      '/v2/user/info/': [
        { data: {}, error: { code: 'rate_limit_exceeded', message: 'slow down' } },
      ],
    });
    await expect(adapter.getAccount(ctx(limited.client))).rejects.toSatisfy((e) =>
      isAdapterError(e, 'RATE_LIMITED'),
    );
  });

  it('has no account time series: the snapshots are the account metrics', async () => {
    const { client } = http({});
    expect(await adapter.getAccountMetrics(ctx(client), { from: TODAY, to: TODAY })).toEqual([]);
  });
});

describe('TikTok mapping', () => {
  it('a video: first line of the description stands in for a missing title, tracking removed', () => {
    const post = mapVideo(video('7'));
    expect(post).toMatchObject({
      externalId: '7',
      contentType: 'VIDEO',
      title: 'First line',
      url: 'https://www.tiktok.com/@tacho.mod/video/7',
      thumbnailUrl: 'https://p/cover.jpg',
      isOwn: true,
    });
    expect(post.publishedAt!.toISOString()).toBe('2025-11-11T22:26:40.000Z');
    expect(cleanShareUrl(undefined)).toBeUndefined();
  });

  it('counters are lifetime snapshot points; missing is null, never zero', () => {
    const points = mapVideoMetrics(video('7', { share_count: undefined }), TODAY);
    expect(points.map((p) => [p.providerKey, p.value])).toEqual([
      ['view_count', 1000],
      ['like_count', 50],
      ['comment_count', 5],
      ['share_count', null],
    ]);
    expect(points.every((p) => p.scope === 'POST' && p.postExternalId === '7')).toBe(true);
  });

  it('an account without stats permission reports null counts', () => {
    expect(mapAccount({ open_id: 'X' }, TODAY).followersCount).toBeNull();
  });
});
