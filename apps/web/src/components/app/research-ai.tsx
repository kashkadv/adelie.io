'use client';

import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { DayField } from '../ui/day-picker';
import { InfoTip } from '../ui/info-tip';
import { Switch } from '../ui/switch';
import { ProductEditor } from './product-editor';
import { useSalesBase } from './sales-data';

interface Block {
  key: string;
  auto: boolean;
  enabled: boolean;
  text: string;
}

type Check =
  | { code: 'titleLong'; index: number; length: number }
  | { code: 'titleRepeats'; index: number; word: string }
  | { code: 'tagsCount'; count: number }
  | { code: 'tagLong'; tag: string; length: number }
  | { code: 'tagChars'; tag: string }
  | { code: 'pinTitleLong'; index: number; length: number }
  | { code: 'pinDescriptionLong'; index: number; length: number };

export interface Advice {
  titles: { title: string; why: string }[];
  tags: string[];
  tagsWhy: string;
  opening: string;
  openingWhy: string;
  pins: { title: string; description: string }[];
  checks: Check[];
  costUsd: number;
  createdAt: string;
}

const AUTO_KEYS = [
  'season',
  'markets',
  'etsy_rules',
  'pinterest_rules',
  'brand',
  'research_data',
] as const;

/**
 * The AI's context for a research (ADR-0032): automatic blocks (switch off any) and the owner's own
 * notes; the full instructions can be looked at as they are sent.
 */
export function ResearchContext({ base, canManage }: { base: string; canManage: boolean }) {
  const t = useTranslations('Research.ai');
  const [data, setData] = useState<{ blocks: Block[]; instructions: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    api<{ blocks: Block[]; instructions: string }>(`${base}/context`).then(
      setData,
      () => undefined,
    );
  }, [base, open, data]);

  async function save(blocks: Block[]) {
    setSaving(true);
    try {
      setData(
        await api<{ blocks: Block[]; instructions: string }>(`${base}/context`, {
          method: 'PUT',
          json: {
            off: blocks.filter((b) => b.auto && !b.enabled).map((b) => b.key),
            own: blocks
              .filter((b) => !b.auto)
              .map((b) => ({ id: b.key, text: b.text, enabled: b.enabled })),
          },
        }),
      );
    } finally {
      setSaving(false);
    }
  }
  const setBlock = (key: string, patch: Partial<Block>) =>
    data &&
    setData({ ...data, blocks: data.blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)) });

  return (
    <section className="card animate-rise mb-4 rounded-[24px] p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5"
        >
          <ChevronDown
            size={15}
            className={`transition-transform ${open ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
          {t('contextTitle')}
        </button>
        <InfoTip text={t('contextHint')} />
      </h2>
      {open && !data && <p className="mt-3 text-sm text-muted">…</p>}
      {open && data && (
        <div className="mt-3 grid gap-2">
          {data.blocks.map((b) => (
            <div key={b.key} className="rounded-2xl border border-line px-3.5 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === b.key ? null : b.key)}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${b.enabled ? '' : 'text-muted line-through'}`}
                >
                  <ChevronDown
                    size={13}
                    className={`shrink-0 transition-transform ${expanded === b.key ? '' : '-rotate-90'}`}
                    aria-hidden="true"
                  />
                  {b.auto ? (
                    <span className="truncate">
                      {AUTO_KEYS.includes(b.key as (typeof AUTO_KEYS)[number])
                        ? t(`blocks.${b.key as (typeof AUTO_KEYS)[number]}`)
                        : b.key}
                    </span>
                  ) : (
                    <span className="truncate">
                      {t('ownBlock')}: {b.text.slice(0, 60)}
                    </span>
                  )}
                  {b.auto && (
                    <span className="shrink-0 rounded-full bg-hover px-1.5 text-[11px] text-muted">
                      {t('auto')}
                    </span>
                  )}
                </button>
                {canManage && (
                  <Switch
                    checked={b.enabled}
                    label={t('enabled')}
                    onChange={(on) => {
                      const blocks = data.blocks.map((x) =>
                        x.key === b.key ? { ...x, enabled: on } : x,
                      );
                      void save(blocks);
                    }}
                  />
                )}
                {canManage && !b.auto && (
                  <button
                    type="button"
                    onClick={() => void save(data.blocks.filter((x) => x.key !== b.key))}
                    aria-label={t('remove')}
                    className="icon-btn h-7 w-7"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
              {expanded === b.key &&
                (b.auto || !canManage ? (
                  <pre className="scroll-thin mt-2 max-h-60 overflow-auto text-xs leading-relaxed whitespace-pre-wrap text-muted">
                    {b.text}
                  </pre>
                ) : (
                  <div className="mt-2">
                    <textarea
                      rows={3}
                      maxLength={1500}
                      className="field scroll-thin resize-y py-2 text-sm"
                      value={b.text}
                      onChange={(e) => setBlock(b.key, { text: e.target.value })}
                    />
                    <div className="mt-1.5 flex justify-end">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void save(data.blocks)}
                        className="btn-primary w-auto px-4 py-1.5 text-sm"
                      >
                        {t('save')}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  const key = `own${Date.now().toString(36)}`;
                  setData({
                    ...data,
                    blocks: [...data.blocks, { key, auto: false, enabled: true, text: '' }],
                  });
                  setExpanded(key);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs hover:bg-hover"
              >
                <Plus size={13} aria-hidden="true" />
                {t('addOwn')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="text-xs text-muted hover:text-foreground hover:underline"
            >
              {showAll ? t('hidePrompt') : t('showPrompt')}
            </button>
          </div>
          {showAll && (
            <pre className="scroll-thin max-h-96 overflow-auto rounded-2xl bg-hover p-3.5 text-xs leading-relaxed whitespace-pre-wrap">
              {data.instructions}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The AI's advice for one product (ADR-0032): title variants, 13 tags, the description's opening,
 * two pins; the checks of Etsy's and Pinterest's limits. A title and tags open in the Etsy editor
 * as "will be"; a pin goes into the calendar with a tracked link.
 */
export function AdviceDialog({
  base,
  product,
  initial,
  canManage,
  isEtsy,
  onClose,
  onAdvice,
}: {
  base: string;
  product: { id: string; title: string };
  initial: Advice | null;
  canManage: boolean;
  isEtsy: boolean;
  onClose: () => void;
  onAdvice: (a: Advice) => void;
}) {
  const t = useTranslations('Research.ai');
  const locale = useLocale();
  const salesBase = useSalesBase();
  const titleId = useId();
  const [advice, setAdvice] = useState<Advice | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(0);
  const [tags, setTags] = useState<Set<string>>(new Set(initial?.tags ?? []));
  const [editing, setEditing] = useState(false);
  const [pinDays, setPinDays] = useState<Record<number, string | null>>({});
  const [pinned, setPinned] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const a = await api<Advice>(`${base}/advice`, {
        method: 'POST',
        json: { productId: product.id, locale },
      });
      setAdvice(a);
      setTitle(0);
      setTags(new Set(a.tags));
      setPinned({});
      onAdvice(a);
    } catch (err) {
      const errors =
        err instanceof ApiError
          ? (err.body as { errors?: Record<string, string> } | null)?.errors
          : undefined;
      setError(errors?.['ai'] === 'limit' ? 'limit' : errors?.['ai'] === 'off' ? 'off' : 'failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // No advice yet: ask at once (after the first render, not inside it).
    if (!initial && canManage) void Promise.resolve().then(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPin(i: number) {
    const pin = advice?.pins[i];
    if (!pin) return;
    try {
      const r = await api<{ code: string }>(`${base}/pin`, {
        method: 'POST',
        json: {
          productId: product.id,
          title: pin.title,
          description: pin.description,
          date: pinDays[i] ?? null,
        },
      });
      setPinned({ ...pinned, [i]: r.code });
    } catch {
      setError('failed');
    }
  }

  const issue = (c: Check) => {
    switch (c.code) {
      case 'titleLong':
        return t('checks.titleLong', { n: c.index + 1, length: c.length });
      case 'titleRepeats':
        return t('checks.titleRepeats', { n: c.index + 1, word: c.word });
      case 'tagsCount':
        return t('checks.tagsCount', { count: c.count });
      case 'tagLong':
        return t('checks.tagLong', { tag: c.tag, length: c.length });
      case 'tagChars':
        return t('checks.tagChars', { tag: c.tag });
      case 'pinTitleLong':
        return t('checks.pinTitleLong', { n: c.index + 1, length: c.length });
      case 'pinDescriptionLong':
        return t('checks.pinDescriptionLong', { n: c.index + 1, length: c.length });
    }
  };
  const chosenTags = advice ? advice.tags.filter((x) => tags.has(x)) : [];
  const tooLong = (tag: string) => tag.length > 20;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass glass-strong animate-rise scroll-thin relative max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-[28px] p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Sparkles size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {t('adviceTitle')}
            </h2>
            <p className="truncate text-sm text-muted">{product.title}</p>
          </div>
          {canManage && advice && (
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs hover:bg-hover"
            >
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
              {t('again')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="icon-btn h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {busy && !advice && (
          <p className="mt-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted">
            <Sparkles size={15} className="animate-pulse" aria-hidden="true" />
            {t('thinking')}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
          >
            {t(`errors.${error as 'limit' | 'off' | 'failed'}`)}
          </p>
        )}

        {advice && (
          <div className={`mt-5 grid gap-5 ${busy ? 'opacity-50' : ''}`}>
            {advice.checks.length > 0 && (
              <ul className="grid gap-1 rounded-2xl bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                {advice.checks.map((c, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {issue(c)}
                  </li>
                ))}
              </ul>
            )}

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t('titles')}</h3>
              <div className="grid gap-2">
                {advice.titles.map((x, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setTitle(i)}
                    className={`rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                      title === i ? 'border-accent' : 'border-line hover:bg-hover'
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${title === i ? 'border-accent bg-accent text-accent-foreground' : 'border-[var(--field-focus)]'}`}
                      >
                        {title === i && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block">{x.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {x.title.length}/140 · {x.why}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                {t('tags', { count: chosenTags.length })}
                <InfoTip text={t('tagsHint')} />
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {advice.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      const next = new Set(tags);
                      if (next.has(tag)) next.delete(tag);
                      else next.add(tag);
                      setTags(next);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      tags.has(tag)
                        ? tooLong(tag)
                          ? 'border-amber-500 bg-amber-500/10'
                          : 'border-accent bg-accent text-accent-foreground'
                        : 'border-line text-muted line-through'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              {advice.tagsWhy && <p className="mt-1.5 text-xs text-muted">{advice.tagsWhy}</p>}
            </section>

            {advice.opening && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  {t('opening')}
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(advice.opening).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                    aria-label={t('copy')}
                    className="icon-btn h-7 w-7"
                  >
                    {copied ? (
                      <Check size={13} aria-hidden="true" />
                    ) : (
                      <Copy size={13} aria-hidden="true" />
                    )}
                  </button>
                </h3>
                <p className="rounded-2xl bg-hover px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line">
                  {advice.opening}
                </p>
                {advice.openingWhy && (
                  <p className="mt-1.5 text-xs text-muted">{advice.openingWhy}</p>
                )}
              </section>
            )}

            {canManage && isEtsy && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={
                    !salesBase ||
                    chosenTags.length === 0 ||
                    chosenTags.some(tooLong) ||
                    chosenTags.length > 13
                  }
                  className="btn-primary flex w-auto items-center gap-2 px-5"
                >
                  <Pencil size={15} aria-hidden="true" />
                  {t('openEditor')}
                </button>
              </div>
            )}

            {advice.pins.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  {t('pins')}
                  <InfoTip text={t('pinsHint')} />
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {advice.pins.map((p, i) => (
                    <div key={i} className="rounded-2xl border border-line p-3.5 text-sm">
                      <p className="font-medium">{p.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{p.description}</p>
                      {canManage &&
                        (pinned[i] ? (
                          <p className="mt-3 flex items-center gap-1.5 text-xs">
                            <Check size={13} aria-hidden="true" />
                            {t('pinned', { code: pinned[i]! })}
                          </p>
                        ) : (
                          <div className="mt-3 flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <DayField
                                ariaLabel={t('pinDay')}
                                value={pinDays[i] ?? null}
                                onChange={(d) => setPinDays({ ...pinDays, [i]: d })}
                                emptyLabel={t('noDay')}
                                clearLabel={t('noDay')}
                                previousLabel={t('previousMonth')}
                                nextLabel={t('nextMonth')}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => void addPin(i)}
                              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border border-line px-3 text-xs hover:bg-hover"
                            >
                              <CalendarPlus size={14} aria-hidden="true" />
                              {t('toCalendar')}
                            </button>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <p className="text-right text-xs text-muted">
              {t('cost', { cost: advice.costUsd.toFixed(3) })}
            </p>
          </div>
        )}
      </div>
      {editing && salesBase && advice && (
        <ProductEditor
          base={salesBase}
          productId={product.id}
          proposed={{ title: advice.titles[title]?.title, tags: chosenTags }}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </div>,
    document.body,
  );
}
