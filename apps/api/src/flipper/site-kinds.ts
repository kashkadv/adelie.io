// What a site measures (ADR-0026): its kind (a template from this registry), its goals and its
// funnel. Settings of a site, evaluated when reading — events are stored as they came, so a changed
// rule re-counts the whole history. Pure, unit-tested; the SQL fragments take parameters only.
import { Prisma } from '@adelie/db';

/** How a goal is recognised among a site's events. */
export type GoalRule =
  /** An event by name: `Purchase`, or the site's own `flipper.track('Download')`. */
  | { type: 'event'; event: string }
  /** A page view whose path matches a pattern with `*` (`/thanks`, `/download/*`). */
  | { type: 'page'; pattern: string }
  /** A click to another site: its host, optionally the start of the path. */
  | { type: 'outbound'; host: string; path?: string };

export interface Goal {
  /** Stable within the site: funnel steps refer to it. */
  id: string;
  /** Absent for preset goals: the UI names them (`goals.presets.<id>`). */
  name?: string;
  rule: GoalRule;
  /** Its worth is the event's `value` (a purchase); otherwise goals are counted. */
  valued?: boolean;
}

export type FunnelStep = { event: string } | { goal: string };

export interface SiteKind {
  goals: Goal[];
  funnel: FunnelStep[];
  /** Cabinet tabs that make sense beyond the common ones. */
  tabs: ('checkout' | 'products')[];
}

/** The registry. A new kind is a new entry here; existing sites keep what they have. */
export const SITE_KINDS = {
  store: {
    goals: [{ id: 'purchase', rule: { type: 'event', event: 'Purchase' }, valued: true }],
    funnel: [
      { event: 'ViewCategory' },
      { event: 'ProductView' },
      { event: 'AddToCart' },
      { event: 'BeginCheckout' },
      { goal: 'purchase' },
    ],
    tabs: ['checkout', 'products'],
  },
  landing: {
    // Its goals depend on where the product lives (Workshop, Nexus, Ko-fi…): the owner adds them.
    goals: [],
    funnel: [{ event: 'PageView' }],
    tabs: [],
  },
} satisfies Record<string, SiteKind>;

export type SiteKindId = keyof typeof SITE_KINDS;
export const isSiteKind = (k: unknown): k is SiteKindId =>
  typeof k === 'string' && Object.hasOwn(SITE_KINDS, k);
/** Unknown or missing kinds read as a shop (what every site was before kinds existed). */
export const kindOf = (k: unknown): SiteKindId => (isSiteKind(k) ? k : 'store');

const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HOST = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const GOAL_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_GOALS = 20;
const MAX_STEPS = 10;

export type SettingsError = 'goals' | 'funnel';

/** A goal from the client, checked and normalised; null when it is not a valid goal. */
export function parseGoal(raw: unknown): Goal | null {
  const g = raw as Partial<Goal> & { rule?: Record<string, unknown> };
  if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !GOAL_ID.test(g.id)) return null;
  const name = typeof g.name === 'string' ? g.name.trim().slice(0, 60) : undefined;
  const r = (g.rule ?? {}) as Record<string, unknown>;
  let rule: GoalRule | null = null;
  if (r['type'] === 'event' && typeof r['event'] === 'string' && EVENT_NAME.test(r['event'])) {
    rule = { type: 'event', event: r['event'] };
  } else if (r['type'] === 'page' && typeof r['pattern'] === 'string') {
    const pattern = r['pattern'].trim();
    if (pattern.startsWith('/') && pattern.length <= 200 && !/\s/.test(pattern)) {
      rule = { type: 'page', pattern };
    }
  } else if (r['type'] === 'outbound' && typeof r['host'] === 'string') {
    const host = r['host']
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
    const path = typeof r['path'] === 'string' ? r['path'].trim() : '';
    if (
      HOST.test(host) &&
      (!path || (path.startsWith('/') && path.length <= 200 && !/\s/.test(path)))
    ) {
      rule = { type: 'outbound', host, ...(path ? { path } : {}) };
    }
  }
  if (!rule) return null;
  return {
    id: g.id,
    ...(name ? { name } : {}),
    rule,
    ...(g.valued === true ? { valued: true } : {}),
  };
}

/** Goals and funnel from the client; an error names what is wrong. */
export function parseSettings(
  goalsRaw: unknown,
  funnelRaw: unknown,
): { ok: true; goals: Goal[]; funnel: FunnelStep[] | null } | { ok: false; error: SettingsError } {
  if (!Array.isArray(goalsRaw) || goalsRaw.length > MAX_GOALS) return { ok: false, error: 'goals' };
  const goals = goalsRaw.map(parseGoal);
  if (goals.some((g) => !g)) return { ok: false, error: 'goals' };
  const ids = new Set(goals.map((g) => g!.id));
  if (ids.size !== goals.length) return { ok: false, error: 'goals' };
  if (funnelRaw === null) return { ok: true, goals: goals as Goal[], funnel: null };
  if (!Array.isArray(funnelRaw) || funnelRaw.length === 0 || funnelRaw.length > MAX_STEPS) {
    return { ok: false, error: 'funnel' };
  }
  const funnel: FunnelStep[] = [];
  for (const s of funnelRaw as Record<string, unknown>[]) {
    if (s && typeof s['event'] === 'string' && EVENT_NAME.test(s['event'])) {
      funnel.push({ event: s['event'] });
    } else if (s && typeof s['goal'] === 'string' && ids.has(s['goal'])) {
      funnel.push({ goal: s['goal'] });
    } else {
      return { ok: false, error: 'funnel' };
    }
  }
  return { ok: true, goals: goals as Goal[], funnel };
}

/** The site's settings as stored, with the kind's defaults where nothing is set. */
export function settingsOf(site: { kind: string | null; goals: unknown; funnel: unknown }) {
  const kind = kindOf(site.kind);
  const stored = Array.isArray(site.goals) ? site.goals.map(parseGoal) : [];
  const goals = stored.filter((g): g is Goal => !!g);
  const parsedFunnel =
    site.funnel === null || site.funnel === undefined ? null : parseSettings(goals, site.funnel);
  const funnel =
    parsedFunnel && parsedFunnel.ok && parsedFunnel.funnel
      ? parsedFunnel.funnel
      : (SITE_KINDS[kind].funnel as FunnelStep[]);
  return { kind, goals, funnel, tabs: SITE_KINDS[kind].tabs as SiteKind['tabs'] };
}

/** `/download/*` → `^/download/.*$` (trailing slash optional); everything else literal. */
export function patternToRegex(pattern: string): string {
  const escaped = pattern
    .replace(/\/+$/, '')
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return `^${escaped || ''}/?$`;
}

// The path of a URL column or property, without host, query or fragment.
const pathOf = (expr: Prisma.Sql) =>
  Prisma.sql`split_part(split_part(regexp_replace(${expr}, '^https?://[^/]+', ''), '?', 1), '#', 1)`;

/** The goal as a SQL condition on `website_event` (parameters only, no text from outside). */
export function goalSql(rule: GoalRule): Prisma.Sql {
  switch (rule.type) {
    case 'event':
      return Prisma.sql`(name = ${rule.event})`;
    case 'page':
      return Prisma.sql`(name = 'PageView' AND ${pathOf(Prisma.raw('url'))} ~ ${patternToRegex(rule.pattern)})`;
    case 'outbound': {
      const host = Prisma.sql`regexp_replace(lower(properties->>'host'), '^www\\.', '')`;
      const onHost = Prisma.sql`(${host} = ${rule.host} OR ${host} LIKE ${'%.' + rule.host})`;
      const path = rule.path
        ? Prisma.sql` AND ${pathOf(Prisma.raw(`properties->>'url'`))} LIKE ${rule.path.replace(/[%_\\]/g, '\\$&') + '%'}`
        : Prisma.empty;
      return Prisma.sql`(name = 'OutboundClick' AND ${onHost}${path})`;
    }
  }
}

/** A funnel step as a SQL condition. */
export function stepSql(step: FunnelStep, goals: Goal[]): Prisma.Sql {
  if ('event' in step) return Prisma.sql`(name = ${step.event})`;
  const goal = goals.find((g) => g.id === step.goal);
  return goal ? goalSql(goal.rule) : Prisma.sql`false`;
}
