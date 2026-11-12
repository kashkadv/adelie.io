// Ideas for the calendar from the AI (ADR-0029): the project's brief, what the request carries, the
// answer's schema and how an answer is checked. Pure and unit-tested; the controller does the I/O.
import { LINK_CHANNELS, isLinkChannel, type LinkChannel } from '../links/links.js';
import { FORMATS, type Format } from './calendar.js';

export interface Brief {
  about: string;
  audience: string;
  /** The audience's language, in words ("English", "українська"). */
  language: string;
  channels: LinkChannel[];
  /** What already exists: materials, pages, accounts. */
  assets: string;
  goal: string;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A brief from the client or the database; `about` is what makes it a brief. */
export function parseBrief(raw: unknown): Brief | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const brief: Brief = {
    about: text(b['about'], 2000),
    audience: text(b['audience'], 1000),
    language: text(b['language'], 60),
    channels: Array.isArray(b['channels']) ? [...new Set(b['channels'].filter(isLinkChannel))] : [],
    assets: text(b['assets'], 2000),
    goal: text(b['goal'], 500),
  };
  return brief.about ? brief : null;
}

export const EVIDENCE = ['hypothesis', 'results'] as const;
export type Evidence = (typeof EVIDENCE)[number];

export interface Idea {
  title: string;
  channel: LinkChannel;
  format: Format;
  minutes: number;
  notes: string;
  why: string;
  evidence: Evidence;
}

/** The answer's JSON schema (strict: every property required, nothing else). */
export const IDEAS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'channel', 'format', 'minutes', 'notes', 'why', 'evidence'],
        properties: {
          title: { type: 'string', description: 'The topic, short, in the audience language.' },
          channel: { type: 'string', enum: Object.keys(LINK_CHANNELS) },
          format: { type: 'string', enum: [...FORMATS] },
          minutes: { type: 'integer', description: 'Realistic preparation time in minutes.' },
          notes: {
            type: 'string',
            description:
              'Hook, a caption draft, hashtags or tags, call to action — in the audience language.',
          },
          why: {
            type: 'string',
            description: 'Why this idea, citing the numbers it relies on, in the owner language.',
          },
          evidence: { type: 'string', enum: [...EVIDENCE] },
        },
      },
    },
  },
} as const;

export interface IdeasContext {
  project: string;
  brief: Brief;
  /** Minutes a day; null = not set. */
  dailyMinutes: number | null;
  /** Platforms connected to the project (their data is in `history` and `topPosts`). */
  connected: string[];
  weekStart: string;
  /** Already planned this week, and ideas already waiting: not to be repeated. */
  planned: {
    date: string | null;
    title: string;
    channel: string;
    format: string;
    minutes: number | null;
  }[];
  /** The last weeks' calendar items with what they brought. */
  history: Record<string, unknown>[];
  /** The project's best posts of the last 90 days, by their platform's numbers. */
  topPosts: Record<string, unknown>[];
  /** The owner's interface language (for `why`). */
  ownerLanguage: string;
}

export const IDEAS_INSTRUCTIONS = `You help a solo creator plan social media and community publications for one project.
Propose publication ideas for the given week as calendar items. Rules:
- Use only the channels listed in the brief (or, if none are listed, the connected platforms); never invent accounts.
- Fit the time budget: the sum of minutes over the week should not exceed 7 × the daily minutes, minus what is already planned. Be realistic about preparation time.
- Do not repeat topics already planned or waiting as ideas; vary formats and channels.
- Base ideas on the project's own results when they exist: what got clicks, visits, goals or engagement. Cite those numbers in "why" and mark evidence "results". When there are no relevant results, say so and mark evidence "hypothesis". Never invent numbers or claim market data you were not given.
- "title" and "notes" are in the audience language from the brief; "why" is in the owner language.
- "notes" is practical: a hook for the first line, a short caption draft, a few tags or hashtags fitting the channel, a call to action pointing to the project's goal.
- Propose between 3 and 8 ideas.`;

/** The request's text: the task and the data, as compact JSON. */
export function ideasInput(ctx: IdeasContext): string {
  return [
    `Week starting ${ctx.weekStart}. Owner language: ${ctx.ownerLanguage}.`,
    'Project data (JSON):',
    JSON.stringify({
      project: ctx.project,
      brief: ctx.brief,
      dailyMinutes: ctx.dailyMinutes,
      connectedPlatforms: ctx.connected,
      alreadyPlannedOrWaiting: ctx.planned,
      recentCalendarResults: ctx.history,
      bestPostsLast90Days: ctx.topPosts,
    }),
  ].join('\n');
}

/** The answer, checked: valid ideas only, at most 8, fields trimmed to what the calendar holds. */
export function parseIdeas(data: unknown): Idea[] {
  const list = (data as { ideas?: unknown } | null)?.ideas;
  if (!Array.isArray(list)) return [];
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
      minutes,
      notes: text(i['notes'], 5000),
      why: text(i['why'], 1000),
      evidence: i['evidence'] === 'results' ? 'results' : 'hypothesis',
    });
    if (ideas.length === 8) break;
  }
  return ideas;
}
