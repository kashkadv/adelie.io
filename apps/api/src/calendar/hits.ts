// Hits of a direction (ADR-0037): the products people look at, start to buy and buy, weighed, and
// what has already been published for each — so the AI is not sent back to the same product again
// and again. Pure and unit-tested; hits-data.ts does the I/O.

/** What a signal is worth: a bought order counts most, a started checkout less, a view least. */
export const HIT_WEIGHTS = { purchase: 10, checkout: 3, view: 1 } as const;
export const DEFAULT_HITS_DAYS = 30;
export const MIN_HITS_DAYS = 7;
export const MAX_HITS_DAYS = 90;
/** A product that got a pin lately, or is planned, rests this long before it is proposed again. */
export const COOLDOWN_DAYS = 14;
/** How many ready hits go to the AI. */
export const MAX_HITS = 8;

export interface Signals {
  purchases: number;
  checkouts: number;
  views: number;
}

export const noSignals = (): Signals => ({ purchases: 0, checkouts: 0, views: 0 });
export const addSignals = (a: Signals, b: Partial<Signals>): Signals => ({
  purchases: a.purchases + (b.purchases ?? 0),
  checkouts: a.checkouts + (b.checkouts ?? 0),
  views: a.views + (b.views ?? 0),
});
export const hitScore = (s: Signals) =>
  s.purchases * HIT_WEIGHTS.purchase +
  s.checkouts * HIT_WEIGHTS.checkout +
  s.views * HIT_WEIGHTS.view;

/** What has been published for a product (on any channel) and what is waiting in the calendar. */
export interface Coverage {
  /** Own posts of the last 90 days that lead to the product. */
  pins90: number;
  /** The day of the latest such post. */
  lastPin: string | null;
  /** Titles of the latest ones: the angles already used. */
  pinTitles: string[];
  /** Titles of the calendar items about the product that are planned or waiting as ideas. */
  inCalendar: string[];
}

export interface HitCandidate {
  /** The product across channels: its first article, else its id. */
  key: string;
  /** The product a calendar item is linked to. */
  productId: string;
  title: string;
  url: string | null;
  signals: Signals;
  coverage: Coverage;
}

export interface Hit extends HitCandidate {
  score: number;
  /** The score less what has been published: each earlier post halves the appeal, about. */
  priority: number;
  status: 'ready' | 'cooling';
  reason: 'recent_pin' | 'in_calendar' | null;
  daysSincePin: number | null;
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Ready hits first, by priority; then those resting, by score. Products with no signal drop out. */
export function rankHits(candidates: HitCandidate[], today: string): Hit[] {
  const hits = candidates.map<Hit>((c) => {
    const score = hitScore(c.signals);
    const daysSincePin = c.coverage.lastPin ? daysBetween(c.coverage.lastPin, today) : null;
    const reason =
      daysSincePin !== null && daysSincePin < COOLDOWN_DAYS
        ? 'recent_pin'
        : c.coverage.inCalendar.length
          ? 'in_calendar'
          : null;
    return {
      ...c,
      score,
      priority: Math.round((score / (1 + c.coverage.pins90)) * 10) / 10,
      status: reason ? 'cooling' : 'ready',
      reason,
      daysSincePin,
    };
  });
  return hits
    .filter((h) => h.score > 0)
    .sort((a, b) =>
      a.status !== b.status
        ? a.status === 'ready'
          ? -1
          : 1
        : a.status === 'ready'
          ? b.priority - a.priority
          : b.score - a.score,
    );
}

export interface HitSettings {
  accountIds: string[];
  days: number;
}

/** A direction's hit sources from the client or the database; null when none are set. */
export function parseHitSettings(raw: unknown): HitSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  const ids = Array.isArray(h['accountIds'])
    ? [
        ...new Set(
          h['accountIds'].filter(
            (x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x),
          ),
        ),
      ].slice(0, 6)
    : [];
  if (!ids.length) return null;
  const days =
    typeof h['days'] === 'number' && Number.isFinite(h['days']) ? h['days'] : DEFAULT_HITS_DAYS;
  return {
    accountIds: ids,
    days: Math.min(MAX_HITS_DAYS, Math.max(MIN_HITS_DAYS, Math.round(days))),
  };
}
