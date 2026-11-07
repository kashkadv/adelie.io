// Platform adapter contract (ADR-0011). Adapters translate a platform API into these normalized shapes
// and know nothing about the database; the sync orchestrator (worker) persists them.
import type { HttpClient } from './http.js';

export type Platform = 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK';

/** Mirrors the DataStatus enum in the database. */
export type DataStatus = 'READY' | 'PROCESSING' | 'ESTIMATE' | 'UNAVAILABLE';

export type PostContentType = 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'PRODUCT' | 'OTHER';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scopes: string[];
  /**
   * Platform accounts the token grants, when one token can cover several (Meta: the Instagram
   * accounts the person selected). Absent = the token belongs to exactly one account.
   */
  accountIds?: string[];
}

export interface AccountData {
  externalId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  accountType?: string;
  /** null = the platform did not report it (never 0 by assumption). */
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  /** Profile-level snapshot metrics (e.g. Pinterest monthly_views), as metric points dated today. */
  metrics: MetricPoint[];
}

export interface BoardData {
  externalId: string;
  name: string;
  description?: string;
  privacy?: string;
  pinCount?: number;
  coverUrl?: string;
}

export interface PostData {
  externalId: string;
  url?: string;
  contentType: PostContentType;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  publishedAt?: Date;
  boardExternalId?: string;
  /** false = someone else's post saved by this account (e.g. a Pinterest repin); default true. */
  isOwn?: boolean;
}

/** One value of one metric. Names are the platform's own (`IMPRESSION`); the orchestrator maps them. */
export interface MetricPoint {
  providerKey: string;
  scope: 'ACCOUNT' | 'POST';
  postExternalId?: string;
  /** Platform day or snapshot date, YYYY-MM-DD (UTC). */
  date: string;
  /** null = no data. Never substitute 0. */
  value: number | null;
  dataStatus: DataStatus;
  /** The platform's original status, e.g. BEFORE_BUSINESS_CREATED. */
  providerStatus?: string;
  /** Breakdown, e.g. { app_type: 'MOBILE' }; absent = totals. */
  dimensions?: Record<string, string>;
}

export interface PostsPage {
  posts: PostData[];
  /** Post-level metric snapshots that came with the page (Pinterest: pin_metrics=true). */
  metrics: MetricPoint[];
}

export interface AdapterContext {
  accessToken: string;
  /** The platform account the call is about — required where a token covers several (Instagram). */
  accountExternalId?: string;
  http: HttpClient;
  signal?: AbortSignal;
  /** Today's date (UTC, YYYY-MM-DD) for snapshot metrics; injectable for tests. */
  today?: string;
}

export interface AccountMetricsQuery {
  from: string;
  to: string;
  /** Breakdown dimension, e.g. 'app_type'; omitted = totals only. */
  dimension?: string;
}

export interface PostMetricsQuery {
  postExternalId: string;
  /** Inclusive days, YYYY-MM-DD; `from` no earlier than `capabilities.historyDays` ago. */
  from: string;
  to: string;
}

export interface PlatformCapabilities {
  /** How far back the platform returns history, in days. */
  historyDays: number;
  /** Dimensions supported for account metrics. */
  accountDimensions: string[];
  hasBoards: boolean;
  /**
   * No daily post values from the platform: the sync derives them from the day-to-day change of the
   * lifetime totals (ADR-0017). Platforms with `getPostMetrics` never need this.
   */
  postDailyFromSnapshots?: boolean;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: PlatformCapabilities;

  /** URL to send the user to for consent. `state` must be verified on callback (CSRF). */
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string, http: HttpClient): Promise<TokenSet>;
  refreshToken(refreshToken: string, http: HttpClient): Promise<TokenSet>;

  getAccount(ctx: AdapterContext): Promise<AccountData>;
  listBoards?(ctx: AdapterContext): AsyncIterable<BoardData[]>;
  listPosts(ctx: AdapterContext): AsyncIterable<PostsPage>;
  getAccountMetrics(ctx: AdapterContext, query: AccountMetricsQuery): Promise<MetricPoint[]>;
  /** Daily metrics of one post (ADR-0013): POST-scope points, one per metric per day. */
  getPostMetrics?(ctx: AdapterContext, query: PostMetricsQuery): Promise<MetricPoint[]>;
}
