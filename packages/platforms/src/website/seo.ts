// What a page says to search engines, read from its HTML (SEO check, ADR-0021). Pure and
// forgiving: pages are messy, so everything is optional and nothing here executes or fetches.

export interface SeoMetrics {
  title: string | null;
  titleLength: number;
  description: string | null;
  descriptionLength: number;
  canonical: string | null;
  /** The canonical points at the page itself; null without one. */
  canonicalIsSelf: boolean | null;
  robots: string | null;
  xRobots: string | null;
  /** Search engines are told not to index the page. */
  noindex: boolean;
  lang: string | null;
  h1: string[];
  h2Count: number;
  og: { title: string | null; description: string | null; image: string | null };
  twitterCard: string | null;
  /** The `@type`s of the page's structured data (JSON-LD). */
  structuredTypes: string[];
  /** The Product of the structured data, when there is one. */
  product: {
    name: string | null;
    sku: string | null;
    price: number | null;
    currency: string | null;
    availability: string | null;
  } | null;
  hreflang: { lang: string; href: string }[];
  images: { total: number; withoutAlt: number };
  words: number;
  links: { internal: number; external: number };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

const text = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** The attributes of one tag, names in lower case. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(
    /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  )) {
    const name = m[1]!.toLowerCase();
    if (!(name in out)) out[name] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) => attributes(m[1]!));
}

const same = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, '') || '/';
    return (
      x.hostname.replace(/^www\./, '') === y.hostname.replace(/^www\./, '') && path(x) === path(y)
    );
  } catch {
    return false;
  }
};

const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** JSON-LD blocks, flattened (`@graph` and arrays unpacked). */
function structuredData(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    out.push(object);
    if (object['@graph']) visit(object['@graph']);
  };
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(m[1]!.trim()));
    } catch {
      // A block that is not valid JSON is simply not structured data.
    }
  }
  return out;
}

const typesOf = (node: Record<string, unknown>) =>
  asList(node['@type'] as string | string[]).map(String);
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

function productOf(nodes: Record<string, unknown>[]): SeoMetrics['product'] {
  const node = nodes.find((n) => typesOf(n).includes('Product'));
  if (!node) return null;
  const offers = asList(node['offers'] as Record<string, unknown> | Record<string, unknown>[]);
  const offer = offers[0];
  const price = offer ? (str(offer['price']) ?? str(offer['lowPrice'])) : null;
  const number = price === null ? null : Number(price.replace(',', '.'));
  return {
    name: str(node['name']),
    sku: str(node['sku']) ?? str(node['mpn']),
    price: number !== null && Number.isFinite(number) ? number : null,
    currency: offer ? str(offer['priceCurrency']) : null,
    availability: offer ? (str(offer['availability'])?.replace(/^.*\//, '') ?? null) : null,
  };
}

/** The page's SEO facts. `pageUrl` is the address the page was read at (for the canonical check). */
export function analyzePage(
  html: string,
  pageUrl: string,
  headers: Record<string, string> = {},
): SeoMetrics {
  const meta = tags(html, 'meta');
  const named = (name: string) =>
    meta.find((m) => (m['name'] ?? '').toLowerCase() === name)?.['content'] ?? null;
  const property = (name: string) =>
    meta.find((m) => (m['property'] ?? '').toLowerCase() === name)?.['content'] ?? null;
  const links = tags(html, 'link');
  const canonical =
    links.find((l) => (l['rel'] ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.[
      'href'
    ] ?? null;

  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleText = title ? text(title[1]!) || null : null;
  const description = named('description')?.trim() || null;
  const robots = [named('robots'), named('googlebot')].filter(Boolean).join(', ') || null;
  const xRobots = headers['x-robots-tag'] ?? null;
  const noindex = /\bnoindex\b/i.test(`${robots ?? ''} ${xRobots ?? ''}`);

  const nodes = structuredData(html);
  const body = html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const imgs = tags(body, 'img');
  let host = '';
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    // an unreadable page address: every link counts as internal below
  }
  const anchors = tags(body, 'a')
    .map((a) => a['href'])
    .filter((h): h is string => !!h && !/^(#|mailto:|tel:|javascript:)/i.test(h));
  const external = anchors.filter((h) => {
    try {
      const u = new URL(h, pageUrl);
      return !!host && u.hostname.replace(/^www\./, '') !== host;
    } catch {
      return false;
    }
  }).length;

  return {
    title: titleText,
    titleLength: titleText?.length ?? 0,
    description,
    descriptionLength: description?.length ?? 0,
    canonical,
    canonicalIsSelf: canonical ? same(canonical, pageUrl) : null,
    robots,
    xRobots,
    noindex,
    lang: /<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i.exec(html)?.[1] ?? null,
    h1: [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => text(m[1]!)).filter(Boolean),
    h2Count: [...body.matchAll(/<h2\b[^>]*>/gi)].length,
    og: {
      title: property('og:title'),
      description: property('og:description'),
      image: property('og:image'),
    },
    twitterCard: named('twitter:card'),
    structuredTypes: [...new Set(nodes.flatMap(typesOf))],
    product: productOf(nodes),
    hreflang: links
      .filter((l) => (l['rel'] ?? '').toLowerCase() === 'alternate' && l['hreflang'] && l['href'])
      .map((l) => ({ lang: l['hreflang']!, href: l['href']! })),
    images: { total: imgs.length, withoutAlt: imgs.filter((i) => !(i['alt'] ?? '').trim()).length },
    words: text(body).split(/\s+/).filter(Boolean).length,
    links: { internal: anchors.length - external, external },
  };
}
