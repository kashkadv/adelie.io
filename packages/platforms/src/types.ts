// Platform adapter contract (ADR-0011). Adapters translate a platform API into these normalized shapes
// and know nothing about the database; the sync orchestrator (worker) persists them.
import type { HttpClient } from './http.js';

export type Platform = 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK' | 'ETSY' | 'WEBSITE';

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
  /** Where the post leads (Pinterest: the pin's destination link). */
  link?: string;
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

/** Money in integer minor units of `currency` (e.g. cents), as stored (ADR-0018). */
export interface Money {
  amount: number;
  currency: string;
}

/** A product of a point of sale (Etsy listing). Lifetime counters: null = not reported. */
export interface ProductData {
  externalId: string;
  title: string;
  url?: string;
  imageUrl?: string;
  state: string;
  price: Money | null;
  quantity: number | null;
  views: number | null;
  favorers: number | null;
  tags: string[];
  /** Distinct non-empty SKUs of the product's variations; absent = not read this time. */
  skus?: string[];
  /** Live variations (inventory products); absent = not read this time. */
  variationCount?: number;
  /** Names of the options the SKU goes by (e.g. "Color"); empty = one SKU for the whole listing. */
  skuBy?: string[];
  /** How many SKUs the product should have: one per combination of the `skuBy` options. */
  skuGroups?: number;
  /** Names of the options the variations are made of ("Primary color", "Size"). */
  variationOptions?: string[];
  /** A site feed's own fields (description, brand, category…); absent for shops. */
  details?: Record<string, string>;
  listedAt?: Date;
}

export interface OrderItemData {
  externalId: string;
  productExternalId?: string;
  title?: string;
  quantity: number;
  /** Unit price. */
  price: Money | null;
}

/** An order. Never carries buyer personal data — only the country. */
export interface OrderData {
  externalId: string;
  orderedAt: Date;
  status?: string;
  isPaid?: boolean;
  isShipped?: boolean;
  currency: string;
  /** Minor units of `currency`; null = not reported. */
  total: number | null;
  subtotal: number | null;
  shipping: number | null;
  tax: number | null;
  discount: number | null;
  country?: string;
  items: OrderItemData[];
}

/** One variation of a product (e.g. a colour): its options, price, quantity, on sale or not. */
export interface ProductVariation {
  id: string;
  options: { propertyId: string; name: string; value: string }[];
  price: Money | null;
  quantity: number | null;
  enabled: boolean;
  /** Empty when it has none. */
  sku: string;
}

/** A product as it is on the platform right now, for editing (ADR-0019). */
export interface ProductEditable {
  title: string;
  description: string;
  tags: string[];
  hasVariations: boolean;
  /** Without variations: the price and quantity. With them: the listing's summary values. */
  price: Money | null;
  quantity: number | null;
  state: string;
  /** Without variations — its SKU (empty when none). With them, each variation has its own. */
  sku: string;
  /** Empty without variations. */
  variations: ProductVariation[];
  /** The options the variations are made of (colour, size…) — what a SKU can go by. */
  skuProperties: { id: string; name: string }[];
  /** Ids of the options the SKU goes by; empty = one SKU for all variations. */
  skuOnProperty: string[];
  /** Whether each variation has its own price / quantity (otherwise one value for all). */
  /** Ids of the options the price / quantity go by; empty = one value for all variations. */
  priceOnProperty: string[];
  quantityOnProperty: string[];
}

/** A change to one variation; absent fields stay. Price in minor units. */
export interface VariationChange {
  id: string;
  price?: number;
  quantity?: number;
  enabled?: boolean;
  sku?: string;
}

/** Changes to a product; absent fields stay as they are. Price in minor units of its currency. */
export interface ProductChanges {
  title?: string;
  description?: string;
  tags?: string[];
  price?: number;
  quantity?: number;
  /** The SKU of a product without variations; with variations — per variation. */
  sku?: string;
  /** Which options the SKU / price / quantity go by (ids from `skuProperties`). */
  skuOnProperty?: string[];
  priceOnProperty?: string[];
  quantityOnProperty?: string[];
  variations?: VariationChange[];
}

/** One share of an audience: an age group, a country, an interest… (ratio 0..1). */
export interface AudienceShare {
  key: string;
  name: string;
  ratio: number;
  /** Affinity vs the platform's average user (1.3 = 30% more likely), where given. */
  index?: number;
}

/**
 * Who the account's audience is (account level — platforms give no demographics per post):
 * groups such as `ages`, `genders`, `countries`, `metros`, `devices`, `interests`.
 */
export interface AudienceData {
  /** e.g. `engaged` (people who interacted) or `total` (everyone reached). */
  type: string;
  size: number | null;
  /** `size` is a ceiling ("up to 10k"), not an estimate. */
  sizeIsUpperBound: boolean;
  groups: Record<string, AudienceShare[]>;
}

/** Our grouping of shop money movements (ADR-0018). */
export type LedgerCategory =
  | 'sales'
  | 'tax'
  | 'refund'
  | 'transaction_fee'
  | 'processing_fee'
  | 'listing_fee'
  | 'ads'
  | 'vat'
  | 'payout'
  | 'other';

/** One movement of the shop's payment account. Signed minor units, as the platform reports. */
export interface LedgerEntryData {
  externalId: string;
  occurredAt: Date;
  type: string;
  category: LedgerCategory;
  referenceType?: string;
  referenceId?: string;
  amount: number;
  currency: string;
}

/** PKCE (RFC 7636) for platforms that require it (Etsy). */
export interface Pkce {
  verifier: string;
  challenge: string;
}

/**
 * Access a connection asks for (ADR-0019): `read` — data only; `write` — also changes made on the
 * user's explicit action (e.g. editing Etsy listings). Platforms without levels are always `read`.
 */
export type AccessLevel = 'read' | 'write';

export interface AuthorizeOptions {
  pkce?: Pkce;
  access?: AccessLevel;
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
  /** Access levels a connection can choose (ADR-0019); absent = read only. */
  accessLevels?: AccessLevel[];
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: PlatformCapabilities;

  /** URL to send the user to for consent. `state` must be verified on callback (CSRF). */
  authorizeUrl(state: string, redirectUri: string, options?: AuthorizeOptions): string;
  exchangeCode(
    code: string,
    redirectUri: string,
    http: HttpClient,
    options?: AuthorizeOptions,
  ): Promise<TokenSet>;
  /** `scopes`: what the connection holds now — for platforms that do not echo them (Etsy). */
  refreshToken(refreshToken: string, http: HttpClient, scopes?: string[]): Promise<TokenSet>;

  getAccount(ctx: AdapterContext): Promise<AccountData>;
  listBoards?(ctx: AdapterContext): AsyncIterable<BoardData[]>;
  listPosts(ctx: AdapterContext): AsyncIterable<PostsPage>;
  getAccountMetrics(ctx: AdapterContext, query: AccountMetricsQuery): Promise<MetricPoint[]>;
  /** Daily metrics of one post (ADR-0013): POST-scope points, one per metric per day. */
  getPostMetrics?(ctx: AdapterContext, query: PostMetricsQuery): Promise<MetricPoint[]>;
  /** Points of sale (ADR-0018): every product of the shop, in pages. */
  listProducts?(ctx: AdapterContext): AsyncIterable<ProductData[]>;
  /** Points of sale: orders created since `since` (all of them when absent), in pages. */
  listOrders?(ctx: AdapterContext, query: { since?: Date }): AsyncIterable<OrderData[]>;
  /** Points of sale with full access (ADR-0019): a product as it is now, and changing it. */
  getProductForEdit?(ctx: AdapterContext, productExternalId: string): Promise<ProductEditable>;
  updateProduct?(
    ctx: AdapterContext,
    productExternalId: string,
    changes: ProductChanges,
  ): Promise<ProductEditable>;
  /** Account audience (demographics, interests), when the connection has the permission. */
  getAudience?(ctx: AdapterContext): Promise<AudienceData[]>;
  /** Points of sale: ids of the payments of an order — they key its ledger entries (Etsy). */
  getOrderPaymentIds?(ctx: AdapterContext, orderExternalId: string): Promise<string[]>;
  /** Points of sale: the payment account's movements since `since`, in pages. */
  listLedger?(ctx: AdapterContext, query: { since: Date }): AsyncIterable<LedgerEntryData[]>;
}
