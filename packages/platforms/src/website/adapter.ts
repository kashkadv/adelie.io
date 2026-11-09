// A website with a Google Merchant feed (ADR-0021): a read-only catalogue. There is no consent flow
// and no tokens; the "account" is the feed's address.
import { AdapterError } from '../errors.js';
import type {
  AccountData,
  AdapterContext,
  MetricPoint,
  PlatformAdapter,
  PostsPage,
  ProductData,
  TokenSet,
} from '../types.js';
import { mapFeedItem, parseFeed } from './feed.js';
import { FeedFetchError, fetchFeedText } from './net.js';

const PAGE = 100;

export class WebsiteAdapter implements PlatformAdapter {
  readonly platform = 'WEBSITE' as const;
  readonly capabilities = { historyDays: 0, accountDimensions: [], hasBoards: false };

  constructor(private readonly fetchText: (url: string) => Promise<string> = fetchFeedText) {}

  authorizeUrl(): string {
    throw new AdapterError('NOT_AVAILABLE', 'A website has no consent flow');
  }
  exchangeCode(): Promise<TokenSet> {
    return Promise.reject(new AdapterError('NOT_AVAILABLE', 'A website has no consent flow'));
  }
  refreshToken(): Promise<TokenSet> {
    return Promise.reject(new AdapterError('NOT_AVAILABLE', 'A website has no tokens'));
  }

  /** The feed's products. A site that cannot be read fails the sync (it is not "skipped"). */
  private async load(ctx: AdapterContext): Promise<ProductData[]> {
    const url = ctx.accountExternalId;
    if (!url) throw new AdapterError('INVALID', 'The feed address is missing');
    let xml: string;
    try {
      xml = await this.fetchText(url);
    } catch (error) {
      if (!(error instanceof FeedFetchError)) throw error;
      throw new AdapterError(
        error.kind === 'UNREACHABLE' || error.kind === 'TIMEOUT' || error.kind === 'BAD_STATUS'
          ? 'TRANSIENT'
          : 'INVALID',
        error.message,
        { status: error.status },
      );
    }
    let products: ProductData[];
    try {
      products = parseFeed(xml)
        .map(mapFeedItem)
        .filter((p): p is ProductData => p !== null);
    } catch {
      throw new AdapterError('INVALID', 'The feed is not readable');
    }
    if (!products.length) throw new AdapterError('INVALID', 'The feed has no products');
    return products;
  }

  async getAccount(ctx: AdapterContext): Promise<AccountData> {
    const products = await this.load(ctx);
    const host = new URL(ctx.accountExternalId!).hostname.replace(/^www\./, '');
    return {
      externalId: ctx.accountExternalId!,
      username: host,
      displayName: host,
      accountType: 'WEBSITE',
      followersCount: null,
      followingCount: null,
      postsCount: products.length,
      metrics: [],
    };
  }

  // eslint-disable-next-line require-yield
  async *listPosts(): AsyncIterable<PostsPage> {
    // A website has no posts.
  }

  getAccountMetrics(): Promise<MetricPoint[]> {
    return Promise.resolve([]);
  }

  async *listProducts(ctx: AdapterContext): AsyncIterable<ProductData[]> {
    const products = await this.load(ctx);
    for (let i = 0; i < products.length; i += PAGE) yield products.slice(i, i + PAGE);
  }
}
