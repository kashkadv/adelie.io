// Fetching a website's product feed (ADR-0021). The address comes from a user, so the request is
// guarded against reaching anything private: only https, no credentials, and every address the
// name resolves to — at connect time, not before — must be public. Redirects are followed by hand
// and checked the same way.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';

export type FeedFetchErrorKind =
  'INVALID_URL' | 'NOT_ALLOWED' | 'UNREACHABLE' | 'TIMEOUT' | 'TOO_LARGE' | 'BAD_STATUS';

export class FeedFetchError extends Error {
  constructor(
    readonly kind: FeedFetchErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

const MAX_BYTES = 25 * 1024 * 1024;
/** The bot Adelie introduces itself as; the site's owner lets it through (its own exceptions). */
export const BOT_USER_AGENT = 'Mozilla/5.0 (compatible; adelie-bot/1.0; +https://adelie.space)';
const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

/** Loopback, private, link-local, carrier-grade NAT (Tailscale), multicast and reserved ranges. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (isIP(ip) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      ip === '::' ||
      ip === '::1' ||
      /^f[cd]/.test(ip) || // fc00::/7 unique local
      /^fe[89ab]/.test(ip) || // fe80::/10 link-local
      /^ff/.test(ip) // multicast
    );
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** The URL to fetch, or an error: https only, no credentials, not a private address literal. */
export function parseFeedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FeedFetchError('INVALID_URL', 'Not a valid address');
  }
  if (url.protocol !== 'https:') throw new FeedFetchError('INVALID_URL', 'Only https is allowed');
  if (url.username || url.password) throw new FeedFetchError('INVALID_URL', 'No credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host))
    throw new FeedFetchError('NOT_ALLOWED', 'Private address');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new FeedFetchError('NOT_ALLOWED', 'Private address');
  }
  return url;
}

export interface FeedResponse {
  status: number;
  location?: string;
  body: string;
  /** Response headers, names in lower case. */
  headers?: Record<string, string>;
}

export interface GetOptions {
  accept?: string;
  maxBytes?: number;
}

/** One GET, with the resolved addresses checked at connect time. */
export function httpsGet(url: URL, options: GetOptions = {}): Promise<FeedResponse> {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        timeout: TIMEOUT_MS,
        headers: {
          'user-agent': BOT_USER_AGENT,
          accept: options.accept ?? 'application/xml,text/xml;q=0.9,*/*;q=0.5',
        },
        // The name is resolved here, and refused when it points anywhere private.
        lookup: (hostname, options, callback) => {
          dnsLookup(hostname, options, (error, address, family) => {
            if (error) return callback(error, address as never, family as never);
            const list = (
              Array.isArray(address) ? address : [{ address, family }]
            ) as LookupAddress[];
            if (list.some((a) => isPrivateAddress(a.address))) {
              return callback(
                new FeedFetchError('NOT_ALLOWED', 'Private address') as NodeJS.ErrnoException,
                address as never,
                family as never,
              );
            }
            return callback(null, address as never, family as never);
          });
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new FeedFetchError('TOO_LARGE', 'The feed is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: typeof res.headers.location === 'string' ? res.headers.location : undefined,
            headers: Object.fromEntries(
              Object.entries(res.headers).flatMap(([k, v]) =>
                typeof v === 'string'
                  ? [[k.toLowerCase(), v]]
                  : Array.isArray(v)
                    ? [[k.toLowerCase(), v.join(', ')]]
                    : [],
              ),
            ),
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', (error) => reject(error));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new FeedFetchError('TIMEOUT', 'The site did not answer in time'));
    });
    req.on('error', (error) =>
      reject(
        error instanceof FeedFetchError
          ? error
          : new FeedFetchError('UNREACHABLE', 'The site cannot be reached'),
      ),
    );
    req.end();
  });
}

/** The feed's text. Redirects are followed (up to 3) and each hop is checked like the first. */
export async function fetchFeedText(
  rawUrl: string,
  get: (url: URL) => Promise<FeedResponse> = httpsGet,
): Promise<string> {
  let url = parseFeedUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await get(url);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = parseFeedUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new FeedFetchError('BAD_STATUS', `The site answered ${res.status}`, res.status);
    }
    return res.body;
  }
  throw new FeedFetchError('BAD_STATUS', 'Too many redirects');
}

export interface PageFetch {
  /** The status of the last response. */
  status: number;
  /** Where the page finally was (after same-site redirects). */
  finalUrl: string;
  /** The hops taken, as `status url`. */
  redirects: string[];
  /** Milliseconds from the request to the end of the last response. */
  loadMs: number;
  bytes: number;
  headers: Record<string, string>;
  body: string;
}

const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const PAGE_MAX_HOPS = 5;
const bare = (host: string) => host.replace(/^www\./, '').toLowerCase();

/**
 * One page of the site, as `adelie-bot` sees it (SEO check): redirects are followed only within the
 * same site (the host without `www`) and each hop is checked like the first; a status that is not
 * 2xx is a result, not an error. Anything on another host is not fetched.
 */
export async function fetchPage(
  rawUrl: string,
  get: (url: URL, options: GetOptions) => Promise<FeedResponse> = httpsGet,
  clock: () => number = Date.now,
): Promise<PageFetch> {
  let url = parseFeedUrl(rawUrl);
  const site = bare(url.hostname);
  const redirects: string[] = [];
  const started = clock();
  for (let hop = 0; hop <= PAGE_MAX_HOPS; hop++) {
    const res = await get(url, { accept: 'text/html,*/*;q=0.8', maxBytes: PAGE_MAX_BYTES });
    if (res.status >= 300 && res.status < 400 && res.location) {
      redirects.push(`${res.status} ${url.toString()}`);
      const next = parseFeedUrl(new URL(res.location, url).toString());
      if (bare(next.hostname) !== site) {
        // Left the site: the redirect itself is the finding; the other host is not visited.
        return {
          status: res.status,
          finalUrl: next.toString(),
          redirects,
          loadMs: clock() - started,
          bytes: 0,
          headers: res.headers ?? {},
          body: '',
        };
      }
      url = next;
      continue;
    }
    return {
      status: res.status,
      finalUrl: url.toString(),
      redirects,
      loadMs: clock() - started,
      bytes: Buffer.byteLength(res.body),
      headers: res.headers ?? {},
      body: res.body,
    };
  }
  throw new FeedFetchError('BAD_STATUS', 'Too many redirects');
}
