// Content calendar (ADR-0028): what the API returns, and the fixed lists.
import type { LinkChannel, SiteResult } from './links-data';

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
export const STATUSES = ['idea', 'draft', 'ready', 'published', 'measured'] as const;
export type Status = (typeof STATUSES)[number];
export const isPublished = (s: Status) => s === 'published' || s === 'measured';

export interface CalendarItem {
  id: string;
  /** `YYYY-MM-DD`; null = an idea without a day. */
  date: string | null;
  position: number;
  channel: LinkChannel;
  format: Format;
  title: string;
  notes: string | null;
  minutes: number | null;
  status: Status;
  /** An AI idea (ADR-0029): why it was proposed, and on what evidence. */
  why: string | null;
  evidence: 'hypothesis' | 'results' | null;
  /** An AI proposal waiting for a decision (ADR-0030); null = part of the plan. */
  suggestion: 'pending' | 'rejected' | null;
  link: {
    id: string;
    code: string;
    name: string | null;
    channel: LinkChannel;
    campaign: string | null;
    content: string;
    url: string;
    shortUrl: string | null;
  } | null;
  post: {
    id: string;
    title: string | null;
    thumbnailUrl: string | null;
    url: string | null;
    publishedAt: string | null;
    account: { platform: string };
    latest: Partial<
      Record<
        | 'impressions'
        | 'saves'
        | 'outboundClicks'
        | 'views'
        | 'reach'
        | 'likes'
        | 'comments'
        | 'shares'
        | 'videoViews',
        number | null
      >
    > | null;
  } | null;
}

export interface ReviewItem extends CalendarItem {
  result: { clicks: number; site: SiteResult | null } | null;
}

export interface ReviewGroup {
  key: string;
  planned: number;
  published: number;
  clicks: number;
  visits: number;
  goals: number;
}

export interface WeekReview {
  weekStart: string;
  focus: WeekFocus;
  dailyMinutes: number | null;
  plan: { items: number; minutes: number };
  fact: { items: number; minutes: number };
  items: ReviewItem[];
  byChannel: ReviewGroup[];
  byFormat: ReviewGroup[];
  review: { notes: string; updatedAt: string } | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Days are calendar days: computed in UTC so no time zone shifts them. */
export const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const dayOf = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export function addDays(day: string, n: number) {
  const d = asDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}
export const weekStartOf = (day: string) => addDays(day, -((asDate(day).getUTCDay() + 6) % 7));
/** Today in the browser's own calendar. */
export const todayDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export type PostStat = 'impressions' | 'reach' | 'engagement' | 'outboundClicks';

/** The post's headline numbers, whichever its platform reports. */
export function postNumbers(latest: NonNullable<CalendarItem['post']>['latest']) {
  if (!latest) return [];
  const pick = (k: keyof typeof latest) => (typeof latest[k] === 'number' ? latest[k] : null);
  return (
    [
      ['impressions', pick('impressions') ?? pick('views') ?? pick('videoViews')],
      ['reach', pick('reach')],
      ['engagement', sum(pick('likes'), pick('comments'), pick('shares'), pick('saves'))],
      ['outboundClicks', pick('outboundClicks')],
    ] as const
  ).filter(([, v]) => v !== null) as [PostStat, number][];
}
const sum = (...v: (number | null)[]) =>
  v.some((x) => x !== null) ? v.reduce<number>((n, x) => n + (x ?? 0), 0) : null;

/** The week's focus among the brief's directions (ADR-0030). */
export interface WeekFocus {
  directions: { id: string; name: string }[];
  /** A direction id, or "all". */
  value: string;
  /** Not chosen for this week: alternating from the last choice. */
  isDefault: boolean;
}
