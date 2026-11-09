/** SEO check results as the API gives them (packages/platforms website/seo.ts). */
export interface SeoMetrics {
  title: string | null;
  titleLength: number;
  description: string | null;
  descriptionLength: number;
  canonical: string | null;
  canonicalIsSelf: boolean | null;
  robots: string | null;
  xRobots: string | null;
  noindex: boolean;
  lang: string | null;
  h1: string[];
  h2Count: number;
  og: { title: string | null; description: string | null; image: string | null };
  twitterCard: string | null;
  structuredTypes: string[];
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

export interface SeoCheck {
  id: string;
  createdAt: string;
  url: string;
  finalUrl: string | null;
  status: number | null;
  loadMs: number | null;
  bytes: number | null;
  /** The page could not be read at all (a kind of failure). */
  error: string | null;
  metrics: SeoMetrics | null;
}

export type SeoLevel = 'ok' | 'warn' | 'bad' | 'info';

/** One line of a check: what was looked at, how it stands, and the values the text quotes. */
export interface SeoFinding {
  key:
    | 'status'
    | 'speed'
    | 'indexing'
    | 'title'
    | 'description'
    | 'canonical'
    | 'h1'
    | 'structured'
    | 'price'
    | 'social'
    | 'images'
    | 'content';
  level: SeoLevel;
  /** Which message states it (`Sales.seo.values.<state>`) and what it quotes. */
  state: string;
  params: Record<string, string | number>;
  /** The page's own text, shown as it is (title, description…). */
  text?: string;
}

const within = (n: number, min: number, max: number) => n >= min && n <= max;

/**
 * Reads a check against the usual SEO rules of thumb (title 15–60 characters, description 70–160,
 * one H1, one canonical on the page itself, indexable, Product markup whose price matches the
 * feed). `feed`: the price the site's feed gives, in minor units, for the comparison.
 */
export function seoFindings(
  check: SeoCheck,
  feed: { price: number | null; currency: string | null; digits: number },
): SeoFinding[] {
  const out: SeoFinding[] = [];
  const status = check.status ?? 0;
  const moved = !!check.finalUrl && check.finalUrl !== check.url;
  out.push({
    key: 'status',
    level: status >= 200 && status < 300 ? (moved ? 'warn' : 'ok') : 'bad',
    state: moved ? 'statusMoved' : 'status',
    params: { status, url: check.finalUrl ?? '' },
  });
  if (check.loadMs !== null) {
    out.push({
      key: 'speed',
      level: check.loadMs < 1500 ? 'ok' : check.loadMs < 3000 ? 'warn' : 'bad',
      state: 'speed',
      params: { ms: check.loadMs },
    });
  }
  const m = check.metrics;
  if (!m) return out;

  out.push({
    key: 'indexing',
    level: m.noindex ? 'bad' : 'ok',
    state: m.noindex ? 'indexingNo' : 'indexingOk',
    params: {},
  });
  out.push(
    m.title
      ? {
          key: 'title',
          level: within(m.titleLength, 15, 60) ? 'ok' : 'warn',
          state: 'length',
          params: { length: m.titleLength },
          text: m.title,
        }
      : { key: 'title', level: 'bad', state: 'missing', params: {} },
  );
  out.push(
    m.description
      ? {
          key: 'description',
          level: within(m.descriptionLength, 70, 160) ? 'ok' : 'warn',
          state: 'length',
          params: { length: m.descriptionLength },
          text: m.description,
        }
      : { key: 'description', level: 'bad', state: 'missing', params: {} },
  );
  out.push(
    m.canonical
      ? {
          key: 'canonical',
          level: m.canonicalIsSelf ? 'ok' : 'warn',
          state: m.canonicalIsSelf ? 'canonicalSelf' : 'canonicalOther',
          params: { url: m.canonical },
        }
      : { key: 'canonical', level: 'warn', state: 'missing', params: {} },
  );
  out.push({
    key: 'h1',
    level: m.h1.length === 1 ? 'ok' : m.h1.length === 0 ? 'bad' : 'warn',
    state: m.h1.length === 0 ? 'missing' : 'h1',
    params: { count: m.h1.length },
    ...(m.h1[0] ? { text: m.h1[0] } : {}),
  });
  out.push(
    m.product
      ? {
          key: 'structured',
          level: 'ok',
          state: 'structuredProduct',
          params: { types: m.structuredTypes.join(', ') },
        }
      : {
          key: 'structured',
          level: 'warn',
          state: 'structuredNone',
          params: { types: m.structuredTypes.join(', ') },
        },
  );
  if (m.product) {
    const price = m.product.price;
    const markup = price === null ? null : Math.round(price * 10 ** feed.digits);
    out.push(
      price === null
        ? { key: 'price', level: 'warn', state: 'priceNone', params: {} }
        : feed.price !== null &&
            markup === feed.price &&
            (!m.product.currency || m.product.currency === feed.currency)
          ? {
              key: 'price',
              level: 'ok',
              state: 'priceSame',
              params: { price, currency: m.product.currency ?? '' },
            }
          : {
              key: 'price',
              level: 'warn',
              state: 'priceDiff',
              params: {
                markup: `${price} ${m.product.currency ?? ''}`.trim(),
                feed:
                  feed.price === null
                    ? '—'
                    : `${feed.price / 10 ** feed.digits} ${feed.currency ?? ''}`.trim(),
              },
            },
    );
  }
  const missing = [!m.og.title && 'title', !m.og.image && 'image'].filter(Boolean) as string[];
  out.push({
    key: 'social',
    level: missing.length ? 'warn' : 'ok',
    state: missing.length ? 'socialMissing' : 'socialOk',
    params: { missing: missing.join(', ') },
  });
  out.push({
    key: 'images',
    level: m.images.withoutAlt === 0 ? 'ok' : 'warn',
    state: m.images.withoutAlt === 0 ? 'imagesOk' : 'imagesNoAlt',
    params: { count: m.images.withoutAlt, total: m.images.total },
  });
  out.push({
    key: 'content',
    level: 'info',
    state: 'content',
    params: { words: m.words, internal: m.links.internal, external: m.links.external },
  });
  return out;
}

/** What changed since the previous check: the parts a person would care about. */
export function seoChanges(
  previous: SeoCheck | undefined,
  current: SeoCheck,
): (
  'status' | 'indexing' | 'title' | 'description' | 'canonical' | 'h1' | 'structured' | 'price'
)[] {
  if (!previous) return [];
  const changed: ReturnType<typeof seoChanges> = [];
  if (previous.status !== current.status) changed.push('status');
  const a = previous.metrics;
  const b = current.metrics;
  if (!a || !b) return changed;
  if (a.noindex !== b.noindex) changed.push('indexing');
  if (a.title !== b.title) changed.push('title');
  if (a.description !== b.description) changed.push('description');
  if (a.canonical !== b.canonical) changed.push('canonical');
  if (a.h1.join('|') !== b.h1.join('|')) changed.push('h1');
  if (!!a.product !== !!b.product) changed.push('structured');
  if (a.product?.price !== b.product?.price || a.product?.currency !== b.product?.currency) {
    changed.push('price');
  }
  return changed;
}
