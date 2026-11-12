// TikTok adapter (ADR-0011, ADR-0023): Login Kit (OAuth) + Display API v2, read-only. The profile,
// its stats and the user's public videos with lifetime counters. Access tokens last a day and are
// refreshed; the refresh token lasts a year (and may be replaced on refresh).
import { AdapterError } from '../errors.js';
import { HttpStatusError, type HttpClient } from '../http.js';
import { requestedScopes } from '../features.js';
import type {
  AccountData,
  AccountMetricsQuery,
  AdapterContext,
  MetricPoint,
  PlatformAdapter,
  PostsPage,
  TokenSet,
} from '../types.js';
import {
  mapAccount,
  mapVideo,
  mapVideoMetrics,
  TIKTOK_USER_FIELDS_ALL,
  TIKTOK_USER_FIELDS_BASIC,
  TIKTOK_VIDEO_FIELDS,
  type TiktokUser,
  type TiktokVideo,
} from './mapping.js';

export const TIKTOK_API = 'https://open.tiktokapis.com';
export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
/** Read-only scopes of every feature (features.ts). */
export const TIKTOK_SCOPES = requestedScopes('TIKTOK');

/** Videos per page: the API allows up to 20. */
const PAGE_SIZE = 20;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Maps a TikTok error code of a data endpoint to a typed error. */
function apiError(code: string | undefined, message: string | undefined, status?: number) {
  const details = { status, providerCode: { code, message } };
  if (code === 'access_token_invalid' || status === 401)
    return new AdapterError('TOKEN_EXPIRED', 'TikTok rejected the access token', details);
  if (code === 'scope_not_authorized' || code === 'scope_permission_missed')
    return new AdapterError('NOT_AVAILABLE', message ?? 'Scope not granted', details);
  if (code === 'rate_limit_exceeded' || status === 429)
    return new AdapterError('RATE_LIMITED', 'TikTok rate limit reached', {
      ...details,
      retryAfterMs: 60_000,
    });
  if (code === 'internal_error')
    return new AdapterError('TRANSIENT', message ?? 'TikTok internal error', details);
  return new AdapterError('INVALID', message ?? `TikTok returned ${code ?? status}`, details);
}

/** The API answers 200 with an error code in the body too: `ok` (or none) is success. */
function unwrap<T>(body: ApiEnvelope<T> | null): T {
  const code = body?.error?.code;
  if (code && code !== 'ok') throw apiError(code, body?.error?.message);
  return (body?.data ?? {}) as T;
}

export class TiktokAdapter implements PlatformAdapter {
  readonly platform = 'TIKTOK' as const;
  readonly capabilities = {
    // The Display API has no history and no daily series: only lifetime totals.
    historyDays: 1,
    accountDimensions: [],
    hasBoards: false,
    postDailyFromSnapshots: true,
  };

  constructor(private readonly app: { clientKey: string; clientSecret: string }) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(TIKTOK_AUTHORIZE_URL);
    url.searchParams.set('client_key', this.app.clientKey);
    url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  exchangeCode(code: string, redirectUri: string, http: HttpClient): Promise<TokenSet> {
    return this.token(
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
      http,
      'INVALID',
    );
  }

  async refreshToken(refreshToken: string, http: HttpClient): Promise<TokenSet> {
    const tokens = await this.token(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      http,
      'REAUTH_REQUIRED',
    );
    // The refresh token may be replaced: keep the old one when it is not.
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
  }

  private async token(
    form: Record<string, string>,
    http: HttpClient,
    rejected: 'INVALID' | 'REAUTH_REQUIRED',
  ): Promise<TokenSet> {
    let body: TokenResponse | null;
    try {
      const response = await http.request<TokenResponse>({
        method: 'POST',
        path: '/v2/oauth/token/',
        headers: { 'Cache-Control': 'no-cache' },
        form: { client_key: this.app.clientKey, client_secret: this.app.clientSecret, ...form },
        sensitive: true,
      });
      body = response.body;
    } catch (error) {
      if (error instanceof HttpStatusError) {
        throw new AdapterError(rejected, `TikTok token request failed (${error.status})`, {
          status: error.status,
          providerCode: (error.body as TokenResponse | null)?.error,
        });
      }
      throw error;
    }
    // A rejected code or refresh token may come as 200 with an `error` field.
    if (!body || body.error || !body.access_token) {
      throw new AdapterError(rejected, 'TikTok did not issue a token', {
        providerCode: body?.error ?? null,
      });
    }
    const now = Date.now();
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      accessTokenExpiresAt:
        typeof body.expires_in === 'number' ? new Date(now + body.expires_in * 1000) : undefined,
      refreshTokenExpiresAt:
        typeof body.refresh_expires_in === 'number'
          ? new Date(now + body.refresh_expires_in * 1000)
          : undefined,
      scopes: (body.scope ?? '').split(',').filter(Boolean),
    };
  }

  private async call<T>(
    ctx: AdapterContext,
    opts: { method?: 'GET' | 'POST'; path: string; query: Record<string, string>; json?: unknown },
  ): Promise<T> {
    try {
      const { body } = await ctx.http.request<ApiEnvelope<T>>({
        ...opts,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        bucket: 'tiktok',
        signal: ctx.signal,
      });
      return unwrap(body);
    } catch (error) {
      if (error instanceof HttpStatusError) {
        const e = (error.body as ApiEnvelope<unknown> | null)?.error;
        throw apiError(e?.code, e?.message, error.status);
      }
      throw error;
    }
  }

  async getAccount(ctx: AdapterContext): Promise<AccountData> {
    const today = ctx.today ?? utcToday();
    const read = (fields: string) =>
      this.call<{ user?: TiktokUser }>(ctx, {
        path: '/v2/user/info/',
        query: { fields },
      });
    let data: { user?: TiktokUser };
    try {
      data = await read(TIKTOK_USER_FIELDS_ALL);
    } catch (error) {
      // A connection without the profile or stats permission still has its basic profile.
      if (!(error instanceof AdapterError) || error.kind !== 'NOT_AVAILABLE') throw error;
      data = await read(TIKTOK_USER_FIELDS_BASIC);
    }
    if (!data.user?.open_id) throw new AdapterError('INVALID', 'TikTok returned no user');
    return mapAccount(data.user, today);
  }

  async *listPosts(ctx: AdapterContext): AsyncIterable<PostsPage> {
    const today = ctx.today ?? utcToday();
    let cursor: number | undefined;
    for (;;) {
      const data = await this.call<{
        videos?: TiktokVideo[];
        cursor?: number;
        has_more?: boolean;
      }>(ctx, {
        method: 'POST',
        path: '/v2/video/list/',
        query: { fields: TIKTOK_VIDEO_FIELDS },
        json: { max_count: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
      });
      const videos = data.videos ?? [];
      yield {
        posts: videos.map(mapVideo),
        metrics: videos.flatMap((v) => mapVideoMetrics(v, today)),
      };
      if (!data.has_more || typeof data.cursor !== 'number') return;
      cursor = data.cursor;
    }
  }

  /** The Display API has no account time series: snapshots (followers, likes) come with getAccount. */
  getAccountMetrics(_ctx: AdapterContext, _query: AccountMetricsQuery): Promise<MetricPoint[]> {
    return Promise.resolve([]);
  }
}
