import { describe, expect, it } from 'vitest';
import { isAdapterError } from '../errors.js';
import { WebsiteAdapter } from './adapter.js';
import { mapFeedItem, parseFeed, parsePrice } from './feed.js';
import { FeedFetchError, fetchFeedText, isPrivateAddress, parseFeedUrl } from './net.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Gushka</title>
<item><g:id>00011512</g:id><g:title>Ліжник &amp; &quot;сірий&quot;</g:title><g:description><![CDATA[Soft <b>wool</b>]]></g:description><g:link>https://gushka.ua/product/lizhnyk/00011512</g:link><g:image_link>https://media.gushka.world/images/a</g:image_link><g:availability>in stock</g:availability><g:price>8400.00 UAH</g:price><g:item_group_id>lizhnyk</g:item_group_id></item>
<item><g:id>0001151077</g:id><g:title>Light</g:title><g:availability>out of stock</g:availability><g:price>230.00 USD</g:price></item>
<item><g:title>No id</g:title></item>
</channel></rss>`;

describe('feed parsing', () => {
  it('reads items, entities and CDATA; the first value of a field wins', () => {
    const items = parseFeed(FEED);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: '00011512',
      title: 'Ліжник & "сірий"',
      description: 'Soft <b>wool</b>',
      item_group_id: 'lizhnyk',
    });
  });

  it('prices in minor units of their currency', () => {
    expect(parsePrice('8400.00 UAH')).toEqual({ amount: 840000, currency: 'UAH' });
    expect(parsePrice('230.00 USD')).toEqual({ amount: 23000, currency: 'USD' });
    expect(parsePrice('1,234.50 usd')).toEqual({ amount: 123450, currency: 'USD' });
    expect(parsePrice('12,5 EUR')).toEqual({ amount: 1250, currency: 'EUR' });
    expect(parsePrice('500 JPY')).toEqual({ amount: 500, currency: 'JPY' });
    expect(parsePrice('free')).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });

  it('an item is a product: the id is its SKU/article; no id or title — no product', () => {
    const [a, b, c] = parseFeed(FEED).map(mapFeedItem);
    expect(a).toMatchObject({
      externalId: '00011512',
      skus: ['00011512'],
      state: 'active',
      url: 'https://gushka.ua/product/lizhnyk/00011512',
      price: { amount: 840000, currency: 'UAH' },
    });
    expect(b?.state).toBe('sold_out');
    expect(mapFeedItem({ id: '1', title: 'T', product_type: ' Килими ' })?.category).toBe('Килими');
    expect(mapFeedItem({ id: '1', title: 'T' })?.category).toBeUndefined();
    expect(c).toBeNull();
  });
});

describe('what a feed address may point to', () => {
  it('private, loopback, link-local and Tailscale addresses are refused', () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.1',
      '192.168.1.1',
      '100.102.237.81',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.63.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('only https, no credentials, no private literals', () => {
    expect(parseFeedUrl('https://gushka.ua/merchant-feed.xml').hostname).toBe('gushka.ua');
    for (const bad of [
      'http://gushka.ua/feed.xml',
      'ftp://x.com/f',
      'https://user:pass@gushka.ua/f',
      'https://10.0.0.5/f',
      'https://127.0.0.1/f',
      'https://[::1]/f',
      'https://localhost/f',
      'https://nas.local/f',
      'not a url',
    ]) {
      expect(() => parseFeedUrl(bad), bad).toThrow(FeedFetchError);
    }
  });

  it('follows redirects, checking every hop', async () => {
    const seen: string[] = [];
    const get = async (url: URL) => {
      seen.push(url.toString());
      if (url.hostname === 'gushka.world') {
        return { status: 307, location: 'https://gushka.ua/merchant-feed.xml', body: '' };
      }
      return { status: 200, body: '<rss/>' };
    };
    expect(await fetchFeedText('https://gushka.world/feed.xml', get)).toBe('<rss/>');
    expect(seen).toEqual(['https://gushka.world/feed.xml', 'https://gushka.ua/merchant-feed.xml']);

    const toPrivate = async () => ({ status: 302, location: 'https://10.0.0.1/x', body: '' });
    await expect(fetchFeedText('https://gushka.world/f', toPrivate)).rejects.toMatchObject({
      kind: 'NOT_ALLOWED',
    });
    const downgrade = async () => ({ status: 302, location: 'http://gushka.ua/x', body: '' });
    await expect(fetchFeedText('https://gushka.world/f', downgrade)).rejects.toMatchObject({
      kind: 'INVALID_URL',
    });
    const loop = async () => ({ status: 302, location: 'https://gushka.ua/x', body: '' });
    await expect(fetchFeedText('https://gushka.ua/x', loop)).rejects.toMatchObject({
      kind: 'BAD_STATUS',
    });
    const missing = async () => ({ status: 404, body: '<html/>' });
    await expect(fetchFeedText('https://gushka.ua/f', missing)).rejects.toMatchObject({
      kind: 'BAD_STATUS',
      status: 404,
    });
  });
});

describe('WebsiteAdapter', () => {
  const ctx = (url?: string) => ({ accessToken: '', accountExternalId: url, http: {} as never });
  const adapter = new WebsiteAdapter(async () => FEED);

  it('the account is the site: its host and how many products the feed has', async () => {
    const a = await adapter.getAccount(ctx('https://www.gushka.ua/merchant-feed.xml'));
    expect(a).toMatchObject({
      externalId: 'https://www.gushka.ua/merchant-feed.xml',
      username: 'gushka.ua',
      accountType: 'WEBSITE',
      postsCount: 2,
    });
  });

  it('lists the products of the feed in pages', async () => {
    const products = [];
    for await (const page of adapter.listProducts(ctx('https://gushka.ua/f.xml'))) {
      products.push(...page);
    }
    expect(products.map((p) => p.externalId)).toEqual(['00011512', '0001151077']);
  });

  it('a site that cannot be read fails the sync; it is not skipped', async () => {
    const down = new WebsiteAdapter(async () => {
      throw new FeedFetchError('UNREACHABLE', 'The site cannot be reached');
    });
    await expect(down.getAccount(ctx('https://gushka.ua/f.xml'))).rejects.toSatisfy((e) =>
      isAdapterError(e, 'TRANSIENT'),
    );
    const empty = new WebsiteAdapter(async () => '<rss></rss>');
    await expect(empty.getAccount(ctx('https://gushka.ua/f.xml'))).rejects.toSatisfy((e) =>
      isAdapterError(e, 'INVALID'),
    );
    await expect(adapter.getAccount(ctx())).rejects.toSatisfy((e) => isAdapterError(e, 'INVALID'));
  });
});
