'use client';

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lightbulb,
  Link2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations, type DateTimeFormatOptions } from 'next-intl';
import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { usePopover } from '../ui/popover';
import { Segmented } from '../ui/segmented';
import { Select } from '../ui/select';
import { CONNECT_ROLES } from './accounts-data';
import {
  addDays,
  asDate,
  isPublished,
  todayDay,
  weekStartOf,
  type CalendarItem,
  type WeekFocus,
} from './calendar-data';
import { CalendarBrief } from './calendar-brief';
import { CalendarItemDialog } from './calendar-item-dialog';
import { CalendarReview } from './calendar-review';
import { ChannelIcon } from './link-ui';
import { PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

type Tab = 'week' | 'review' | 'brief';
type IdeasNotice =
  | { kind: 'created'; count: number; cost: number; spent: number; limit: number }
  | { kind: 'brief' | 'limit' | 'off' | 'failed' | 'past' };
/** Where a dragged row lands: a day (null = ideas) and the row it goes before. */
type Drop = { date: string | null; before: string | null };
interface WeekData {
  dailyMinutes: number | null;
  today: string;
  focus: WeekFocus;
  items: CalendarItem[];
  suggestions: CalendarItem[];
}

/**
 * Content calendar (ADR-0028, ADR-0030): the AI's proposals for the week to accept or turn down,
 * the week as a list of days (time planned against the daily budget, past days folded), ideas
 * without a day, rows moved by dragging; the week's focus among the brief's directions; the review
 * of a week and the brief.
 */
export function Calendar() {
  const t = useTranslations('Calendar');
  const format = useFormatter();
  const locale = useLocale();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const root = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;
  const base = root ? `${root}/calendar` : null;
  const linksBase = root ? `${root}/links` : null;

  const [tab, setTab] = useState<Tab>('week');
  const [week, setWeek] = useState(() => weekStartOf(todayDay()));
  const [data, setData] = useState<WeekData | null>(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<{ item: CalendarItem } | { date: string | null } | null>(
    null,
  );
  const [suggesting, setSuggesting] = useState(false);
  const [notice, setNotice] = useState<IdeasNotice | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Drop | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [showIdeas, setShowIdeas] = useState(true);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    api<WeekData>(`${base}?from=${week}&to=${addDays(week, 6)}`).then(
      (r) => !cancelled && setData(r),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base, week, version]);

  const goWeek = (w: string) => {
    setWeek(w);
    setData(null);
    setShowPast(false);
  };

  /** Proposals for the rest of the shown week from the AI (ADR-0030). */
  async function suggest() {
    if (!base || suggesting) return;
    setSuggesting(true);
    setNotice(null);
    try {
      const r = await api<{ created: number; costUsd: number; spentUsd: number; limitUsd: number }>(
        `${base}/ideas`,
        { method: 'POST', json: { week, locale } },
      );
      setNotice({
        kind: 'created',
        count: r.created,
        cost: r.costUsd,
        spent: r.spentUsd,
        limit: r.limitUsd,
      });
      reload();
    } catch (err) {
      const errors =
        err instanceof ApiError
          ? (err.body as { errors?: Record<string, string> } | null)?.errors
          : undefined;
      const kind =
        errors?.['brief'] === 'missing'
          ? 'brief'
          : errors?.['week'] === 'past'
            ? 'past'
            : errors?.['ai'] === 'limit'
              ? 'limit'
              : errors?.['ai'] === 'off'
                ? 'off'
                : 'failed';
      setNotice({ kind });
      if (kind === 'brief') setTab('brief');
    } finally {
      setSuggesting(false);
    }
  }

  async function decide(item: CalendarItem, json: Record<string, unknown>) {
    if (!base) return;
    setData((d) =>
      d
        ? {
            ...d,
            suggestions:
              'suggestion' in json
                ? d.suggestions.filter((s) => s.id !== item.id)
                : d.suggestions.map((s) => (s.id === item.id ? { ...s, ...json } : s)),
          }
        : d,
    );
    await api(`${base}/${item.id}`, { method: 'PATCH', json }).catch(() => undefined);
    reload();
  }

  async function acceptAll() {
    if (!base) return;
    await api(`${base}/suggestions/accept`, { method: 'POST', json: { week } }).catch(
      () => undefined,
    );
    reload();
  }

  async function setFocus(focus: string) {
    if (!base) return;
    const r = await api<WeekFocus>(`${base}/week`, { method: 'PUT', json: { week, focus } }).catch(
      () => null,
    );
    if (r) setData((d) => (d ? { ...d, focus: r } : d));
  }

  const items = data?.items ?? [];
  const today = data?.today ?? todayDay();
  const budget = data?.dailyMinutes ?? null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const pastDays = days.filter((d) => d < today);
  const comingDays = days.filter((d) => d >= today);
  const inDay = (date: string | null) =>
    items.filter((i) => i.date === date).sort((a, b) => a.position - b.position);
  const dayLabel = (date: string, opts: DateTimeFormatOptions) =>
    format.dateTime(asDate(date), { ...opts, timeZone: 'UTC' });

  /** Moves a row and renumbers its new day; only changed rows are saved. */
  async function move(id: string, drop: Drop) {
    if (!base) return;
    const moved = items.find((i) => i.id === id);
    if (!moved) return;
    const target = inDay(drop.date).filter((i) => i.id !== id);
    const at = drop.before ? target.findIndex((i) => i.id === drop.before) : -1;
    target.splice(at < 0 ? target.length : at, 0, { ...moved, date: drop.date });
    const changes = target
      .map((item, position) => ({ item, position }))
      .filter(({ item, position }) => item.id === id || item.position !== position);
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items.map((i) => {
              const c = changes.find((x) => x.item.id === i.id);
              return c ? { ...i, date: drop.date, position: c.position } : i;
            }),
          }
        : d,
    );
    await Promise.all(
      changes.map(({ item, position }) =>
        api(`${base}/${item.id}`, {
          method: 'PATCH',
          json: item.id === id ? { date: drop.date, position } : { position },
        }),
      ),
    ).catch(() => undefined);
    reload();
  }

  const dropZone = (date: string | null, before: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      if (over?.date !== date || over?.before !== before) setOver({ date, before });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = dragging;
      setDragging(null);
      setOver(null);
      if (id) void move(id, { date, before });
    },
  });

  /** One publication as a full-width row. */
  const row = (item: CalendarItem) => (
    <li
      key={item.id}
      draggable={canManage}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
        setDragging(item.id);
      }}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
      {...dropZone(item.date, item.id)}
      className={`transition-opacity ${dragging === item.id ? 'opacity-40' : ''}`}
    >
      {over?.before === item.id && dragging !== item.id && (
        <div className="mb-1 h-0.5 rounded-full bg-accent" />
      )}
      <button
        type="button"
        onClick={() => setDialog({ item })}
        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-hover"
      >
        <ChannelIcon channel={item.channel} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.title}</span>
          <span className="block truncate text-xs text-muted">{t(`formats.${item.format}`)}</span>
        </span>
        {item.why && (
          <Sparkles size={13} className="shrink-0 text-muted" aria-label={t('fromAi')} />
        )}
        {item.link && <Link2 size={13} className="shrink-0 text-muted" aria-label={t('hasLink')} />}
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            isPublished(item.status)
              ? 'bg-accent text-accent-foreground'
              : item.status === 'ready'
                ? 'border border-accent'
                : 'bg-hover text-muted'
          }`}
        >
          {isPublished(item.status) && <Check size={11} aria-hidden="true" />}
          {t(`statuses.${item.status}`)}
        </span>
        <span className="tabular w-12 shrink-0 text-right text-xs text-muted">
          {item.minutes ? t('minutesShort', { n: item.minutes }) : ''}
        </span>
      </button>
    </li>
  );

  /** A day: its label and minutes on the left, its publications on the right. */
  const dayRow = (date: string) => {
    const list = inDay(date);
    const planned = list.reduce((n, i) => n + (i.minutes ?? 0), 0);
    const overBudget = budget !== null && planned > budget;
    const isToday = date === today;
    const past = date < today;
    return (
      <div
        key={date}
        {...dropZone(date, null)}
        className={`grid gap-1 px-2 py-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3 ${
          over && over.date === date && over.before === null ? 'rounded-2xl ring-2 ring-accent' : ''
        } ${past ? 'opacity-60' : ''}`}
      >
        <div className="flex items-baseline justify-between gap-2 px-1 pt-2 sm:block">
          <p className={`text-sm first-letter:uppercase ${isToday ? 'font-semibold' : ''}`}>
            {dayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}
            {isToday && (
              <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground">
                {t('today')}
              </span>
            )}
          </p>
          {(planned > 0 || (budget !== null && !past)) && (
            <p
              className={`tabular text-xs ${overBudget ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted'}`}
              title={overBudget ? t('overBudget') : undefined}
            >
              {budget !== null
                ? t('minutesOf', { n: planned, budget })
                : t('minutesShort', { n: planned })}
            </p>
          )}
        </div>
        <ul className="flex flex-col gap-0.5">
          {list.map(row)}
          {canManage && !past && (
            <li>
              <button
                type="button"
                onClick={() => setDialog({ date })}
                className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs text-muted hover:bg-hover hover:text-foreground"
              >
                <Plus size={13} aria-hidden="true" />
                {t('add')}
              </button>
            </li>
          )}
        </ul>
      </div>
    );
  };

  const focus = data?.focus;
  const weekLabel = `${dayLabel(week, { day: 'numeric', month: 'short' })} – ${dayLabel(
    addDays(week, 6),
    { day: 'numeric', month: 'short', year: 'numeric' },
  )}`;
  const pastCount = pastDays.reduce((n, d) => n + inDay(d).length, 0);
  const ideas = inDay(null);
  const suggestions = data?.suggestions ?? [];

  let body: ReactNode;
  if (tab === 'brief' && base) {
    body = (
      <CalendarBrief
        base={base}
        canManage={canManage}
        onSaved={() => {
          setNotice(null);
          reload();
        }}
      />
    );
  } else if (tab === 'review' && base) {
    body = (
      <CalendarReview
        key={week}
        base={base}
        week={week}
        canManage={canManage}
        onOpen={(item) => setDialog({ item })}
        version={version}
      />
    );
  } else if (!data) {
    body = <p className="py-10 text-center text-sm text-muted">…</p>;
  } else {
    body = (
      <div className="animate-rise grid gap-4">
        {suggestions.length > 0 && (
          <section className="card rounded-[24px] p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles size={15} aria-hidden="true" />
                {t('suggestionsTitle', { count: suggestions.length })}
                <InfoTip text={t('suggestionsHint')} />
              </h3>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void acceptAll()}
                  className="btn-primary flex w-auto items-center gap-1.5 px-4 py-1.5 text-sm"
                >
                  <Check size={14} aria-hidden="true" />
                  {t('acceptAll')}
                </button>
              )}
            </div>
            <ul className="divide-y divide-line">
              {suggestions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-1 py-3">
                  <span className="pt-0.5">
                    <ChannelIcon channel={s.channel} />
                  </span>
                  <button
                    type="button"
                    onClick={() => setDialog({ item: s })}
                    className="min-w-0 flex-1 basis-64 text-left"
                  >
                    <span className="block text-sm font-medium hover:underline">{s.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {t(`formats.${s.format}`)}
                      {s.minutes ? ` · ${t('minutesShort', { n: s.minutes })}` : ''} ·{' '}
                      {t(`evidence.${s.evidence ?? 'hypothesis'}`)}
                    </span>
                    {s.why && (
                      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                        {s.why}
                      </span>
                    )}
                  </button>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-40">
                        <Select
                          ariaLabel={t('date')}
                          value={s.date ?? ''}
                          onChange={(d) => void decide(s, { date: d })}
                          options={comingDays.map((d) => ({
                            value: d,
                            label: dayLabel(d, {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                            }),
                          }))}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void decide(s, { suggestion: null })}
                        title={t('accept')}
                        aria-label={t('accept')}
                        className="icon-btn h-9 w-9 border border-line"
                      >
                        <Check size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(s, { suggestion: 'rejected' })}
                        title={t('reject')}
                        aria-label={t('reject')}
                        className="icon-btn h-9 w-9"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card rounded-[24px] p-2">
          {pastDays.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPast(!showPast)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-muted hover:bg-hover"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${showPast ? '' : '-rotate-90'}`}
                aria-hidden="true"
              />
              {t('pastDays', { days: pastDays.length, count: pastCount })}
            </button>
          )}
          <div className="divide-y divide-line">{(showPast ? days : comingDays).map(dayRow)}</div>
        </section>

        <section
          {...dropZone(null, null)}
          className={`rounded-[24px] bg-hover p-2 ${over && over.date === null && over.before === null ? 'ring-2 ring-accent' : ''}`}
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={() => setShowIdeas(!showIdeas)}
              className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${showIdeas ? '' : '-rotate-90'}`}
                aria-hidden="true"
              />
              <Lightbulb size={15} aria-hidden="true" />
              {t('ideasCount', { count: ideas.length })}
            </button>
            <span className="flex items-center gap-1">
              <InfoTip text={t('ideasHint')} />
              {canManage && (
                <button
                  type="button"
                  onClick={() => setDialog({ date: null })}
                  className="flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs text-muted hover:bg-[var(--card)] hover:text-foreground"
                >
                  <Plus size={13} aria-hidden="true" />
                  {t('newIdea')}
                </button>
              )}
            </span>
          </div>
          {showIdeas && ideas.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">{ideas.map(row)}</ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('subtitle')}
        action={
          canManage &&
          tab === 'week' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void suggest()}
                disabled={suggesting}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-line px-4 text-sm hover:bg-hover"
              >
                <Sparkles
                  size={16}
                  className={suggesting ? 'animate-pulse' : ''}
                  aria-hidden="true"
                />
                {suggesting ? t('suggesting') : t('suggest')}
              </button>
              <button
                type="button"
                onClick={() => setDialog({ date: comingDays[0] ?? null })}
                className="btn-primary flex w-auto items-center gap-2 px-4"
              >
                <Plus size={16} aria-hidden="true" />
                {t('new')}
              </button>
            </div>
          )
        }
      />

      <div className="animate-rise mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel={t('view')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'week', label: t('tabWeek') },
            { value: 'review', label: t('tabReview') },
            { value: 'brief', label: t('tabBrief') },
          ]}
        />
        {tab !== 'brief' && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goWeek(addDays(week, -7))}
              className="icon-btn h-9 w-9"
              aria-label={t('previousWeek')}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="tabular min-w-44 text-center text-sm">{weekLabel}</span>
            <button
              type="button"
              onClick={() => goWeek(addDays(week, 7))}
              className="icon-btn h-9 w-9"
              aria-label={t('nextWeek')}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            {week !== weekStartOf(today) && (
              <button
                type="button"
                onClick={() => goWeek(weekStartOf(today))}
                className="rounded-xl px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-foreground"
              >
                {t('thisWeek')}
              </button>
            )}
          </div>
        )}
        {tab !== 'brief' && focus && focus.directions.length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted">{t('focus')}</span>
            <Segmented
              ariaLabel={t('focus')}
              value={focus.value}
              onChange={(v) => canManage && void setFocus(v)}
              options={[
                ...focus.directions.map((d) => ({ value: d.id, label: d.name || t('unnamed') })),
                { value: 'all', label: t('focusAll') },
              ]}
            />
            <InfoTip text={focus.isDefault ? t('focusAuto') : t('focusChosen')} />
          </div>
        )}
        {tab === 'week' && base && (
          <Budget
            value={budget}
            canManage={canManage}
            onSave={async (v) => {
              await api(base, { method: 'PATCH', json: { dailyMinutes: v } });
              setData((d) => (d ? { ...d, dailyMinutes: v } : d));
            }}
          />
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={`animate-rise mb-4 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
            notice.kind === 'created'
              ? 'border-line bg-hover'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          }`}
        >
          <span>
            {notice.kind === 'created'
              ? t('ideasCreated', {
                  count: notice.count,
                  cost: notice.cost.toFixed(3),
                  spent: notice.spent.toFixed(2),
                  limit: notice.limit.toFixed(2),
                })
              : t(`ideasErrors.${notice.kind}`)}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-muted hover:text-foreground"
            aria-label={t('close')}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {body}

      {dialog && base && linksBase && (
        <CalendarItemDialog
          base={base}
          linksBase={linksBase}
          item={'item' in dialog ? dialog.item : undefined}
          initialDate={'date' in dialog ? dialog.date : undefined}
          canManage={canManage}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
    </>
  );
}

/** The project's daily time budget: shown as a chip, changed in a small popover. */
function Budget({
  value,
  canManage,
  onSave,
}: {
  value: number | null;
  canManage: boolean;
  onSave: (v: number | null) => Promise<void>;
}) {
  const t = useTranslations('Calendar');
  const { open, setOpen, ref } = usePopover();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);

  async function save(v: number | null) {
    try {
      await onSave(v);
      setOpen(false);
    } catch {
      setError(true);
    }
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button
        type="button"
        disabled={!canManage}
        onClick={() => {
          setDraft(value ? String(value) : '');
          setError(false);
          setOpen(!open);
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-hover"
      >
        <Clock size={14} aria-hidden="true" />
        {value ? t('budgetValue', { n: value }) : t('budgetNone')}
      </button>
      <InfoTip text={t('budgetHint')} />
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(draft);
            if (!draft.trim()) return void save(null);
            if (!Number.isInteger(n) || n < 1 || n > 1440) return setError(true);
            void save(n);
          }}
          className="glass glass-strong animate-rise absolute top-full left-0 z-50 mt-2 w-64 rounded-2xl p-3"
        >
          <label className="block">
            <span className="mb-1.5 block px-3.5 text-sm text-muted">{t('budgetLabel')}</span>
            <input
              autoFocus
              inputMode="numeric"
              className="field tabular"
              placeholder="90"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
              aria-invalid={error}
            />
            {error && (
              <p role="alert" className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">
                {t('budgetError')}
              </p>
            )}
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-1.5 text-sm text-muted hover:bg-hover"
            >
              {t('cancel')}
            </button>
            <button type="submit" className="btn-primary w-auto px-4 py-1.5">
              {t('save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
