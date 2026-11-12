// Links in posts and the products behind them (ADR-0018: promotion → sales). Pure — unit-tested.

/** Where a link of a post was found. */
export type LinkSource = 'link' | 'text';

/**
 * A stable key of what a URL points to: an Etsy listing → `etsy:<id>` (listing pages, with or
 * without a locale prefix, or shop pages that name a listing via `listing_id`); any other page →
 * `url:<host><path>` (lowercase host without www, no query or trailing slash) — so a site's
 * product pages match the product URLs of a site catalogue. Null for junk.
 */
export function linkKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.')) return null;
  if (host === 'etsy.com' || host.endsWith('.etsy.com')) {
    const listing =
      /\/listing\/(\d+)/.exec(parsed.pathname)?.[1] ?? parsed.searchParams.get('listing_id');
    if (listing && /^\d+$/.test(listing)) return `etsy:${listing}`;
  }
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep as is
  }
  path = path.replace(/\/+$/, '').toLowerCase();
  return `url:${host}${path}`;
}

/** Kept for the pin's own link: only a product key, else null. */
export function productLinkKey(url: string | null | undefined): string | null {
  const key = linkKey(url);
  return key?.startsWith('etsy:') ? key : null;
}

// URLs with a scheme, or bare `domain.tld/path` (a path is required: "gushka.ua" alone is not a
// link to anything in particular, and "wool.Soft" must not become one). Emails are skipped.
const URL_IN_TEXT =
  /(?<![@\w])(?:https?:\/\/[^\s<>"'()]+|(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/[^\s<>"'()]*)/gi;

/** URLs mentioned in a text (a pin description, an Instagram caption), trailing punctuation off. */
export function linksInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(URL_IN_TEXT) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?…»”]+$/u, '')))];
}

/** Every link of a post — its own link first, then those in its text — with keys, de-duplicated. */
export function postLinks(post: {
  link?: string | null;
  title?: string | null;
  description?: string | null;
}): { url: string; key: string; source: LinkSource }[] {
  const out = new Map<string, { url: string; key: string; source: LinkSource }>();
  const add = (url: string, source: LinkSource) => {
    const key = linkKey(url);
    if (key && !out.has(key)) out.set(key, { url, key, source });
  };
  if (post.link) add(post.link, 'link');
  for (const url of linksInText([post.title, post.description].filter(Boolean).join('\n'))) {
    add(url, 'text');
  }
  return [...out.values()];
}

/** Keys a shop product is linked by: its platform id (`etsy:<id>`) and its page URL. */
export function productKeys(product: {
  platform: string;
  externalId: string;
  url?: string | null;
}): string[] {
  const keys = [`${product.platform.toLowerCase()}:${product.externalId}`];
  const byUrl = linkKey(product.url);
  if (byUrl && !keys.includes(byUrl)) keys.push(byUrl);
  return keys;
}

/**
 * The code of a short link of Link Builder (ADR-0027) — `go.adelie.space/<code>` — or null. A post
 * that carries one leads where the link leads: the sync stores the destination's key for it.
 */
export function shortLinkCode(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (parsed.hostname.toLowerCase() !== 'go.adelie.space') return null;
    return /^\/([a-z0-9]{7})\/?$/.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * A post's links with short links resolved: `resolve(code)` gives the link's destination, and the
 * post is then linked by the destination's key (the short address stays as the url). Unknown codes
 * keep their own key. De-duplicated by key, the first one wins.
 */
export function resolveShortLinks<T extends { url: string; key: string }>(
  links: T[],
  resolve: (code: string) => string | null | undefined,
): T[] {
  const out = new Map<string, T>();
  for (const l of links) {
    const code = shortLinkCode(l.url);
    const key = (code && linkKey(resolve(code))) || l.key;
    if (!out.has(key)) out.set(key, { ...l, key });
  }
  return [...out.values()];
}
