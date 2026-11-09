import { describe, expect, it } from 'vitest';
import { analyzePage } from './seo.js';
import { FeedFetchError, fetchPage } from './net.js';

const PAGE = `<!doctype html><html lang="uk"><head>
<title>Килим &quot;ГУК Камінь&quot; великий — Gushka</title>
<meta name="description" content="Ручна робота, вовна карпатських овець.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://gushka.ua/product/00022502/">
<link rel="alternate" hreflang="en" href="https://gushka.world/product/00022502">
<meta property="og:title" content="Килим"><meta property="og:image" content="https://media.gushka.world/i.webp">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Килим","sku":"00022502","offers":{"@type":"Offer","price":"29000.00","priceCurrency":"UAH","availability":"https://schema.org/InStock"}},{"@type":"BreadcrumbList"}]}</script>
<script>var x = "<h1>not a heading</h1>";</script>
</head><body>
<h1>Килим "ГУК Камінь" великий</h1><h2>Опис</h2><h2>Догляд</h2>
<p>Один два три чотири.</p>
<img src="/a.jpg" alt="Килим"><img src="/b.jpg"><img src="/c.jpg" alt="">
<a href="/catalog">Каталог</a> <a href="https://gushka.ua/about">Про нас</a> <a href="https://instagram.com/gushka">IG</a> <a href="#top">top</a> <a href="mailto:a@b.c">mail</a>
</body></html>`;

describe('analyzePage', () => {
  const m = analyzePage(PAGE, 'https://gushka.ua/product/00022502');

  it('title, description, canonical, language, headings', () => {
    expect(m.title).toBe('Килим "ГУК Камінь" великий — Gushka');
    expect(m.titleLength).toBe(m.title!.length);
    expect(m.description).toBe('Ручна робота, вовна карпатських овець.');
    expect(m.canonical).toBe('https://gushka.ua/product/00022502/');
    expect(m.canonicalIsSelf).toBe(true);
    expect(m.lang).toBe('uk');
    expect(m.h1).toEqual(['Килим "ГУК Камінь" великий']);
    expect(m.h2Count).toBe(2);
  });

  it('indexing: meta robots and the X-Robots-Tag header', () => {
    expect(m.noindex).toBe(false);
    expect(
      analyzePage('<meta name="robots" content="noindex,follow">', 'https://a.com/').noindex,
    ).toBe(true);
    expect(
      analyzePage('<html></html>', 'https://a.com/', { 'x-robots-tag': 'noindex' }).noindex,
    ).toBe(true);
  });

  it('structured data: the types and the Product with its offer', () => {
    expect(m.structuredTypes).toEqual(['Product', 'BreadcrumbList']);
    expect(m.product).toEqual({
      name: 'Килим',
      sku: '00022502',
      price: 29000,
      currency: 'UAH',
      availability: 'InStock',
    });
    expect(
      analyzePage('<script type="application/ld+json">{broken</script>', 'https://a.com/').product,
    ).toBeNull();
  });

  it('social tags, hreflang, images without alt, words, links', () => {
    expect(m.og).toEqual({
      title: 'Килим',
      description: null,
      image: 'https://media.gushka.world/i.webp',
    });
    expect(m.twitterCard).toBe('summary_large_image');
    expect(m.hreflang).toEqual([{ lang: 'en', href: 'https://gushka.world/product/00022502' }]);
    expect(m.images).toEqual({ total: 3, withoutAlt: 2 });
    expect(m.links).toEqual({ internal: 2, external: 1 });
    expect(m.words).toBeGreaterThan(5);
    // a heading inside a <script> string is not a heading
    expect(m.h1).toHaveLength(1);
  });

  it('a canonical pointing elsewhere is not the page itself', () => {
    const other = analyzePage(
      '<link rel="canonical" href="https://gushka.world/x">',
      'https://gushka.ua/x',
    );
    expect(other.canonicalIsSelf).toBe(false);
    expect(analyzePage('<html></html>', 'https://gushka.ua/x').canonicalIsSelf).toBeNull();
  });
});

describe('fetchPage', () => {
  const ok = (body: string) => ({ status: 200, body, headers: { 'x-robots-tag': 'all' } });

  it('reads the page with the time and size', async () => {
    let t = 1000;
    const page = await fetchPage(
      'https://gushka.ua/p',
      async () => ok('<html></html>'),
      () => (t += 250),
    );
    expect(page).toMatchObject({
      status: 200,
      finalUrl: 'https://gushka.ua/p',
      bytes: 13,
      loadMs: 250,
    });
    expect(page.headers['x-robots-tag']).toBe('all');
  });

  it('follows redirects within the site only', async () => {
    const get = async (url: URL) =>
      url.pathname === '/old' ? { status: 301, location: '/new', body: '' } : ok('<html></html>');
    const page = await fetchPage('https://gushka.ua/old', get);
    expect(page.finalUrl).toBe('https://gushka.ua/new');
    expect(page.redirects).toEqual(['301 https://gushka.ua/old']);

    let visited = 0;
    const away = async () => {
      visited++;
      return { status: 302, location: 'https://other.example/x', body: '' };
    };
    const left = await fetchPage('https://gushka.ua/p', away);
    expect(left).toMatchObject({ status: 302, finalUrl: 'https://other.example/x', body: '' });
    expect(visited).toBe(1);
  });

  it('a non-2xx status is a result; a private address is an error', async () => {
    const gone = await fetchPage('https://gushka.ua/p', async () => ({
      status: 404,
      body: 'nope',
    }));
    expect(gone.status).toBe(404);
    await expect(fetchPage('https://10.0.0.1/p', async () => ok(''))).rejects.toBeInstanceOf(
      FeedFetchError,
    );
    const toPrivate = async () => ({ status: 302, location: 'https://10.0.0.1/', body: '' });
    await expect(fetchPage('https://gushka.ua/p', toPrivate)).rejects.toMatchObject({
      kind: 'NOT_ALLOWED',
    });
  });
});
