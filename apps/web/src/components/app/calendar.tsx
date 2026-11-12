'use client';

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lightbulb,
  Link2,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { usePopover } from '../ui/popover';
import { Segmented } from '../ui/segmented';
import { CONNECT_ROLES } from './accounts-data';
import {
  addDays,
  asDate,
  isPublished,
  todayDay,
  weekStartOf,
  type CalendarItem,
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
  | { kind: 'brief' | 'limit' | 'off' | 'failed' };
/** Where a dragged card lands: a day (null = ideas) and the card it goes before. */
type Drop = { date: string | null; before: string | null };

/**
 * Content calendar (ADR-0028): the week by days with the time planned against the project's daily
 * budget, ideas without a day, cards moved by dragging; and the review of a week.
 */
export function Calendar() {
  const t = useTranslations('Calendar');
  const format = useFormatter();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const root = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;
  const base = root ? `${root}/calendar` : null;
  const linksBase = root ? `${root}/links` : null;

  const [tab, setTab] = useState<Tab>('week');
  const [week, setWeek] = useState(() => weekStartOf(todayDay()));
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<{ item: CalendarItem } | { date: string | null } | null>(
    null,
  );
  const locale = useLocale();
  const [suggesting, setSuggesting] = useState(false);
  const [notice, setNotice] = useState<IdeasNotice | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Drop | null>(null);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** Ideas for the shown week from the AI (ADR-0029): they land in Ideas, the page reloads. */
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
  useEffect(() => {
    if (!base || tab !== 'week') return;
    let cancelled = false;
    api<{ dailyMinutes: number | null; items: CalendarItem[] }>(
      `${base}?from=${week}&to=${addDays(week, 6)}`,
    ).then(
      (r) => {
        if (cancelled) return;
        setItems(r.items);
        setBudget(r.dailyMinutes);
      },
      () => !cancelled && setItems([]),
    );
    return () => {
      cancelled = true;
    };
  }, [base, week, tab, version]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = todayDay();
  const inDay = (date: string | null) =>
    (items ?? []).filter((i) => i.date === date).sort((a, b) => a.position - b.position);

  /** Moves a card and renumbers its new day; only changed cards are saved. */
  async function move(id: string, drop: Drop) {
    if (!base || !items) return;
    const moved = items.find((i) => i.id === id);
    if (!moved) return;
    const target = inDay(drop.date).filter((i) => i.id !== id);
    const at = drop.before ? target.findIndex((i) => i.id === drop.before) : -1;
    target.splice(at < 0 ? target.length : at, 0, { ...moved, date: drop.date });
    const changes = target
      .map((item, position) => ({ item, position }))
      .filter(({ item, position }) => item.id === id || item.position !== position);
    setItems((all) =>
      (all ?? []).map((i) => {
        const c = changes.find((x) => x.item.id === i.id);
        return c ? { ...i, date: drop.date, position: c.position } : i;
      }),
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

  const card = (item: CalendarItem) => (
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
        <div className="mb-1.5 h-0.5 rounded-full bg-accent" />
      )}
      <button
        type="button"
        onClick={() => setDialog({ item })}
        className="block w-full rounded-2xl border border-line bg-[var(--card)] p-2.5 text-left text-sm shadow-[0_6px_18px_-12px_var(--shadow)] transition-colors hover:bg-hover"
      >
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <ChannelIcon channel={item.channel} />
          <span className="truncate">{t(`formats.${item.format}`)}</span>
          {item.link && <Link2 size={12} className="shrink-0" aria-label={t('hasLink')} />}
          {item.why && <Sparkles size={12} className="ml-auto shrink-0" aria-label={t('fromAi')} />}
        </span>
        <span className="mt-1 line-clamp-2 leading-snug">{item.title}</span>
        <span className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
              isPublished(item.status)
                ? 'bg-accent text-accent-foreground'
                : item.status === 'ready'
                  ? 'border border-accent text-foreground'
                  : 'bg-hover'
            }`}
          >
            {isPublished(item.status) && <Check size={11} aria-hidden="true" />}
            {t(`statuses.${item.status}`)}
          </span>
          {item.minutes ? (
            <span className="tabular">{t('minutesShort', { n: item.minutes })}</span>
          ) : null}
        </span>
      </button>
    </li>
  );

  const column = (date: string | null) => {
    const list = inDay(date);
    const planned = list.reduce((n, i) => n + (i.minutes ?? 0), 0);
    const overBudget = date !== null && budget !== null && planned > budget;
    const isToday = date === today;
    return (
      <section
        key={date ?? 'ideas'}
        {...dropZone(date, null)}
        className={`flex min-h-40 flex-col rounded-[22px] p-2.5 transition-colors ${
          date === null ? 'bg-hover' : 'card'
        } ${over && over.date === date && over.before === null ? 'ring-2 ring-accent' : ''}`}
      >
        <header className="mb-2 flex items-start justify-between gap-2 px-1">
          {date === null ? (
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Lightbulb size={15} aria-hidden="true" />
              {t('ideas')}
              <InfoTip text={t('ideasHint')} />
            </h3>
          ) : (
            <h3 className={`text-sm ${isToday ? 'font-semibold' : 'font-medium'}`}>
              <span className="text-muted first-letter:uppercase">
                {format.dateTime(asDate(date), { weekday: 'short', timeZone: 'UTC' })}
              </span>{' '}
              <span
                className={`tabular ${isToday ? 'rounded-full bg-accent px-1.5 text-accent-foreground' : ''}`}
              >
                {format.dateTime(asDate(date), { day: 'numeric', timeZone: 'UTC' })}
              </span>
            </h3>
          )}
          {date !== null && (planned > 0 || budget !== null) && (
            <span
              className={`tabular text-xs ${overBudget ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted'}`}
              title={overBudget ? t('overBudget') : undefined}
            >
              {budget !== null
                ? t('minutesOf', { n: planned, budget })
                : t('minutesShort', { n: planned })}
            </span>
          )}
        </header>
        <ul className="flex flex-1 flex-col gap-1.5">{list.map(card)}</ul>
        {canManage && (
          <button
            type="button"
            onClick={() => setDialog({ date })}
            aria-label={date === null ? t('newIdea') : t('newOn')}
            className="mt-1.5 flex h-8 items-center justify-center gap-1 rounded-xl text-xs text-muted hover:bg-hover hover:text-foreground"
          >
            <Plus size={14} aria-hidden="true" />
            {date === null ? t('newIdea') : t('add')}
          </button>
        )}
      </section>
    );
  };

  const weekLabel = `${format.dateTime(asDate(week), { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${format.dateTime(
    asDate(addDays(week, 6)),
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
  )}`;

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
                onClick={() => setDialog({ date: null })}
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
              onClick={() => {
                setWeek(addDays(week, -7));
                setItems(null);
              }}
              className="icon-btn h-9 w-9"
              aria-label={t('previousWeek')}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="tabular min-w-44 text-center text-sm">{weekLabel}</span>
            <button
              type="button"
              onClick={() => {
                setWeek(addDays(week, 7));
                setItems(null);
              }}
              className="icon-btn h-9 w-9"
              aria-label={t('nextWeek')}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            {week !== weekStartOf(today) && (
              <button
                type="button"
                onClick={() => {
                  setWeek(weekStartOf(today));
                  setItems(null);
                }}
                className="rounded-xl px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-foreground"
              >
                {t('thisWeek')}
              </button>
            )}
          </div>
        )}
        {tab === 'week' && base && (
          <Budget
            value={budget}
            canManage={canManage}
            onSave={async (v) => {
              await api(base, { method: 'PATCH', json: { dailyMinutes: v } });
              setBudget(v);
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
            ✕
          </button>
        </div>
      )}

      {tab === 'brief' && base ? (
        <CalendarBrief base={base} canManage={canManage} onSaved={() => setNotice(null)} />
      ) : tab === 'review' && base ? (
        <CalendarReview
          key={week}
          base={base}
          week={week}
          canManage={canManage}
          onOpen={(item) => setDialog({ item })}
          version={version}
        />
      ) : !items ? (
        <p className="py-10 text-center text-sm text-muted">…</p>
      ) : (
        <div className="animate-rise grid gap-3 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          {days.map(column)}
          {column(null)}
        </div>
      )}

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
