// A click on a short link as the Worker reports it (ADR-0027), checked and reduced to what is
// kept: no address, no full browser string — the device class and whether it was a bot.
import { createHash, timingSafeEqual } from 'node:crypto';
import { deviceOf, isBot } from '../flipper/ingest.js';
import { isLinkCode } from './links.js';

// Link previews of messengers that do not call themselves bots.
const PREVIEW = /whatsapp|skypeuripreview|vkshare|embedly|iframely|outbrain|quora link preview/i;

export interface Click {
  code: string;
  occurredAt: Date;
  referrerHost: string | null;
  country: string | null;
  device: 'mobile' | 'tablet' | 'desktop';
  isBot: boolean;
}

export function parseClick(raw: unknown, now = new Date()): Click | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (!isLinkCode(b['code'])) return null;
  const at = typeof b['at'] === 'number' ? new Date(b['at']) : now;
  // The Worker reports at once; a time far off is the Worker's clock or a forged report.
  const occurredAt = Math.abs(at.getTime() - now.getTime()) > 3_600_000 ? now : at;
  const ua = typeof b['ua'] === 'string' ? b['ua'].slice(0, 500) : '';
  let referrerHost: string | null = null;
  if (typeof b['referrer'] === 'string' && b['referrer']) {
    try {
      referrerHost = new URL(b['referrer']).hostname.replace(/^www\./, '').toLowerCase() || null;
    } catch {
      referrerHost = null;
    }
  }
  const country =
    typeof b['country'] === 'string' && /^[A-Z]{2}$/.test(b['country']) ? b['country'] : null;
  return {
    code: b['code'],
    occurredAt,
    referrerHost,
    country,
    device: deviceOf(ua),
    isBot: isBot(ua) || PREVIEW.test(ua),
  };
}

/** The Worker's secret, compared in constant time. */
export function secretMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = createHash('sha256').update(header.slice(7).trim()).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
