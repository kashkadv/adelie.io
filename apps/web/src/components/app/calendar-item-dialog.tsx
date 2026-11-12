'use client';

import { CalendarPlus, Check, Copy, ExternalLink, Link2, Trash2, Unlink, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { DayField } from '../ui/day-picker';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';
import {
  FORMATS,
  STATUSES,
  postNumbers,
  type CalendarItem,
  type Format,
  type Status,
} from './calendar-data';
import { LinkDialog } from './link-dialog';
import { ChannelIcon } from './link-ui';
import { LINK_CHANNELS, type LinkChannel, type LinkRow } from './links-data';

type Field = 'title' | 'channel' | 'format' | 'minutes' | 'failed';

/**
 * A planned publication (ADR-0028): what, where, when, how long — and, once it exists, its tracked
 * link (made here with the item's channel, or one of the project's links) and the post it became.
 */
export function CalendarItemDialog({
  base,
  linksBase,
  item,
  initialDate,
  canManage,
  onClose,
  onSaved,
}: {
  base: string;
  linksBase: string;
  item?: CalendarItem;
  /** A new item's day (null = an idea). */
  initialDate?: string | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (item: CalendarItem | null) => void;
}) {
  const t = useTranslations('Calendar');
  const tl = useTranslations('Links');
  const format = useFormatter();
  const titleId = useId();
  const [title, setTitle] = useState(item?.title ?? '');
  const [channel, setChannel] = useState<LinkChannel | ''>(item?.channel ?? '');
  const [fmt, setFmt] = useState<Format | ''>(item?.format ?? '');
  const [date, setDate] = useState<string | null>(item ? item.date : (initialDate ?? null));
  const [minutes, setMinutes] = useState(item?.minutes ? String(item.minutes) : '');
  const [status, setStatus] = useState<Status>(item?.status ?? 'idea');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [link, setLink] = useState(item?.link ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Field | null>(null);
  const [making, setMaking] = useState(false);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!item) return;
    api<{ links: LinkRow[] }>(`${linksBase}?days=7`).then(
      (r) => setLinks(r.links),
      () => undefined,
    );
  }, [item, linksBase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && !making && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy, making]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !canManage) return;
    if (!channel) return setError('channel');
    if (!fmt) return setError('format');
    const m = minutes.trim() ? Number(minutes) : null;
    if (m !== null && (!Number.isInteger(m) || m < 0 || m > 1440)) return setError('minutes');
    setBusy(true);
    setError(null);
    const json = { title, channel, format: fmt, date, minutes: m, status, notes };
    try {
      const saved = item
        ? await api<CalendarItem>(`${base}/${item.id}`, { method: 'PATCH', json })
        : await api<CalendarItem>(base, { method: 'POST', json });
      onSaved(saved);
    } catch (err) {
      const errors =
        err instanceof ApiError
          ? (err.body as { errors?: Record<string, string> } | null)?.errors
          : undefined;
      const field = errors ? (Object.keys(errors)[0] as Field) : undefined;
      setError(
        field && ['title', 'channel', 'format', 'minutes'].includes(field) ? field : 'failed',
      );
      setBusy(false);
    }
  }

  async function attach(linkId: string | null) {
    if (!item) return;
    try {
      const saved = await api<CalendarItem>(`${base}/${item.id}`, {
        method: 'PATCH',
        json: { linkId },
      });
      setLink(saved.link);
    } catch {
      setError('failed');
    }
  }

  async function remove() {
    if (!item || busy) return;
    setBusy(true);
    try {
      await api(`${base}/${item.id}`, { method: 'DELETE' });
      onSaved(null);
    } catch {
      setError('failed');
      setBusy(false);
    }
  }

  const label = (text: string, hint?: string) => (
    <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
      {text}
      {hint && <InfoTip text={hint} />}
    </span>
  );
  const errorOf = (field: Field) =>
    error === field && (
      <p role="alert" className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">
        {t(`errors.${field}`)}
      </p>
    );
  const post = item?.post ?? null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={save}
        className="glass glass-strong animate-rise scroll-thin relative max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[28px] p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <CalendarPlus size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h2 id={titleId} className="min-w-0 flex-1 pt-1.5 text-lg font-semibold">
            {item ? t('editTitle') : t('newTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('close')}
            className="icon-btn h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <fieldset disabled={!canManage} className="mt-5 grid gap-4">
          <label className="block">
            {label(t('title'))}
            <input
              autoFocus={!item}
              required
              maxLength={200}
              className="field"
              placeholder={t('titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={error === 'title'}
            />
            {errorOf('title')}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              {label(t('channel'))}
              <Select
                ariaLabel={t('channel')}
                value={channel}
                onChange={(v) => setChannel(v as LinkChannel)}
                placeholder={t('channelPlaceholder')}
                invalid={error === 'channel'}
                options={LINK_CHANNELS.map((c) => ({ value: c, label: tl(`channels.${c}`) }))}
              />
              {errorOf('channel')}
            </div>
            <div>
              {label(t('format'))}
              <Select
                ariaLabel={t('format')}
                value={fmt}
                onChange={(v) => setFmt(v as Format)}
                placeholder={t('formatPlaceholder')}
                invalid={error === 'format'}
                options={FORMATS.map((f) => ({ value: f, label: t(`formats.${f}`) }))}
              />
              {errorOf('format')}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              {label(t('date'), t('dateHint'))}
              <DayField
                ariaLabel={t('date')}
                value={date}
                onChange={setDate}
                emptyLabel={t('noDate')}
                clearLabel={t('toIdeas')}
                previousLabel={t('previousMonth')}
                nextLabel={t('nextMonth')}
              />
            </div>
            <label className="block">
              {label(t('minutes'), t('minutesHint'))}
              <input
                inputMode="numeric"
                className="field tabular"
                placeholder="30"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 4))}
                aria-invalid={error === 'minutes'}
              />
              {errorOf('minutes')}
            </label>
          </div>

          <div>
            {label(t('status'), t('statusHint'))}
            <Select
              ariaLabel={t('status')}
              value={status}
              onChange={(v) => setStatus(v as Status)}
              options={STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))}
            />
          </div>

          <label className="block">
            {label(t('notes'), t('notesHint'))}
            <textarea
              rows={4}
              maxLength={5000}
              className="field scroll-thin min-h-24 resize-y py-2.5"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </fieldset>

        {item && (
          <section className="mt-5">
            {label(t('link'), t('linkHint'))}
            {link ? (
              <div className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2 text-sm">
                <ChannelIcon channel={link.channel} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{link.shortUrl ?? link.url}</span>
                  <span className="block truncate text-xs text-muted">
                    {[link.campaign, link.content].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(link.shortUrl ?? link.url).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    });
                  }}
                  title={link.shortUrl ? tl('copyShortHint') : tl('copyFullHint')}
                  aria-label={link.shortUrl ? tl('copyShortHint') : tl('copyFullHint')}
                  className="icon-btn h-8 w-8 shrink-0"
                >
                  {copied ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void attach(null)}
                    title={t('unlink')}
                    aria-label={t('unlink')}
                    className="icon-btn h-8 w-8 shrink-0"
                  >
                    <Unlink size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : canManage ? (
              <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                <button
                  type="button"
                  onClick={() => setMaking(true)}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl border border-line px-3.5 text-sm hover:bg-hover"
                >
                  <Link2 size={15} aria-hidden="true" />
                  {t('makeLink')}
                </button>
                {links.length > 0 && (
                  <Select
                    ariaLabel={t('chooseLink')}
                    value=""
                    onChange={(id) => void attach(id)}
                    placeholder={t('chooseLink')}
                    searchable
                    searchPlaceholder={t('chooseLink')}
                    options={links.map((l) => ({
                      value: l.id,
                      label: l.name ?? `${l.destination.replace(/^https?:\/\/(www\.)?/, '')}`,
                      hint: [tl(`channels.${l.channel}`), l.content].join(' · '),
                    }))}
                  />
                )}
              </div>
            ) : (
              <p className="px-3.5 text-sm text-muted">—</p>
            )}
          </section>
        )}

        {post && (
          <section className="mt-5">
            {label(t('post'), t('postHint'))}
            <a
              href={post.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-line p-2 pr-3 text-sm hover:bg-hover"
            >
              <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-hover">
                {post.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{post.title?.trim() || t('untitledPost')}</span>
                <span className="block truncate text-xs text-muted">
                  {postNumbers(post.latest)
                    .map(([k, v]) => `${t(`postStats.${k}`)} ${format.number(v)}`)
                    .join(' · ') || '—'}
                </span>
              </span>
              <ExternalLink size={14} className="shrink-0 text-muted" aria-hidden="true" />
            </a>
          </section>
        )}

        {errorOf('failed')}

        <div className="mt-6 flex items-center gap-2">
          {item && canManage && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-muted hover:bg-hover hover:text-rose-600"
            >
              <Trash2 size={15} aria-hidden="true" />
              {t('delete')}
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
          >
            {t('cancel')}
          </button>
          {canManage && (
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="btn-primary w-auto px-5"
            >
              {item ? t('save') : t('create')}
            </button>
          )}
        </div>
      </form>
      {/* Outside the form: a submit inside it would bubble (through the portal) to this form. */}
      {making && item && (
        <LinkDialog
          base={linksBase}
          initialChannel={channel || item.channel}
          onClose={() => setMaking(false)}
          onSaved={(saved) => {
            setMaking(false);
            void navigator.clipboard.writeText(saved.shortUrl ?? saved.url).catch(() => undefined);
            void attach(saved.id);
          }}
        />
      )}
    </div>,
    document.body,
  );
}
