import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http.js';
import { isAdapterError } from '../errors.js';
import type { ProductData } from '../types.js';
import { EtsyAdapter } from './adapter.js';
import { mapReceipt, money, unescapeHtml } from './mapping.js';

const TODAY = '2026-11-08';
const PKCE = { verifier: 'v'.repeat(43), challenge: 'c'.repeat(43) };

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
    baseUrl: 'https://api.etsy.com',
    fetch: fetchFn as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { client, seen };
}

const adapter = new EtsyAdapter({ keystring: 'KEY', sharedSecret: 'SECRET' }, 0);
const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe('EtsyAdapter OAuth', () => {
  it('asks for read-only shop scopes with PKCE', () => {
    const url = new URL(
      adapter.authorizeUrl('st', 'https://api/social/etsy/callback', { pkce: PKCE }),
    );
    expect(url.origin + url.pathname).toBe('https://www.etsy.com/oauth/connect');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'KEY',
      redirect_uri: 'https://api/social/etsy/callback',
      scope: 'shops_r listings_r transactions_r',
      state: 'st',
      code_challenge: PKCE.challenge,
      code_challenge_method: 'S256',
    });
  });

  it('full access adds editing listings — never deleting them', async () => {
    const url = new URL(adapter.authorizeUrl('st', 'https://cb', { pkce: PKCE, access: 'write' }));
    expect(url.searchParams.get('scope')).toBe('shops_r listings_r transactions_r listings_w');
    const { client } = http({
      '/v3/public/oauth/token': [{ access_token: '1.T', expires_in: 3600 }],
    });
    const tokens = await adapter.exchangeCode('C', 'https://cb', client, {
      pkce: PKCE,
      access: 'write',
    });
    expect(tokens.scopes).toContain('listings_w');
    expect(tokens.scopes).not.toContain('listings_d');
  });

  it('exchanges the code with the verifier', async () => {
    const { client, seen } = http({
      '/v3/public/oauth/token': [
        { access_token: '12.T', refresh_token: '12.R', expires_in: 3600, token_type: 'Bearer' },
      ],
    });
    const tokens = await adapter.exchangeCode('CODE', 'https://cb', client, { pkce: PKCE });
    expect(tokens).toMatchObject({ accessToken: '12.T', refreshToken: '12.R' });
    const body = new URLSearchParams(String(seen[0]!.init.body));
    expect(body.get('code_verifier')).toBe(PKCE.verifier);
    expect(body.get('client_id')).toBe('KEY');
  });

  it('a refused refresh token means reconnecting', async () => {
    const { client } = http({
      '/v3/public/oauth/token': [new Response('{"error":"invalid_grant"}', { status: 400 })],
    });
    await expect(adapter.refreshToken('12.R', client)).rejects.toSatisfy((e) =>
      isAdapterError(e, 'REAUTH_REQUIRED'),
    );
  });
});

describe('EtsyAdapter data', () => {
  const ctx = (client: HttpClient, shop?: string) => ({
    accessToken: '12.T',
    accountExternalId: shop,
    http: client,
    today: TODAY,
  });

  it('finds the token owner’s shop and reads it', async () => {
    const { client, seen } = http({
      '/v3/application/users/me': [{ user_id: 12, shop_id: 345 }],
      '/v3/application/shops/345': [
        {
          shop_id: 345,
          shop_name: 'GushkaWool',
          currency_code: 'EUR',
          transaction_sold_count: 812,
          num_favorers: 3100,
          review_count: 240,
          listing_active_count: 57,
        },
      ],
    });
    const a = await adapter.getAccount(ctx(client));
    expect(a).toMatchObject({
      externalId: '345',
      username: 'GushkaWool',
      accountType: 'SHOP',
      postsCount: 57,
    });
    expect(a.metrics.find((m) => m.providerKey === 'transaction_sold_count')?.value).toBe(812);
    expect(header(seen[0]!.init, 'x-api-key')).toBe('KEY:SECRET');
    expect(header(seen[0]!.init, 'Authorization')).toBe('Bearer 12.T');
  });

  it('lists products of every state, page by page', async () => {
    const page = (n: number, from = 0) => ({
      count: n,
      results: Array.from({ length: n }, (_, i) => ({
        listing_id: from + i,
        title: `Item ${from + i}`,
        state: 'active',
        price: { amount: 4500, divisor: 100, currency_code: 'EUR' },
        images: [{ url_570xN: 'https://img/x.jpg' }],
      })),
    });
    const { client, seen } = http({
      '/v3/application/shops/345/listings': [
        page(100),
        page(3, 100),
        page(0),
        page(1, 500),
        page(0),
        page(0),
      ],
    });
    const products: ProductData[] = [];
    for await (const p of adapter.listProducts(ctx(client, '345'))) products.push(...p);
    expect(products).toHaveLength(104);
    expect(seen.map((s) => s.url.searchParams.get('state'))).toEqual([
      'active',
      'active',
      'inactive',
      'sold_out',
      'draft',
      'expired',
    ]);
    expect(products[0]).toMatchObject({
      externalId: '0',
      price: { amount: 4500, currency: 'EUR' },
      imageUrl: 'https://img/x.jpg',
    });
  });

  it('never records raw receipts — they carry buyers’ personal data', async () => {
    const recorded: unknown[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.etsy.com',
      fetch: (async () =>
        new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch,
      record: (r) => void recorded.push(r.body),
      sleep: async () => undefined,
    });
    for await (const page of adapter.listOrders(ctx(client, '345'), {})) void page;
    expect(recorded.every((b) => b === null || b === undefined)).toBe(true);
  });

  it('reads orders created since the given time', async () => {
    const { client, seen } = http({ '/v3/application/shops/345/receipts': [{ results: [] }] });
    const since = new Date('2026-11-01T00:00:00Z');
    for await (const page of adapter.listOrders(ctx(client, '345'), { since })) void page;
    expect(seen[0]!.url.searchParams.get('min_created')).toBe(String(since.getTime() / 1000));
  });
});

describe('Etsy mapping', () => {
  it('titles come HTML-escaped', () => {
    expect(unescapeHtml('Pillow 20&quot; x 20&quot; &amp; linen &#39;natural&#39;')).toBe(
      'Pillow 20" x 20" & linen \'natural\'',
    );
  });

  it('money in minor units of its currency', () => {
    expect(money({ amount: 4599, divisor: 100, currency_code: 'USD' })).toEqual({
      amount: 4599,
      currency: 'USD',
    });
    expect(money({ amount: 1200, divisor: 1, currency_code: 'JPY' })).toEqual({
      amount: 1200,
      currency: 'JPY',
    });
    expect(money({ amount: 5, divisor: 1, currency_code: 'EUR' })).toEqual({
      amount: 500,
      currency: 'EUR',
    });
    expect(money(undefined)).toBeNull();
  });

  it('an order keeps amounts, items and the country — never the buyer', () => {
    const order = mapReceipt({
      receipt_id: 9,
      create_timestamp: 1_762_560_000,
      status: 'Paid',
      is_paid: true,
      grandtotal: { amount: 5400, divisor: 100, currency_code: 'EUR' },
      total_shipping_cost: { amount: 900, divisor: 100, currency_code: 'EUR' },
      country_iso: 'DE',
      transactions: [
        {
          transaction_id: 77,
          listing_id: 5,
          title: 'Slippers',
          quantity: 1,
          price: { amount: 4500, divisor: 100, currency_code: 'EUR' },
        },
      ],
      // Present in real responses; must not be mapped.
      ...({ name: 'Jane Doe', buyer_email: 'jane@example.com' } as object),
    });
    expect(order).toMatchObject({
      externalId: '9',
      currency: 'EUR',
      total: 5400,
      shipping: 900,
      country: 'DE',
      items: [{ externalId: '77', productExternalId: '5', quantity: 1, price: { amount: 4500 } }],
    });
    expect(JSON.stringify(order)).not.toContain('Jane');
    expect(JSON.stringify(order)).not.toContain('jane@');
  });
});
