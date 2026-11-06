// Pinterest API v5 adapter (ADR-0011, docs/integrations/pinterest.md). Read-only scopes.
import { AdapterError } from '../errors.js';
import { HttpStatusError, type HttpClient } from '../http.js';
import type {
  AccountData,
  AccountMetricsQuery,
  AdapterContext,
  BoardData,
  MetricPoint,
  PlatformAdapter,
  PostMetricsQuery,
  PostsPage,
  TokenSet,
} from '../types.js';
import {
  mapAccount,
  mapAccountAnalytics,
  mapBoard,
  mapPin,
  mapPinAnalytics,
  mapPinMetrics,
  type PinterestAnalyticsResponse,
  type PinterestBoard,
  type PinterestPin,
  type PinterestUserAccount,
} from './mapping.js';

export const PINTEREST_API = 'https://api.pinterest.com';
export const PINTEREST_AUTHORIZE_URL = 'https://www.pinterest.com/oauth/';
export const PINTEREST_SCOPES = ['user_accounts:read', 'pins:read', 'boards:read'] as const;

/** Account metrics we request (docs/integrations/pinterest.md; seeded in metric_definition). */
export const PINTEREST_ACCOUNT_METRICS = [
  'IMPRESSION',
  'ENGAGEMENT',
  'ENGAGEMENT_RATE',
  'PIN_CLICK',
  'PIN_CLICK_RATE',
  'OUTBOUND_CLICK',
  'OUTBOUND_CLICK_RATE',
  'SAVE',
  'SAVE_RATE',
] as const;

/** Daily pin metrics we request (ADR-0013); the same provider keys as the lifetime pin metrics. */
export const PINTEREST_PIN_DAILY_METRICS = [
  'IMPRESSION',
  'SAVE',
  'PIN_CLICK',
  'OUTBOUND_CLICK',
] as const;

/** Rate-limit buckets as Pinterest reports them (PoC 1): reads 1000/min, analytics 60/min. */
const READ = 'org_read';
const ANALYTICS = 'org_analytics';

const DIMENSION_SPLIT: Record<string, string> = { app_type: 'APP_TYPE' };

interface Page<T> {
  items?: T[];
  bookmark?: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Maps a Pinterest 4xx on a data endpoint to a typed error. */
function dataError(error: unknown): unknown {
  if (!(error instanceof HttpStatusError)) return error;
  const { status, body } = error;
  if (status === 401)
    return new AdapterError('TOKEN_EXPIRED', 'Pinterest rejected the access token', {
      status,
      providerCode: body,
    });
  if (status === 403)
    return new AdapterError('NOT_AVAILABLE', 'Not permitted by scopes or access tier', {
      status,
      providerCode: body,
    });
  return new AdapterError('INVALID', `Pinterest returned ${status}`, {
    status,
    providerCode: body,
  });
}

export class PinterestAdapter implements PlatformAdapter {
  readonly platform = 'PINTEREST' as const;
  readonly capabilities = { historyDays: 90, accountDimensions: ['app_type'], hasBoards: true };

  constructor(private readonly app: { appId: string; appSecret: string }) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(PINTEREST_AUTHORIZE_URL);
    url.searchParams.set('client_id', this.app.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', PINTEREST_SCOPES.join(','));
    url.searchParams.set('state', state);
    return url.toString();
  }

  exchangeCode(code: string, redirectUri: string, http: HttpClient): Promise<TokenSet> {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, http);
  }

  async refreshToken(refreshToken: string, http: HttpClient): Promise<TokenSet> {
    try {
      const tokens = await this.token(
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        http,
      );
      // Pinterest may not rotate the refresh token: keep the old one then.
      return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
    } catch (error) {
      if (error instanceof AdapterError && error.kind === 'INVALID') {
        throw new AdapterError(
          'REAUTH_REQUIRED',
          'Refresh token rejected — the user must reconnect',
          error.details,
        );
      }
      throw error;
    }
  }

  private async token(form: Record<string, string>, http: HttpClient): Promise<TokenSet> {
    const basic = Buffer.from(`${this.app.appId}:${this.app.appSecret}`).toString('base64');
    try {
      const { body } = await http.request<TokenResponse>({
        method: 'POST',
        path: '/v5/oauth/token',
        headers: { Authorization: `Basic ${basic}` },
        form,
        bucket: READ,
        sensitive: true, // the body holds tokens — never recorded
      });
      const now = Date.now();
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        accessTokenExpiresAt: body.expires_in ? new Date(now + body.expires_in * 1000) : undefined,
        refreshTokenExpiresAt: body.refresh_token_expires_in
          ? new Date(now + body.refresh_token_expires_in * 1000)
          : undefined,
        scopes: (body.scope ?? '').split(/[\s,]+/).filter(Boolean),
      };
    } catch (error) {
      if (error instanceof HttpStatusError) {
        // Token requests have no "expired" state: any 4xx means the grant itself is bad.
        throw new AdapterError('INVALID', `Pinterest token request failed (${error.status})`, {
          status: error.status,
        });
      }
      throw error;
    }
  }

  private async get<T>(
    ctx: AdapterContext,
    path: string,
    query: Record<string, string | number | undefined>,
    bucket: string,
  ): Promise<T> {
    try {
      const { body } = await ctx.http.request<T>({
        path,
        query,
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
        bucket,
        signal: ctx.signal,
      });
      return body;
    } catch (error) {
      throw dataError(error);
    }
  }

  async getAccount(ctx: AdapterContext): Promise<AccountData> {
    const raw = await this.get<PinterestUserAccount>(ctx, '/v5/user_account', {}, READ);
    return mapAccount(raw, ctx.today ?? utcToday());
  }

  async *listBoards(ctx: AdapterContext): AsyncIterable<BoardData[]> {
    let bookmark: string | undefined;
    do {
      const page = await this.get<Page<PinterestBoard>>(
        ctx,
        '/v5/boards',
        { page_size: 100, bookmark },
        READ,
      );
      yield (page.items ?? []).map(mapBoard);
      bookmark = page.bookmark ?? undefined;
    } while (bookmark);
  }

  async *listPosts(ctx: AdapterContext): AsyncIterable<PostsPage> {
    const today = ctx.today ?? utcToday();
    let bookmark: string | undefined;
    do {
      // pin_metrics=true returns metrics for a whole page at once — far cheaper than
      // a per-pin analytics request against the 60/min analytics limit.
      const page = await this.get<Page<PinterestPin>>(
        ctx,
        '/v5/pins',
        { page_size: 100, pin_metrics: 'true', bookmark },
        READ,
      );
      const pins = page.items ?? [];
      yield { posts: pins.map(mapPin), metrics: pins.flatMap((p) => mapPinMetrics(p, today)) };
      bookmark = page.bookmark ?? undefined;
    } while (bookmark);
  }

  async getAccountMetrics(ctx: AdapterContext, query: AccountMetricsQuery): Promise<MetricPoint[]> {
    const split = query.dimension ? DIMENSION_SPLIT[query.dimension] : undefined;
    if (query.dimension && !split) {
      throw new AdapterError('NOT_AVAILABLE', `Pinterest has no "${query.dimension}" breakdown`);
    }
    const raw = await this.get<PinterestAnalyticsResponse>(
      ctx,
      '/v5/user_account/analytics',
      {
        start_date: query.from,
        end_date: query.to,
        metric_types: PINTEREST_ACCOUNT_METRICS.join(','),
        split_field: split,
      },
      ANALYTICS,
    );
    return mapAccountAnalytics(raw, query.dimension);
  }

  async getPostMetrics(ctx: AdapterContext, query: PostMetricsQuery): Promise<MetricPoint[]> {
    const raw = await this.get<PinterestAnalyticsResponse>(
      ctx,
      `/v5/pins/${encodeURIComponent(query.postExternalId)}/analytics`,
      {
        start_date: query.from,
        end_date: query.to,
        metric_types: PINTEREST_PIN_DAILY_METRICS.join(','),
        app_types: 'ALL',
      },
      ANALYTICS,
    );
    return mapPinAnalytics(raw, query.postExternalId);
  }
}
