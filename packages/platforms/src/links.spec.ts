import { describe, expect, it } from 'vitest';
import {
  linkKey,
  linksInText,
  postLinks,
  productLinkKey,
  resolveShortLinks,
  shortLinkCode,
} from './links.js';

describe('linkKey', () => {
  it('finds the Etsy listing in listing and shop links', () => {
    expect(linkKey('https://www.etsy.com/ca/listing/913041795/handmade-ceramic')).toBe(
      'etsy:913041795',
    );
    expect(linkKey('etsy.com/listing/42')).toBe('etsy:42');
    expect(
      linkKey(
        'https://www.etsy.com/shop/GushkaWoolRugs?ref=simple-shop-header-name&listing_id=970303955&page=2#items',
      ),
    ).toBe('etsy:970303955');
  });

  it('other pages: host + path, no query, no trailing slash, lowercase', () => {
    expect(linkKey('https://www.Gushka.ua/Rugs/Karpaty/?utm_source=pin')).toBe(
      'url:gushka.ua/rugs/karpaty',
    );
    expect(linkKey('https://www.etsy.com/shop/GushkaWoolRugs?ref=x')).toBe(
      'url:etsy.com/shop/gushkawoolrugs',
    );
    expect(linkKey('not a url')).toBeNull();
    expect(productLinkKey('https://gushka.ua/rugs/1')).toBeNull();
  });
});

describe('links in text', () => {
  it('finds URLs with a scheme and bare domain/path, without trailing punctuation', () => {
    expect(
      linksInText(
        'New rug! Shop: https://www.etsy.com/listing/123/rug. Also gushka.ua/rugs/karpaty, write hi@gushka.ua',
      ),
    ).toEqual(['https://www.etsy.com/listing/123/rug', 'gushka.ua/rugs/karpaty']);
  });

  it('ignores words with dots and bare domains without a path', () => {
    expect(linksInText('Soft.Warm wool. Visit gushka.ua today')).toEqual([]);
  });

  it("a post's own link first, then its text, one entry per target", () => {
    expect(
      postLinks({
        link: 'https://www.etsy.com/listing/1/a',
        description: 'Same: etsy.com/listing/1/a?ref=pin and more: https://gushka.ua/pillows/',
      }),
    ).toEqual([
      { url: 'https://www.etsy.com/listing/1/a', key: 'etsy:1', source: 'link' },
      { url: 'https://gushka.ua/pillows/', key: 'url:gushka.ua/pillows', source: 'text' },
    ]);
  });
});

describe('short links', () => {
  it('a go.adelie.space link leads where its tracked link leads', () => {
    expect(shortLinkCode('https://go.adelie.space/qv0pl6d')).toBe('qv0pl6d');
    expect(shortLinkCode('go.adelie.space/qv0pl6d/')).toBe('qv0pl6d');
    expect(shortLinkCode('https://go.adelie.space/')).toBeNull();
    expect(shortLinkCode('https://gushka.ua/qv0pl6d')).toBeNull();
    const links = postLinks({
      description:
        'Rug: go.adelie.space/qv0pl6d and https://gushka.ua/product/00022502 , go.adelie.space/zzzzzzz',
    });
    expect(
      resolveShortLinks(links, (c) =>
        c === 'qv0pl6d' ? 'https://gushka.ua/product/00022502?utm_source=instagram' : null,
      ),
    ).toEqual([
      { url: 'go.adelie.space/qv0pl6d', key: 'url:gushka.ua/product/00022502', source: 'text' },
      { url: 'go.adelie.space/zzzzzzz', key: 'url:go.adelie.space/zzzzzzz', source: 'text' },
    ]);
  });
});
