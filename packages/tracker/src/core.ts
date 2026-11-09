// The pure parts of Flipper: what may leave the browser and in what shape. No DOM, no state — so
// they are tested directly. Everything is forgiving: a bad value is dropped, never thrown.

/** Query parameters that say where a visit came from; everything else is cut from addresses. */
export const CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  // Click ids of the platforms: they say a visit came from an ad or a post, never who the person is.
  'gclid',
  'fbclid',
  'ttclid',
  'epik',
  'msclkid',
] as const;

/**
 * An address as it may be sent: no fragment, no credentials, and of the query only the campaign
 * parameters (and `allow`ed ones) — an address can carry emails, tokens or order numbers.
 */
export function cleanUrl(raw: string, allow: readonly string[] = [], keepQuery = true): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const kept = new URLSearchParams();
    if (keepQuery) {
      const wanted = new Set<string>([...CAMPAIGN_PARAMS, ...allow]);
      url.searchParams.forEach((value, key) => {
        if (wanted.has(key)) kept.append(key, value.slice(0, 200));
      });
    }
    const query = kept.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`.slice(0, 1000);
  } catch {
    return '';
  }
}

/** The host of an address ("www." removed), or null. */
export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

export type Scalar = string | number | boolean | null;
export type Properties = Record<string, Scalar | Record<string, Scalar>[]>;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_KEYS = 20;
const MAX_ITEMS = 20;

function scalar(value: unknown): Scalar | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 200);
  return undefined;
}

function flat(object: unknown): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  if (!object || typeof object !== 'object') return out;
  for (const [key, value] of Object.entries(object as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    const v = scalar(value);
    if (v !== undefined && KEY.test(key)) out[key] = v;
  }
  return out;
}

/**
 * The properties of an event as they may be sent: scalar values under lower-case snake_case names,
 * at most 20 of them, strings cut at 200 characters — and `items`, a list of up to 20 such flat
 * objects (the products of a cart or a category). Anything else is dropped.
 */
export function cleanProperties(properties: unknown): Properties {
  const out: Properties = {};
  if (!properties || typeof properties !== 'object') return out;
  const { items, ...rest } = properties as Record<string, unknown>;
  Object.assign(out, flat(rest));
  if (Array.isArray(items)) {
    out['items'] = items
      .slice(0, MAX_ITEMS)
      .map(flat)
      .filter((i) => Object.keys(i).length > 0);
  }
  return out;
}

/** A random id: 16 bytes in hex. `crypto` when there is one, a weaker fallback otherwise. */
export function randomId(random: (n: number) => Uint8Array = defaultRandom): string {
  return Array.from(random(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultRandom(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** `data-flipper-product-id="7"` → `product_id: 7` (numbers stay numbers where they look like one). */
export function propertiesFromAttributes(
  attributes: { name: string; value: string }[],
): Properties {
  const raw: Record<string, unknown> = {};
  for (const { name, value } of attributes) {
    const m = /^data-flipper-(.+)$/.exec(name);
    if (!m || m[1] === 'event') continue;
    const key = m[1]!.replace(/-/g, '_');
    raw[key] = /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  }
  return cleanProperties(raw);
}
