'use client';

import { Link2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';
import { LINK_CHANNELS, type LinkChannel, type TrackedLink } from './links-data';

type CatalogProduct = { id: string; title: string; url: string; channel: string };

type Field = 'destination' | 'channel' | 'source' | 'content' | 'failed';

/**
 * A new tracked link, or a link's name and destination (ADR-0027). Its labels — channel, campaign,
 * place — are set once: they are in addresses already published.
 */
export function LinkDialog({
  base,
  link,
  initialDestination,
  initialChannel,
  onClose,
  onSaved,
}: {
  base: string;
  /** The link to change; none = a new one. */
  link?: TrackedLink;
  /** A new link's destination to start with (from a product's card). */
  initialDestination?: string;
  /** A new link's channel to start with (from a calendar item). */
  initialChannel?: LinkChannel;
  onClose: () => void;
  onSaved: (link: TrackedLink) => void;
}) {
  const t = useTranslations('Links');
  const titleId = useId();
  const [destination, setDestination] = useState(link?.destination ?? initialDestination ?? '');
  const [name, setName] = useState(link?.name ?? '');
  const [channel, setChannel] = useState<LinkChannel | ''>(initialChannel ?? '');
  const [source, setSource] = useState('');
  const [campaign, setCampaign] = useState('');
  const [content, setContent] = useState('');
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Field | null>(null);

  useEffect(() => {
    api<{ products: CatalogProduct[] }>(`${base}/products`).then(
      (r) => setProducts(r.products),
      () => undefined,
    );
  }, [base]);
  const product = products.find((p) => p.url === destination);

  useEffect(() => {
    if (link) return;
    api<{ campaigns: string[] }>(`${base}/campaigns`).then(
      (r) => setCampaigns(r.campaigns),
      () => undefined,
    );
  }, [base, link]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!link && !channel) return setError('channel');
    setBusy(true);
    setError(null);
    try {
      const saved = link
        ? await api<TrackedLink>(`${base}/${link.id}`, {
            method: 'PATCH',
            json: { name, destination },
          })
        : await api<TrackedLink>(base, {
            method: 'POST',
            json: { destination, name, channel, source, campaign, content },
          });
      onSaved(saved);
    } catch (err) {
      const errors =
        err instanceof ApiError
          ? (err.body as { errors?: Record<string, string> } | null)?.errors
          : undefined;
      const field = errors ? (Object.keys(errors)[0] as Field) : undefined;
      setError(
        field && ['destination', 'channel', 'source', 'content'].includes(field) ? field : 'failed',
      );
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
        onSubmit={submit}
        className="glass glass-strong animate-rise scroll-thin relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[28px] p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Link2 size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {link ? t('editTitle') : t('newTitle')}
            </h2>
            <p className="text-sm text-muted">{link ? t('editLead') : t('newLead')}</p>
          </div>
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

        <div className="mt-5 grid gap-4">
          {products.length > 0 && (
            <div>
              {label(t('product'), t('productHint'))}
              <Select
                ariaLabel={t('product')}
                value={product?.id ?? ''}
                onChange={(id) => {
                  const chosen = products.find((p) => p.id === id);
                  if (chosen) setDestination(chosen.url);
                  if (error === 'destination') setError(null);
                }}
                placeholder={t('productPlaceholder')}
                searchable
                searchPlaceholder={t('productSearch')}
                emptyText={t('productNone')}
                options={products.map((p) => ({ value: p.id, label: p.title, hint: p.channel }))}
              />
            </div>
          )}
          <label className="block">
            {label(t('destination'), t('destinationHint'))}
            <input
              autoFocus={!initialDestination}
              type="url"
              inputMode="url"
              required
              className="field"
              placeholder="https://gushka.ua/shop/…"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              aria-invalid={error === 'destination'}
            />
            {errorOf('destination')}
          </label>

          {!link && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  {label(t('channel'))}
                  <Select
                    ariaLabel={t('channel')}
                    value={channel}
                    onChange={(v) => {
                      setChannel(v as LinkChannel);
                      if (error === 'channel') setError(null);
                    }}
                    placeholder={t('channelPlaceholder')}
                    invalid={error === 'channel'}
                    options={LINK_CHANNELS.map((c) => ({ value: c, label: t(`channels.${c}`) }))}
                  />
                  {errorOf('channel')}
                </div>
                {channel === 'other' && (
                  <label className="block">
                    {label(t('source'), t('sourceHint'))}
                    <input
                      required
                      className="field"
                      maxLength={100}
                      placeholder="forum.scssoft.com"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      aria-invalid={error === 'source'}
                    />
                    {errorOf('source')}
                  </label>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  {label(t('campaign'), t('campaignHint'))}
                  <Suggest
                    value={campaign}
                    onChange={setCampaign}
                    suggestions={campaigns}
                    ariaLabel={t('campaign')}
                  />
                </div>
                <label className="block">
                  {label(t('content'), t('contentHint'))}
                  <input
                    className="field"
                    maxLength={100}
                    placeholder={t('contentPlaceholder')}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    aria-invalid={error === 'content'}
                  />
                  {errorOf('content')}
                </label>
              </div>
            </>
          )}

          <label className="block">
            {label(t('name'), t('nameHint'))}
            <input
              className="field"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {errorOf('failed')}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !destination.trim()}
            className="btn-primary w-auto px-5"
          >
            {link ? t('save') : t('create')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** A text field with the values used before offered under it (no native datalist: ADR-0009). */
function Suggest({
  value,
  onChange,
  suggestions,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    return suggestions.filter((s) => s !== q && (!q || s.includes(q))).slice(0, 8);
  }, [suggestions, value]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  return (
    <div ref={root} className="relative">
      <input
        className="field"
        maxLength={100}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (!open || !shown.length) return;
          if (e.key === 'ArrowDown') setActive((i) => Math.min(shown.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter' && active >= 0) {
            onChange(shown[active]!);
            setOpen(false);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            return;
          } else return;
          e.preventDefault();
        }}
      />
      {open && shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="glass glass-strong animate-rise scroll-thin absolute right-0 left-0 z-50 mt-2 max-h-56 overflow-y-auto rounded-2xl p-1.5"
        >
          {shown.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === active}
              onPointerMove={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={`cursor-pointer truncate rounded-xl px-3 py-2 text-sm ${i === active ? 'bg-hover' : ''}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
