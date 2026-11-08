// Etsy adapter (ADR-0011, ADR-0018): the first point of sale. OAuth 2.0 with PKCE; every request
// carries `x-api-key: <keystring>:<shared secret>` (docs/specs/pebble.md, PoC 2026-11-08).
// Read-only for now: shop, products (listings) and orders (receipts) — never buyer personal data.
import { AdapterError } from '../errors.js';
import { HttpStatusError, type HttpClient } from '../http.js';
import type {
  AccessLevel,
  AccountData,
  AdapterContext,
  AuthorizeOptions,
  LedgerEntryData,
  MetricPoint,
  OrderData,
  PlatformAdapter,
  PostsPage,
  ProductChanges,
  ProductEditable,
  ProductVariation,
  ProductData,
  TokenSet,
} from '../types.js';
import {
  mapLedgerEntry,
  mapListing,
  minorDigits,
  money,
  productChangeErrors,
  unescapeHtml,
  mapReceipt,
  mapShop,
  type EtsyLedgerEntry,
  type EtsyListing,
  type EtsyReceipt,
  type EtsyShop,
} from './mapping.js';

export const ETSY_API = 'https://api.etsy.com';
export const ETSY_AUTHORIZE_URL = 'https://www.etsy.com/oauth/connect';
/** Read the shop, its listings (all states) and its orders. */
export const ETSY_SCOPES = ['shops_r', 'listings_r', 'transactions_r'];
/**
 * Full access (ADR-0019) adds editing and creating listings — never deleting them (`listings_d`)
 * and never touching orders or the shop's settings.
 */
export const ETSY_WRITE_SCOPES = ['listings_w'];
export const etsyScopes = (access: AccessLevel = 'read') =>
  access === 'write' ? [...ETSY_SCOPES, ...ETSY_WRITE_SCOPES] : ETSY_SCOPES;
/** Listing states a shop owner can see (`listings_r`). */
const LISTING_STATES = ['active', 'inactive', 'sold_out', 'draft', 'expired'] as const;
const PAGE = 100;
/** The ledger endpoint accepts at most 31 days per request. */
const LEDGER_WINDOW_S = 31 * 86_400;
/** Etsy refresh tokens live 90 days; access tokens an hour. */
const REFRESH_TOKEN_DAYS = 90;

const v3 = (path: string) => `/v3/application${path}`;

interface EtsyPropertyValue {
  property_id: number;
  property_name?: string | null;
  scale_id?: number | null;
  value_ids?: number[];
  values?: string[];
}

interface EtsyInventory {
  products?: {
    product_id?: number;
    is_deleted?: boolean;
    sku?: string;
    property_values?: EtsyPropertyValue[];
    offerings?: {
      price?: { amount: number; divisor: number; currency_code: string };
      quantity?: number;
      is_enabled?: boolean;
      is_deleted?: boolean;
      readiness_state_id?: number;
    }[];
  }[];
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Etsy HTTP errors → adapter errors. */
function etsyError(error: unknown): unknown {
  if (!(error instanceof HttpStatusError)) return error;
  const { status, body } = error;
  const details = { status, providerCode: body };
  if (status === 401) return new AdapterError('TOKEN_EXPIRED', 'Etsy rejected the token', details);
  if (status === 403 || status === 404) {
    return new AdapterError('NOT_AVAILABLE', `Etsy returned ${status}`, details);
  }
  if (status === 429) {
    return new AdapterError('RATE_LIMITED', 'Etsy rate limit reached', {
      ...details,
      retryAfterMs: 60_000,
    });
  }
  return new AdapterError('INVALID', `Etsy returned ${status}`, details);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export class EtsyAdapter implements PlatformAdapter {
  readonly platform = 'ETSY' as const;
  // No account analytics: orders carry their own history (all of it, from the first sync).
  readonly capabilities = {
    historyDays: 1,
    accountDimensions: [],
    hasBoards: false,
    accessLevels: ['read', 'write'] as AccessLevel[],
  };

  constructor(
    private readonly app: { keystring: string; sharedSecret: string },
    /** Pause between pages: the personal tier allows 5 requests a second. */
    private readonly paceMs = 250,
  ) {}

  private get apiKey() {
    return `${this.app.keystring}:${this.app.sharedSecret}`;
  }

  authorizeUrl(state: string, redirectUri: string, options: AuthorizeOptions = {}): string {
    const { pkce } = options;
    if (!pkce) throw new AdapterError('INVALID', 'Etsy requires PKCE');
    const url = new URL(ETSY_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.app.keystring);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', etsyScopes(options.access).join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  private tokens(body: TokenResponse, scopes: string[], now = Date.now()): TokenSet {
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      accessTokenExpiresAt: new Date(now + (body.expires_in ?? 3600) * 1000),
      refreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_DAYS * 86_400_000),
      // Etsy does not echo the granted scopes; the consent screen grants all requested ones.
      scopes,
    };
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    http: HttpClient,
    options: AuthorizeOptions = {},
  ): Promise<TokenSet> {
    const { pkce } = options;
    if (!pkce) throw new AdapterError('INVALID', 'Etsy requires PKCE');
    try {
      const { body } = await http.request<TokenResponse>({
        method: 'POST',
        path: '/v3/public/oauth/token',
        form: {
          grant_type: 'authorization_code',
          client_id: this.app.keystring,
          redirect_uri: redirectUri,
          code,
          code_verifier: pkce.verifier,
        },
        sensitive: true,
      });
      return this.tokens(body, etsyScopes(options.access));
    } catch (error) {
      if (error instanceof HttpStatusError) {
        throw new AdapterError('INVALID', `Etsy token request failed (${error.status})`, {
          status: error.status,
        });
      }
      throw error;
    }
  }

  /** `scopes`: what the connection was granted — a refresh keeps the same access. */
  async refreshToken(
    refreshToken: string,
    http: HttpClient,
    scopes: string[] = ETSY_SCOPES,
  ): Promise<TokenSet> {
    try {
      const { body } = await http.request<TokenResponse>({
        method: 'POST',
        path: '/v3/public/oauth/token',
        form: {
          grant_type: 'refresh_token',
          client_id: this.app.keystring,
          refresh_token: refreshToken,
        },
        sensitive: true,
      });
      return this.tokens(body, scopes);
    } catch (error) {
      // invalid_grant: the refresh token expired (90 days) or access was revoked.
      if (error instanceof HttpStatusError && error.status >= 400 && error.status < 500) {
        throw new AdapterError('REAUTH_REQUIRED', 'Etsy refused the refresh token', {
          status: error.status,
        });
      }
      throw error;
    }
  }

  private async get<T>(
    ctx: AdapterContext,
    path: string,
    query: Record<string, string | number | undefined> = {},
    /** Keep the body out of the raw-response log (it carries buyers' personal data). */
    personal = false,
  ): Promise<T> {
    try {
      const { body } = await ctx.http.request<T>({
        path: v3(path),
        query,
        headers: { 'x-api-key': this.apiKey, Authorization: `Bearer ${ctx.accessToken}` },
        bucket: 'etsy',
        signal: ctx.signal,
        sensitive: personal,
      });
      return body;
    } catch (error) {
      throw etsyError(error);
    }
  }

  private pause() {
    return this.paceMs ? new Promise<void>((r) => setTimeout(r, this.paceMs)) : Promise.resolve();
  }

  /** A write (ADR-0019: only on a member's explicit action). Never recorded raw. */
  private async send<T>(
    ctx: AdapterContext,
    method: 'PATCH' | 'PUT',
    path: string,
    body: { form?: Record<string, string>; json?: unknown },
  ): Promise<T> {
    try {
      const { body: response } = await ctx.http.request<T>({
        method,
        path: v3(path),
        ...body,
        headers: { 'x-api-key': this.apiKey, Authorization: `Bearer ${ctx.accessToken}` },
        bucket: 'etsy',
        signal: ctx.signal,
        sensitive: true,
      });
      return response;
    } catch (error) {
      throw etsyError(error);
    }
  }

  async getProductForEdit(ctx: AdapterContext, listingId: string): Promise<ProductEditable> {
    const raw = await this.get<EtsyListing & { description?: string; has_variations?: boolean }>(
      ctx,
      `/listings/${listingId}`,
    );
    const base = {
      title: unescapeHtml(raw.title ?? ''),
      description: unescapeHtml(raw.description ?? ''),
      tags: (raw.tags ?? []).map(unescapeHtml),
      hasVariations: !!raw.has_variations,
      price: money(raw.price),
      quantity: typeof raw.quantity === 'number' ? raw.quantity : null,
      state: raw.state ?? 'active',
    };
    if (!raw.has_variations) {
      return { ...base, variations: [], priceVaries: false, quantityVaries: false };
    }
    const inventory = await this.get<EtsyInventory>(ctx, `/listings/${listingId}/inventory`);
    return {
      ...base,
      variations: liveProducts(inventory).map(toVariation),
      priceVaries: (inventory.price_on_property ?? []).length > 0,
      quantityVaries: (inventory.quantity_on_property ?? []).length > 0,
    };
  }

  /**
   * Changes a listing: title, description and tags through updateListing; price and quantity
   * through its inventory — only for listings without variations (one product, one offering),
   * everything else in the inventory is sent back as it was.
   */
  async updateProduct(
    ctx: AdapterContext,
    listingId: string,
    changes: ProductChanges,
  ): Promise<ProductEditable> {
    // "On sale" is checked on the whole inventory below, not on a partial list of changes.
    const { variations: varied, ...rest } = changes;
    const check = { ...rest, variations: varied?.map(({ enabled: _enabled, ...v }) => v) };
    if (productChangeErrors(check).length) {
      throw new AdapterError('INVALID', 'The change breaks Etsy listing rules');
    }
    const shopId = await this.shopId(ctx);
    const form: Record<string, string> = {};
    if (changes.title !== undefined) form['title'] = changes.title.trim();
    if (changes.description !== undefined) form['description'] = changes.description;
    if (changes.tags !== undefined) form['tags'] = changes.tags.map((t) => t.trim()).join(',');
    if (Object.keys(form).length) {
      await this.send(ctx, 'PATCH', `/shops/${shopId}/listings/${listingId}`, { form });
    }

    if (
      changes.price !== undefined ||
      changes.quantity !== undefined ||
      changes.variations !== undefined
    ) {
      const inventory = await this.get<EtsyInventory>(ctx, `/listings/${listingId}/inventory`);
      const products = liveProducts(inventory);
      if (!products.length) throw new AdapterError('INVALID', 'The listing has no inventory');
      const byId = new Map((changes.variations ?? []).map((v) => [v.id, v]));
      const single = products.length === 1 && !(products[0]!.property_values ?? []).length;
      if (!single && (changes.price !== undefined || changes.quantity !== undefined)) {
        throw new AdapterError('NOT_AVAILABLE', 'Listings with variations change per variation');
      }
      if (
        products.every(
          (p) => !(byId.get(String(p.product_id))?.enabled ?? liveOffering(p)!.is_enabled ?? true),
        )
      ) {
        throw new AdapterError('INVALID', 'At least one variation must stay on sale');
      }
      // Everything not changed is sent back exactly as it was (Etsy replaces the whole inventory).
      await this.send(ctx, 'PUT', `/listings/${listingId}/inventory`, {
        json: {
          products: products.map((p) => {
            const offering = liveOffering(p)!;
            const change = byId.get(String(p.product_id));
            const currency = offering.price?.currency_code ?? 'USD';
            const minor =
              (single ? changes.price : change?.price) ??
              Math.round(
                ((offering.price?.amount ?? 0) / (offering.price?.divisor ?? 100)) *
                  10 ** minorDigits(currency),
              );
            return {
              sku: p.sku ?? '',
              property_values: (p.property_values ?? []).map((v) => ({
                property_id: v.property_id,
                property_name: v.property_name ?? undefined,
                scale_id: v.scale_id ?? null,
                value_ids: v.value_ids ?? [],
                values: v.values ?? [],
              })),
              offerings: [
                {
                  price: minor / 10 ** minorDigits(currency),
                  quantity:
                    (single ? changes.quantity : change?.quantity) ?? offering.quantity ?? 0,
                  is_enabled: change?.enabled ?? offering.is_enabled ?? true,
                  ...(offering.readiness_state_id
                    ? { readiness_state_id: offering.readiness_state_id }
                    : {}),
                },
              ],
            };
          }),
          price_on_property: inventory.price_on_property ?? [],
          quantity_on_property: inventory.quantity_on_property ?? [],
          sku_on_property: inventory.sku_on_property ?? [],
        },
      });
    }
    return this.getProductForEdit(ctx, listingId);
  }

  /** The shop: the one named in the context, or the token owner's shop (right after consent). */
  private async shopId(ctx: AdapterContext): Promise<string> {
    if (ctx.accountExternalId) return ctx.accountExternalId;
    const me = await this.get<{ user_id?: number; shop_id?: number | null }>(ctx, '/users/me');
    if (!me.shop_id) throw new AdapterError('NOT_AVAILABLE', 'This Etsy account has no shop');
    return String(me.shop_id);
  }

  async getAccount(ctx: AdapterContext): Promise<AccountData> {
    const shop = await this.get<EtsyShop>(ctx, `/shops/${await this.shopId(ctx)}`);
    return mapShop(shop, ctx.today ?? utcToday());
  }

  /** Etsy has no posts: its data belongs to Sales (ADR-0018). */
  // eslint-disable-next-line require-yield
  async *listPosts(): AsyncIterable<PostsPage> {
    return;
  }

  getAccountMetrics(): Promise<MetricPoint[]> {
    return Promise.resolve([]);
  }

  async *listProducts(ctx: AdapterContext): AsyncIterable<ProductData[]> {
    const shopId = await this.shopId(ctx);
    for (const state of LISTING_STATES) {
      for (let offset = 0; ; offset += PAGE) {
        const page = await this.get<{ count?: number; results?: EtsyListing[] }>(
          ctx,
          `/shops/${shopId}/listings`,
          { state, limit: PAGE, offset, includes: 'Images' },
        );
        const results = page.results ?? [];
        if (results.length) yield results.map(mapListing);
        if (results.length < PAGE) break;
        await this.pause();
      }
    }
  }

  /**
   * The payment account's ledger since `since`, newest window first. Etsy allows at most 31 days
   * per request. Kept out of the raw-response log: adjustments name buyers' user ids.
   */
  async *listLedger(ctx: AdapterContext, query: { since: Date }): AsyncIterable<LedgerEntryData[]> {
    const shopId = await this.shopId(ctx);
    const start = Math.floor(query.since.getTime() / 1000);
    for (let end = Math.floor(Date.now() / 1000); end > start; end -= LEDGER_WINDOW_S) {
      const min = Math.max(start, end - LEDGER_WINDOW_S + 1);
      for (let offset = 0; ; offset += PAGE) {
        const page = await this.get<{ results?: EtsyLedgerEntry[] }>(
          ctx,
          `/shops/${shopId}/payment-account/ledger-entries`,
          { min_created: min, max_created: end, limit: PAGE, offset },
          true,
        );
        const results = page.results ?? [];
        if (results.length) yield results.map(mapLedgerEntry);
        if (results.length < PAGE) break;
        await this.pause();
      }
      await this.pause();
    }
  }

  /** Payments of a receipt (never recorded raw: they name the buyer). */
  async getOrderPaymentIds(ctx: AdapterContext, receiptId: string): Promise<string[]> {
    const shopId = await this.shopId(ctx);
    const body = await this.get<{ results?: { payment_id?: number }[] }>(
      ctx,
      `/shops/${shopId}/receipts/${receiptId}/payments`,
      {},
      true,
    );
    return (body.results ?? []).flatMap((p) => (p.payment_id ? [String(p.payment_id)] : []));
  }

  async *listOrders(ctx: AdapterContext, query: { since?: Date }): AsyncIterable<OrderData[]> {
    const shopId = await this.shopId(ctx);
    const minCreated = query.since ? Math.floor(query.since.getTime() / 1000) : undefined;
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.get<{ count?: number; results?: EtsyReceipt[] }>(
        ctx,
        `/shops/${shopId}/receipts`,
        { limit: PAGE, offset, min_created: minCreated },
        // Receipts include buyers' names, emails and addresses: never stored, not even raw.
        true,
      );
      const results = page.results ?? [];
      if (results.length) yield results.map(mapReceipt);
      if (results.length < PAGE) break;
      await this.pause();
    }
  }
}

const liveProducts = (inventory: EtsyInventory) =>
  (inventory.products ?? []).filter((p) => !p.is_deleted && liveOffering(p));

function liveOffering(p: NonNullable<EtsyInventory['products']>[number]) {
  return p.offerings?.find((o) => !o.is_deleted);
}

function toVariation(p: NonNullable<EtsyInventory['products']>[number]): ProductVariation {
  const o = liveOffering(p)!;
  return {
    id: String(p.product_id ?? ''),
    options: (p.property_values ?? []).map((v) => ({
      name: unescapeHtml(v.property_name ?? ''),
      value: unescapeHtml((v.values ?? []).join(', ')),
    })),
    price: money(o.price),
    quantity: typeof o.quantity === 'number' ? o.quantity : null,
    enabled: o.is_enabled ?? true,
  };
}
