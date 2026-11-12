// Content calendar (ADR-0028): what a planned publication is made of, checked; weeks and days.
// Pure and unit-tested.
import { isLinkChannel, type LinkChannel } from '../links/links.js';
export { carriedLinks } from '../links/links.js';

export const FORMATS = [
  'pin',
  'post',
  'short',
  'video',
  'story',
  'forum',
  'email',
  'other',
] as const;
export type Format = (typeof FORMATS)[number];
/** In the order a publication goes through them. */
export const STATUSES = ['idea', 'draft', 'ready', 'published', 'measured'] as const;
export type Status = (typeof STATUSES)[number];
export const isPublished = (s: string) => s === 'published' || s === 'measured';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day `YYYY-MM-DD` that exists. */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
export const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
export function addDays(day: string, n: number): string {
  const d = asDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}
/** The Monday of the day's week. */
export function weekStartOf(day: string): string {
  const d = asDate(day);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

export interface ItemInput {
  date?: string | null;
  position?: number;
  channel?: LinkChannel;
  format?: Format;
  title?: string;
  notes?: string | null;
  minutes?: number | null;
  status?: Status;
  linkId?: string | null;
}
export type ItemField = keyof ItemInput;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A calendar item's fields from the client. `full`: a new item — channel, format and title are
 * required. Absent fields stay as they are; null clears the optional ones.
 */
export function parseItem(
  body: Record<string, unknown>,
  full: boolean,
): { ok: true; item: ItemInput } | { ok: false; error: ItemField } {
  const item: ItemInput = {};
  const has = (k: string) => body[k] !== undefined;
  if (has('date')) {
    if (body['date'] !== null && !isDay(body['date'])) return { ok: false, error: 'date' };
    item.date = body['date'] as string | null;
  }
  if (has('position')) {
    const p = body['position'];
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > 10_000) {
      return { ok: false, error: 'position' };
    }
    item.position = p;
  }
  if (has('channel') || full) {
    if (!isLinkChannel(body['channel'])) return { ok: false, error: 'channel' };
    item.channel = body['channel'];
  }
  if (has('format') || full) {
    if (!FORMATS.includes(body['format'] as Format)) return { ok: false, error: 'format' };
    item.format = body['format'] as Format;
  }
  if (has('title') || full) {
    const title = typeof body['title'] === 'string' ? body['title'].trim().slice(0, 200) : '';
    if (!title) return { ok: false, error: 'title' };
    item.title = title;
  }
  if (has('notes')) {
    const notes = typeof body['notes'] === 'string' ? body['notes'].slice(0, 5000).trim() : '';
    item.notes = notes || null;
  }
  if (has('minutes')) {
    const m = body['minutes'];
    if (m !== null && (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 1440)) {
      return { ok: false, error: 'minutes' };
    }
    item.minutes = (m as number | null) || null;
  }
  if (has('status')) {
    if (!STATUSES.includes(body['status'] as Status)) return { ok: false, error: 'status' };
    item.status = body['status'] as Status;
  }
  if (has('linkId')) {
    const id = body['linkId'];
    if (id !== null && (typeof id !== 'string' || !UUID.test(id))) {
      return { ok: false, error: 'linkId' };
    }
    item.linkId = id as string | null;
  }
  return { ok: true, item };
}

/** The daily budget from the client: whole minutes 1–1440, or null for none. */
export function parseBudget(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440) return v;
  return undefined;
}
