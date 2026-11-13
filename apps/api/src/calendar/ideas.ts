// Ideas for the calendar from the AI (ADR-0029, ADR-0030): the project's brief with its
// directions, the week's focus, what the request carries, the answer's schema and how an answer
// is checked. Pure and unit-tested; the controller does the I/O.
import { LINK_CHANNELS, isLinkChannel, type LinkChannel } from '../links/links.js';
import { FORMATS, asDate, type Format } from './calendar.js';

/** One direction of the project: its own goal, audience, language and channels. */
export interface Direction {
  id: string;
  name: string;
  goal: string;
  audience: string;
  /** The audience's language, in words ("English", "українська"). */
  language: string;
  channels: LinkChannel[];
}

export interface Brief {
  about: string;
  /** What already exists: materials, pages, accounts. */
  assets: string;
  directions: Direction[];
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DIRECTION_ID = /^[a-z0-9-]{1,40}$/;
const MAX_DIRECTIONS = 5;

function parseDirection(raw: unknown, fallbackId: string): Direction | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const direction: Direction = {
    id: typeof d['id'] === 'string' && DIRECTION_ID.test(d['id']) ? d['id'] : fallbackId,
    name: text(d['name'], 60),
    goal: text(d['goal'], 500),
    audience: text(d['audience'], 1500),
    language: text(d['language'], 100),
    channels: Array.isArray(d['channels']) ? [...new Set(d['channels'].filter(isLinkChannel))] : [],
  };
  return direction.name || direction.goal || direction.audience || direction.channels.length
    ? direction
    : null;
}

/**
 * A brief from the client or the database; `about` is what makes it a brief. A brief saved before
 * directions existed (goal, audience, language, channels at the top) reads as one direction.
 */
export function parseBrief(raw: unknown): Brief | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const about = text(b['about'], 2000);
  if (!about) return null;
  const list = Array.isArray(b['directions']) ? b['directions'] : [b];
  const directions: Direction[] = [];
  for (const [i, d] of list.slice(0, MAX_DIRECTIONS).entries()) {
    const parsed = parseDirection(d, `d${i + 1}`);
    if (parsed && !directions.some((x) => x.id === parsed.id)) directions.push(parsed);
  }
  return { about, assets: text(b['assets'], 2000), directions };
}

/** The ISO week number of a Monday (for alternating before anything was chosen). */
function isoWeek(day: string): number {
  const d = asDate(day);
  d.setUTCDate(d.getUTCDate() + 3); // the Thursday decides the year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.floor((d.getTime() - yearStart.getTime()) / 86_400_000 / 7) + 1;
}

const weeksBetween = (from: string, to: string) =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / (7 * 86_400_000));

/**
 * The week's focus: the one chosen for it; else the direction after the last chosen one, as many
 * weeks on as have passed ("all" stays "all"); else by the week's number. One direction: it.
 */
export function resolveFocus(
  directions: { id: string }[],
  chosen: { weekStart: string; focus: string }[],
  weekStart: string,
): { value: string; isDefault: boolean } {
  const valid = (f: string) => f === 'all' || directions.some((d) => d.id === f);
  if (directions.length === 0) return { value: 'all', isDefault: true };
  const own = chosen.find((c) => c.weekStart === weekStart && valid(c.focus));
  if (own) return { value: own.focus, isDefault: false };
  if (directions.length === 1) return { value: directions[0]!.id, isDefault: true };
  const before = chosen
    .filter((c) => c.weekStart < weekStart && valid(c.focus))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0];
  if (before?.focus === 'all') return { value: 'all', isDefault: true };
  const n = directions.length;
  const index = before
    ? directions.findIndex((d) => d.id === before.focus) + weeksBetween(before.weekStart, weekStart)
    : isoWeek(weekStart);
  return { value: directions[((index % n) + n) % n]!.id, isDefault: true };
}

export const EVIDENCE = ['hypothesis', 'results'] as const;
export type Evidence = (typeof EVIDENCE)[number];

export interface Idea {
  title: string;
  channel: LinkChannel;
  format: Format;
  day: string;
  minutes: number;
  notes: string;
  why: string;
  evidence: Evidence;
}

/** The answer's JSON schema (strict: every property required, nothing else); days are the ones left. */
export function ideasSchema(days: string[], channels: LinkChannel[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['ideas'],
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'channel', 'format', 'day', 'minutes', 'notes', 'why', 'evidence'],
          properties: {
            title: { type: 'string', description: 'The topic, short, in the audience language.' },
            channel: {
              type: 'string',
              enum: channels.length ? channels : Object.keys(LINK_CHANNELS),
            },
            format: { type: 'string', enum: [...FORMATS] },
            day: { type: 'string', enum: days, description: 'The day to publish (YYYY-MM-DD).' },
            minutes: { type: 'integer', description: 'Realistic preparation time in minutes.' },
            notes: {
              type: 'string',
              description:
                'Hook, a caption draft, hashtags or tags, call to action — in the audience language.',
            },
            why: {
              type: 'string',
              description:
                'Why this idea and this day, citing the numbers it relies on, in the owner language.',
            },
            evidence: { type: 'string', enum: [...EVIDENCE] },
          },
        },
      },
    },
  };
}

export interface IdeasContext {
  project: string;
  about: string;
  assets: string;
  /** The directions in the week's focus. */
  focus: Direction[];
  /** Minutes a day; null = not set. */
  dailyMinutes: number | null;
  /** Platforms connected to the project (their data is in `history` and `topPosts`). */
  connected: string[];
  /** The days left in the week, with what is already planned on each. */
  days: { date: string; plannedMinutes: number; planned: string[] }[];
  /** Ideas without a day already waiting: not to be repeated. */
  waiting: string[];
  /** Topics the owner turned down lately: not to be proposed again. */
  rejected: string[];
  /** The last weeks' calendar items with what they brought. */
  history: Record<string, unknown>[];
  /** The project's best posts of the last 90 days, by their platform's numbers. */
  topPosts: Record<string, unknown>[];
  /** The owner's interface language (for `why`). */
  ownerLanguage: string;
}

export const IDEAS_INSTRUCTIONS = `You help a solo creator plan social media and community publications for one project.
Propose publications for the remaining days of the week, each on a day. Rules:
- Work only for the directions in focus: their goal, audience, language and channels. Use only their channels; never invent accounts.
- Fit the time budget per day: on each day, already planned minutes plus your ideas should not exceed the daily minutes (when set). Spread ideas over the days; leave a day empty rather than overload it. Be realistic about preparation time.
- Do not repeat topics already planned, waiting as ideas, or rejected by the owner; vary formats.
- Base ideas on the project's own results when they exist: what got clicks, visits, goals or engagement. Cite those numbers in "why" and mark evidence "results". When there are no relevant results, say so and mark evidence "hypothesis". Never invent numbers or claim market data you were not given.
- "title" and "notes" are in the audience language of the idea's direction; "why" is in the owner language.
- "notes" is practical: a hook for the first line, a short caption draft, a few tags or hashtags fitting the channel, a call to action pointing to the direction's goal.
- Propose between 2 and 8 ideas.`;

/** The request's text: the task and the data, as compact JSON. */
export function ideasInput(ctx: IdeasContext): string {
  return [
    `Owner language: ${ctx.ownerLanguage}.`,
    'Project data (JSON):',
    JSON.stringify({
      project: ctx.project,
      about: ctx.about,
      whatExists: ctx.assets,
      directionsInFocus: ctx.focus.map(({ id: _id, ...d }) => d),
      dailyMinutes: ctx.dailyMinutes,
      connectedPlatforms: ctx.connected,
      remainingDays: ctx.days,
      ideasWaiting: ctx.waiting,
      rejectedByOwner: ctx.rejected,
      recentCalendarResults: ctx.history,
      bestPostsLast90Days: ctx.topPosts,
    }),
  ].join('\n');
}

/** The answer, checked: valid ideas only, at most 8, on one of the given days. */
export function parseIdeas(data: unknown, days: string[]): Idea[] {
  const list = (data as { ideas?: unknown } | null)?.ideas;
  if (!Array.isArray(list) || !days.length) return [];
  const ideas: Idea[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const i = raw as Record<string, unknown>;
    const title = text(i['title'], 200);
    if (!title || !isLinkChannel(i['channel']) || !FORMATS.includes(i['format'] as Format))
      continue;
    const minutes =
      typeof i['minutes'] === 'number' && Number.isFinite(i['minutes'])
        ? Math.min(1440, Math.max(5, Math.round(i['minutes'])))
        : 30;
    ideas.push({
      title,
      channel: i['channel'],
      format: i['format'] as Format,
      day: typeof i['day'] === 'string' && days.includes(i['day']) ? i['day'] : days[0]!,
      minutes,
      notes: text(i['notes'], 5000),
      why: text(i['why'], 1000),
      evidence: i['evidence'] === 'results' ? 'results' : 'hypothesis',
    });
    if (ideas.length === 8) break;
  }
  return ideas;
}

/** Today in a time zone, as `YYYY-MM-DD` (the project's day, not the server's). */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
