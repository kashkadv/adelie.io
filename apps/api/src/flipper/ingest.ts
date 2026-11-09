/**
 * What the Events API accepts (Flipper, ADR-0022): the browser's batch is parsed strictly and
 * every field cut to size, because anyone can post anything to a public address — the site id is
 * a name, not a secret. Pure functions, tested without a server.
 */
import { createHmac } from 'node:crypto';
import { classifyVisit, type Visit } from './classify.js';

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_EVENTS = 25;

const SITE_ID = /^fl_[A-Za-z0-9]{8,32}$/;
const EVENT_ID = /^[0-9a-f]{16,64}$/;
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const VISITOR = /^[0-9a-f]{32}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** An event stamped further than this from the receipt is stamped with the receipt instead. */
const CLOCK_SKEW_MS = 24 * 3600 * 1000;

type Scalar = string | number | boolean | null;
export type Properties = Record<string, Scalar | Record<string, Scalar>[]>;

export interface ParsedEvent {
  eventId: string;
  name: string;
  occurredAt: Date;
  url: string;
  host: string;
  title: string | null;
  properties: Properties | null;
  /** Where an anonymous arrival says it came from (a page view of a landing). */
  attribution: { landing: string; referrer: string } | null;
}

export interface Batch {
  siteId: string;
  consent: boolean;
  visitorId: string | null;
  sessionId: string | null;
  /** The attribution the consenting visitor's session began with. */
  attribution: { landing: string; referrer: string } | null;
  events: ParsedEvent[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const scalar = (v: unknown): Scalar | undefined => {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.slice(0, 200);
  return undefined;
};

function flat(o: unknown): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  if (!isObject(o)) return out;
  for (const [k, v] of Object.entries(o)) {
    if (Object.keys(out).length >= 20) break;
    const s = scalar(v);
    if (s !== undefined && KEY.test(k)) out[k] = s;
  }
  return out;
}

export function cleanProperties(o: unknown): Properties | null {
  if (!isObject(o)) return null;
  const { items, ...rest } = o;
  const out: Properties = { ...flat(rest) };
  if (Array.isArray(items)) {
    out['items'] = items
      .slice(0, 20)
      .map(flat)
      .filter((i) => Object.keys(i).length > 0);
  }
  return Object.keys(out).length ? out : null;
}

/** An address without its fragment and with only the campaign parameters of its query. */
const KEEP = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
  'ttclid',
  'epik',
  'msclkid',
]);
export function cleanAddress(raw: unknown, keepQuery = true): { url: string; host: string } | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const q = new URLSearchParams();
    if (keepQuery) u.searchParams.forEach((v, k) => KEEP.has(k) && q.append(k, v.slice(0, 200)));
    const query = q.toString();
    return {
      url: `${u.origin}${u.pathname}${query ? `?${query}` : ''}`.slice(0, 1000),
      host: u.hostname.replace(/^www\./, '').toLowerCase(),
    };
  } catch {
    return null;
  }
}

const attribution = (a: unknown): { landing: string; referrer: string } | null => {
  if (!isObject(a)) return null;
  const landing = cleanAddress(a['l']);
  if (!landing) return null;
  return { landing: landing.url, referrer: cleanAddress(a['r'], false)?.url ?? '' };
};

/** The batch in the request's body, or null when it is not a well-formed batch. */
export function parseBatch(body: string, now: Date = new Date()): Batch | null {
  if (body.length === 0 || Buffer.byteLength(body) > MAX_BODY_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(raw) || typeof raw['s'] !== 'string' || !SITE_ID.test(raw['s'])) return null;
  if (!Array.isArray(raw['e']) || raw['e'].length === 0 || raw['e'].length > MAX_EVENTS)
    return null;

  const consent = raw['c'] === 1;
  const visitorId =
    consent && typeof raw['v'] === 'string' && VISITOR.test(raw['v']) ? raw['v'] : null;
  const sessionId =
    consent && typeof raw['ss'] === 'string' && VISITOR.test(raw['ss']) ? raw['ss'] : null;
  const events: ParsedEvent[] = [];
  for (const e of raw['e']) {
    if (!isObject(e)) continue;
    const id = e['id'];
    const name = e['n'];
    const where = cleanAddress(e['u']);
    if (typeof id !== 'string' || !EVENT_ID.test(id)) continue;
    if (typeof name !== 'string' || !EVENT_NAME.test(name) || !where) continue;
    const t = typeof e['t'] === 'number' && Number.isFinite(e['t']) ? e['t'] : now.getTime();
    events.push({
      eventId: id,
      name,
      occurredAt: Math.abs(t - now.getTime()) > CLOCK_SKEW_MS ? now : new Date(t),
      url: where.url,
      host: where.host,
      title: typeof e['ti'] === 'string' && e['ti'].trim() ? e['ti'].trim().slice(0, 150) : null,
      properties: cleanProperties(e['p']),
      attribution: consent ? null : attribution(e['a']),
    });
  }
  if (!events.length) return null;
  return {
    siteId: raw['s'],
    consent,
    visitorId,
    sessionId,
    attribution: consent ? attribution(raw['a']) : null,
    events,
  };
}

/** What the visit says about where it came from, for one event of a batch. */
export function visitOf(batch: Batch, event: ParsedEvent): Visit | null {
  const a = batch.consent ? batch.attribution : event.attribution;
  return a
    ? classifyVisit({ landing: a.landing, referrer: a.referrer, ownHost: event.host })
    : null;
}

const BOT =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|curl|wget|python-requests|httpclient|monitor|uptime/i;
export const isBot = (userAgent: string): boolean => !userAgent || BOT.test(userAgent);

export function deviceOf(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/**
 * One visitor, once a day, with nothing kept on their device: a hash of the site, the browser and
 * the address of the request under a salt that is different every day. The address and the browser
 * themselves are never stored, and tomorrow's hash cannot be matched to today's.
 */
export function dailyId(
  secret: string,
  day: string,
  siteId: string,
  ip: string,
  userAgent: string,
): string {
  const salt = createHmac('sha256', secret).update(`flipper-daily:${day}`).digest();
  return createHmac('sha256', salt)
    .update(`${siteId}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}

/** A fixed window per key: at most `limit` in `windowMs`. In memory — one API instance. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (this.windows.size >= this.maxKeys) this.sweep(now);
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }

  private sweep(now: number) {
    for (const [key, w] of this.windows)
      if (now - w.start >= this.windowMs) this.windows.delete(key);
    // Still full of live windows: drop the oldest, so a flood cannot grow the memory without end.
    if (this.windows.size >= this.maxKeys)
      this.windows.delete(this.windows.keys().next().value as string);
  }
}
