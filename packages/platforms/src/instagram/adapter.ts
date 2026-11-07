// Instagram adapter (ADR-0011, docs/integrations/instagram.md): Graph API via Meta's Unified login
// (Facebook Login for Business with a read-only configuration). Read-only: instagram_basic +
// instagram_manage_insights. The token is a system-user token that does not expire; it can grant
// several Instagram accounts, so every data call names the account (`ctx.accountExternalId`).
import { AdapterError, isAdapterError } from '../errors.js';
import { HttpStatusError, type HttpClient } from '../http.js';
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
  chunkDays,
  daysBetween,
  mapAccount,
  mapDayTotals,
  mapMedia,
  mapMediaInsights,
  mapTimeSeries,
  nextDay,
  type InstagramInsight,
  type InstagramMedia,
  type InstagramUser,
} from './mapping.js';

export const META_GRAPH_API = 'https://graph.facebook.com';
export const META_GRAPH_VERSION = 'v27.0';
export const INSTAGRAM_AUTHORIZE_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

/** Account metrics available per day as a series (PoC: only reach and follower_count do). */
export const INSTAGRAM_SERIES_METRICS = ['reach'] as const;
/** New followers per day: Meta serves only the last 30 days, without today. */
export const INSTAGRAM_FOLLOWER_DAYS = 30;
/** Account metrics available only as a total over a range — requested one day at a time. */
export const INSTAGRAM_DAILY_TOTAL_METRICS = [
  'views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'saves',
  'shares',
  'profile_links_taps',
] as const;
/** Lifetime metrics of feed posts and Reels, fetched together with the media list. */
export const INSTAGRAM_MEDIA_METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'saved',
  'shares',
  'total_interactions',
] as const;

const PROFILE_FIELDS =
  'id,username,name,profile_picture_url,followers_count,follows_count,media_count';
const MEDIA_FIELDS = [
  'id',
  'caption',
  'media_type',
  'media_product_type',
  'permalink',
  'media_url',
  'thumbnail_url',
  'timestamp',
  `insights.metric(${INSTAGRAM_MEDIA_METRICS.join(',')})`,
].join(',');

const v = (path: string) => `/${META_GRAPH_VERSION}${path}`;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

/** Waiting for Meta to assign the selected accounts after login (see exchangeCode). */
const ASSIGNMENT_ATTEMPTS = 8;
const ASSIGNMENT_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

interface GraphError {
  error?: { code?: number; error_subcode?: number; message?: string; type?: string };
}

/** Graph API error codes (developers.facebook.com/docs/graph-api/guides/error-handling). */
function graphError(error: unknown): unknown {
  if (!(error instanceof HttpStatusError)) return error;
  const { status, body } = error;
  const e = (body as GraphError | null)?.error;
  const details = { status, providerCode: e ?? body };
  const code = e?.code;
  // 190: token invalid/expired/revoked. System-user tokens cannot be refreshed — reconnect.
  if (code === 190 || status === 401) {
    return new AdapterError('REAUTH_REQUIRED', 'Meta rejected the access token', details);
  }
  // Throttling: application / user / business use case limits.
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002) {
    return new AdapterError('RATE_LIMITED', 'Meta rate limit reached', {
      ...details,
      retryAfterMs: 60 * 60 * 1000,
    });
  }
  // Permission missing, or the metric is not available for this account (e.g. < 100 followers).
  if (code === 10 || (code !== undefined && code >= 200 && code < 300) || status === 403) {
    return new AdapterError('NOT_AVAILABLE', e?.message ?? 'Not permitted', details);
  }
  return new AdapterError('INVALID', e?.message ?? `Meta returned ${status}`, details);
}

interface DebugTokenResponse {
  data?: {
    is_valid?: boolean;
    scopes?: string[];
    granular_scopes?: { scope: string; target_ids?: string[] }[];
  };
}

export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'INSTAGRAM' as const;
  readonly capabilities = { historyDays: 90, accountDimensions: [], hasBoards: false };

  constructor(private readonly app: { appId: string; appSecret: string; configId: string }) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(INSTAGRAM_AUTHORIZE_URL);
    url.searchParams.set('client_id', this.app.appId);
    url.searchParams.set('config_id', this.app.configId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('override_default_response_type', 'true');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string, http: HttpClient): Promise<TokenSet> {
    let accessToken: string;
    try {
      const { body } = await http.request<{ access_token: string }>({
        path: v('/oauth/access_token'),
        query: {
          client_id: this.app.appId,
          client_secret: this.app.appSecret,
          redirect_uri: redirectUri,
          code,
        },
        sensitive: true,
      });
      accessToken = body.access_token;
    } catch (error) {
      if (error instanceof HttpStatusError) {
        throw new AdapterError('INVALID', `Meta token request failed (${error.status})`, {
          status: error.status,
        });
      }
      throw error;
    }

    // Scopes the person granted (the app's view of the token).
    const { body: debug } = await http.request<DebugTokenResponse>({
      path: v('/debug_token'),
      query: {
        input_token: accessToken,
        access_token: `${this.app.appId}|${this.app.appSecret}`,
      },
      sensitive: true,
    });
    if (debug.data?.is_valid === false) {
      throw new AdapterError('INVALID', 'Meta returned an invalid token');
    }
    // Which Instagram accounts the person selected: granular scopes may carry their ids; the
    // system user's assigned accounts list them too (dashboard tokens have only the latter).
    const ids = new Set<string>(
      (debug.data?.granular_scopes ?? [])
        .filter((g) => g.scope === 'instagram_basic' || g.scope === 'instagram_manage_insights')
        .flatMap((g) => g.target_ids ?? []),
    );
    // Meta assigns the selected accounts to the system user shortly after the redirect: when the
    // list is still empty, ask again for a few seconds.
    for (let attempt = 0; ids.size === 0 && attempt < ASSIGNMENT_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(ASSIGNMENT_DELAY_MS);
      for (const id of await this.assignedAccounts(accessToken, http)) ids.add(id);
      if (ids.size) console.log(`Instagram accounts assigned after attempt ${attempt + 1}`);
    }
    return { accessToken, scopes: debug.data?.scopes ?? [], accountIds: [...ids] };
  }

  private async assignedAccounts(accessToken: string, http: HttpClient): Promise<string[]> {
    const ids: string[] = [];
    let after: string | undefined;
    do {
      const { body } = await http.request<{
        data?: { id: string }[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>({
        path: v('/me/assigned_instagram_accounts'),
        query: { limit: 100, after },
        headers: { Authorization: `Bearer ${accessToken}` },
        sensitive: true,
      });
      for (const a of body.data ?? []) ids.push(a.id);
      after = body.paging?.next ? body.paging.cursors?.after : undefined;
    } while (after);
    return ids;
  }

  refreshToken(): Promise<TokenSet> {
    // System-user tokens never expire and have no refresh token: a rejected token means reconnect.
    return Promise.reject(
      new AdapterError('REAUTH_REQUIRED', 'Instagram tokens cannot be refreshed'),
    );
  }

  private account(ctx: AdapterContext): string {
    if (!ctx.accountExternalId)
      throw new AdapterError('INVALID', 'Instagram account id is required');
    return ctx.accountExternalId;
  }

  private async get<T>(
    ctx: AdapterContext,
    path: string,
    query: Record<string, string | number | undefined>,
  ): Promise<T> {
    try {
      const { body } = await ctx.http.request<T>({
        path: v(path),
        query,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        bucket: 'instagram',
        signal: ctx.signal,
      });
      return body;
    } catch (error) {
      throw graphError(error);
    }
  }

  async getAccount(ctx: AdapterContext): Promise<AccountData> {
    const raw = await this.get<InstagramUser>(ctx, `/${this.account(ctx)}`, {
      fields: PROFILE_FIELDS,
    });
    return mapAccount(raw, ctx.today ?? utcToday());
  }

  async *listPosts(ctx: AdapterContext): AsyncIterable<PostsPage> {
    const today = ctx.today ?? utcToday();
    let after: string | undefined;
    do {
      // Nested `insights` returns lifetime metrics of the whole page in one request.
      const page = await this.get<{
        data?: InstagramMedia[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>(ctx, `/${this.account(ctx)}/media`, { fields: MEDIA_FIELDS, limit: 50, after });
      const media = page.data ?? [];
      yield {
        posts: media.map(mapMedia),
        metrics: media.flatMap((m) => mapMediaInsights(m, today)),
      };
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
    } while (after);
  }

  async getAccountMetrics(ctx: AdapterContext, query: AccountMetricsQuery): Promise<MetricPoint[]> {
    if (query.dimension) {
      throw new AdapterError(
        'NOT_AVAILABLE',
        `Instagram breakdown "${query.dimension}" not supported`,
      );
    }
    const id = this.account(ctx);
    const today = ctx.today ?? utcToday();
    const points: MetricPoint[] = [];

    // Daily series, at most 30 days per request.
    for (const chunk of chunkDays(query.from, query.to)) {
      const body = await this.get<{ data?: InstagramInsight[] }>(ctx, `/${id}/insights`, {
        metric: INSTAGRAM_SERIES_METRICS.join(','),
        period: 'day',
        metric_type: 'time_series',
        since: chunk.from,
        until: nextDay(chunk.to),
      });
      points.push(...mapTimeSeries(body.data ?? [], today));
    }

    // New followers: a series limited to the last 30 full days.
    const followersFrom = [query.from, addDays(today, -INSTAGRAM_FOLLOWER_DAYS)].sort()[1]!;
    const followersTo = [query.to, addDays(today, -1)].sort()[0]!;
    if (followersFrom <= followersTo) {
      try {
        const body = await this.get<{ data?: InstagramInsight[] }>(ctx, `/${id}/insights`, {
          metric: 'follower_count',
          period: 'day',
          metric_type: 'time_series',
          since: followersFrom,
          until: nextDay(followersTo),
        });
        points.push(...mapTimeSeries(body.data ?? [], today));
      } catch (error) {
        // Not served for some accounts (e.g. under 100 followers): the other metrics still count.
        if (!isAdapterError(error, 'INVALID') && !isAdapterError(error, 'NOT_AVAILABLE'))
          throw error;
      }
    }

    // Totals-only metrics: one request per day yields that day's values.
    for (const date of daysBetween(query.from, query.to)) {
      const body = await this.get<{ data?: InstagramInsight[] }>(ctx, `/${id}/insights`, {
        metric: INSTAGRAM_DAILY_TOTAL_METRICS.join(','),
        period: 'day',
        metric_type: 'total_value',
        since: date,
        until: nextDay(date),
      });
      points.push(...mapDayTotals(body.data ?? [], date, today));
    }

    // Series may reach past the requested range (Meta aligns days to its own time zone).
    return points.filter((p) => p.date >= query.from && p.date <= query.to);
  }
}
