// Link Builder (ADR-0027): the channels a link can be made for, how its labels are normalised and
// how its full address is built. Pure and unit-tested.
import { randomBytes } from 'node:crypto';
import { shortLinkCode } from '@adelie/platforms';

/**
 * Channels: the `utm_source` and `utm_medium` a link for it carries. The mediums are the ones
 * Flipper's channel rules know (classify.ts), so a visit lands in the right channel. `other`: the
 * member names the source.
 */
export const LINK_CHANNELS = {
  pinterest: { source: 'pinterest', medium: 'social' },
  instagram: { source: 'instagram', medium: 'social' },
  tiktok: { source: 'tiktok', medium: 'social' },
  youtube: { source: 'youtube', medium: 'social' },
  facebook: { source: 'facebook', medium: 'social' },
  threads: { source: 'threads', medium: 'social' },
  telegram: { source: 'telegram', medium: 'social' },
  reddit: { source: 'reddit', medium: 'social' },
  x: { source: 'x', medium: 'social' },
  etsy: { source: 'etsy', medium: 'referral' },
  email: { source: 'newsletter', medium: 'email' },
  other: { source: '', medium: 'referral' },
} as const;
export type LinkChannel = keyof typeof LINK_CHANNELS;
export const isLinkChannel = (c: unknown): c is LinkChannel =>
  typeof c === 'string' && Object.hasOwn(LINK_CHANNELS, c);

/** The channel a stored link belongs to (by its source and medium); `other` when none fits. */
export function channelOf(source: string, medium: string): LinkChannel {
  for (const [key, c] of Object.entries(LINK_CHANNELS)) {
    if (key !== 'other' && c.source === source && c.medium === medium) return key as LinkChannel;
  }
  return 'other';
}

/**
 * A label as Flipper reads it back (lower case, trimmed, max 100): spaces become `-`, and only
 * letters (any script), digits and `-_.` are kept — so "Winter Sale" and "winter-sale" are one.
 */
export function normaliseLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_.-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** A short link's code: 7 characters a-z0-9 (lower case: Flipper lower-cases utm_content). */
export const newLinkCode = () =>
  Array.from(randomBytes(7), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
export const isLinkCode = (c: unknown): c is string =>
  typeof c === 'string' && /^[a-z0-9]{7}$/.test(c);

/** A destination: an http(s) address, without its fragment's labels; null when it is not one. */
export function parseDestination(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.') || url.username || url.password) return null;
  return url;
}

export interface LinkLabels {
  source: string;
  medium: string;
  campaign: string | null;
  content: string;
}

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];

/**
 * The full address: the destination with its own parameters kept, any campaign labels it already
 * had replaced by the link's, the fragment last.
 */
export function buildLinkUrl(destination: string, labels: LinkLabels): string {
  const url = new URL(destination);
  for (const k of UTM) url.searchParams.delete(k);
  url.searchParams.set('utm_source', labels.source);
  url.searchParams.set('utm_medium', labels.medium);
  if (labels.campaign) url.searchParams.set('utm_campaign', labels.campaign);
  url.searchParams.set('utm_content', labels.content);
  return url.toString();
}

export type LinkInputError = 'destination' | 'channel' | 'source';

/** What the member asked for, checked; the code fills in an empty place. */
export function parseLinkInput(
  body: Record<string, unknown>,
  code: string,
):
  | { ok: true; name: string | null; destination: string; labels: LinkLabels }
  | { ok: false; error: LinkInputError } {
  const url = parseDestination(body['destination']);
  if (!url) return { ok: false, error: 'destination' };
  if (!isLinkChannel(body['channel'])) return { ok: false, error: 'channel' };
  const channel = LINK_CHANNELS[body['channel']];
  const source = channel.source || normaliseLabel(body['source']);
  if (!source) return { ok: false, error: 'source' };
  const name = typeof body['name'] === 'string' ? body['name'].trim().slice(0, 120) : '';
  return {
    ok: true,
    name: name || null,
    destination: url.toString(),
    labels: {
      source,
      medium: channel.medium,
      campaign: normaliseLabel(body['campaign']) || null,
      content: normaliseLabel(body['content']) || code,
    },
  };
}

/** The host a destination is on, without `www.` — to find the project's site it leads to. */
export const hostOfUrl = (raw: string): string | null => {
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

/**
 * What tracked links a post's links carry: short links by their code, full ones by their labels
 * (`utm_source` + `utm_content`) — to recognise a planned publication once it is published.
 */
export function carriedLinks(urls: string[]) {
  const codes = new Set<string>();
  const labels = new Set<string>();
  for (const url of urls) {
    const code = shortLinkCode(url);
    if (code) codes.add(code);
    try {
      const q = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).searchParams;
      const source = q.get('utm_source')?.toLowerCase();
      const content = q.get('utm_content')?.toLowerCase();
      if (source && content) labels.add(`${source}\u0000${content}`);
    } catch {
      // not an address
    }
  }
  return {
    has: (link: { code: string; source: string; content: string }) =>
      codes.has(link.code) || labels.has(`${link.source}\u0000${link.content}`),
  };
}
