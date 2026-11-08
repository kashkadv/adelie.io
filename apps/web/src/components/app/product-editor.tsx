'use client';

import { ArrowLeft, ArrowRight, Check, Lock, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Switch } from '../ui/switch';
import { minorDigits, useMoney } from './sales-data';

type Editable = {
  title: string;
  description: string;
  tags: string[];
  hasVariations: boolean;
  price: { amount: number; currency: string } | null;
  quantity: number | null;
  state: string;
  variations: {
    id: string;
    options: { name: string; value: string }[];
    price: { amount: number; currency: string } | null;
    quantity: number | null;
    enabled: boolean;
  }[];
  /** Each variation has its own price / quantity; otherwise one value for all. */
  priceVaries: boolean;
  quantityVaries: boolean;
};
type Field = 'title' | 'description' | 'tags' | 'price' | 'quantity' | 'variations';
/** A variation as edited: price in minor units. */
type Var = { id: string; price: number | null; quantity: number | null; enabled: boolean };
type Change = {
  id: string;
  changes: Partial<Record<Field, { from: unknown; to: unknown }>>;
  status: 'applied' | 'failed';
  error: string | null;
  createdAt: string;
  user: { name: string } | null;
};
type EditData = {
  canEdit: boolean;
  reason: 'role' | 'connection' | 'readOnly' | 'removed' | null;
  current: Editable | null;
  history: Change[];
};
type Values = {
  title: string;
  description: string;
  tags: string[];
  price: number | null;
  quantity: number | null;
  variations: Var[];
};

/** Etsy's limits (the API checks the same, packages/platforms etsy/mapping.ts). */
const LIMITS = { title: 140, tags: 13, tag: 20, quantity: 999 };
const TAG = /^[\p{L}\p{N}\s\-'™©®]+$/u;
const FIELDS: Field[] = ['title', 'description', 'tags', 'price', 'quantity', 'variations'];

const valuesOf = (p: Editable): Values => ({
  title: p.title,
  description: p.description,
  tags: p.tags,
  price: p.price?.amount ?? null,
  quantity: p.quantity,
  // Sorted by id, like the API compares them.
  variations: p.variations
    .map((v) => ({
      id: v.id,
      price: v.price?.amount ?? null,
      quantity: v.quantity,
      enabled: v.enabled,
    }))
    .sort((a, b) => a.id.localeCompare(b.id)),
});
const priceTextOf = (minor: number | null, digits: number) =>
  minor === null ? '' : (minor / 10 ** digits).toFixed(digits);
const toMinor = (text: string, digits: number) =>
  text.trim() ? Math.round(Number(text.replace(',', '.')) * 10 ** digits) : null;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Tags as chips: Enter or comma adds, Backspace in an empty input removes the last one. */
function TagInput({
  tags,
  onChange,
  label,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  label: string;
}) {
  const t = useTranslations('Sales.editor');
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const lower = tags.map((x) => x.toLowerCase());
    onChange([...tags, ...parts.filter((p) => !lower.includes(p.toLowerCase()))]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };
  return (
    <div className="field flex min-h-11 flex-wrap items-center gap-1.5 py-2">
      {tags.map((tag) => {
        const bad = tag.length > LIMITS.tag || !TAG.test(tag);
        return (
          <span
            key={tag}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              bad ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-hover'
            }`}
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== tag))}
              aria-label={t('removeTag', { tag })}
              className="text-muted hover:text-foreground"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        );
      })}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        aria-label={label}
        placeholder={tags.length < LIMITS.tags ? t('addTag') : ''}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
    </div>
  );
}

/**
 * Editing a shop product (ADR-0019): loads it live from the platform, then edit → review
 * "was → will be" → save. Saving sends only what differs; a change made on the platform meanwhile
 * stops the save (nothing is overwritten silently). Every save is in the product's history.
 */
export function ProductEditor({
  base,
  productId,
  onClose,
  onSaved,
}: {
  base: string;
  productId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Sales.editor');
  const format = useFormatter();
  const money = useMoney();
  const titleId = useId();
  const [data, setData] = useState<EditData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [values, setValues] = useState<Values | null>(null);
  const [priceText, setPriceText] = useState('');
  /** Per-variation price as typed, by variation id. */
  const [varPrices, setVarPrices] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const currency = data?.current?.price?.currency ?? 'USD';
  const digits = minorDigits(currency);

  const digitsOf = (p: Editable) => minorDigits(p.price?.currency ?? 'USD');

  function reset(d: EditData) {
    setData(d);
    if (d.current) {
      setValues(valuesOf(d.current));
      setPriceText(priceTextOf(d.current.price?.amount ?? null, digitsOf(d.current)));
      setVarPrices(
        Object.fromEntries(
          d.current.variations.map((v) => [
            v.id,
            priceTextOf(v.price?.amount ?? null, digitsOf(d.current!)),
          ]),
        ),
      );
    }
  }
  useEffect(() => {
    let cancelled = false;
    api<EditData>(`${base}/products/${productId}/edit`).then(
      (d) => {
        if (cancelled) return;
        reset(d);
      },
      () => !cancelled && setLoadFailed(true),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per product
  }, [base, productId]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, saving]);

  const original = data?.current ? valuesOf(data.current) : null;
  const priceMinor = toMinor(priceText, digits);
  const edited: Values | null = values
    ? {
        ...values,
        price: priceMinor,
        variations: values.variations.map((v) => ({
          ...v,
          price: toMinor(varPrices[v.id] ?? '', digits),
        })),
      }
    : null;
  const variationsOf = data?.current?.variations ?? [];
  const optionsOf = (id: string) =>
    variationsOf
      .find((v) => v.id === id)
      ?.options.map((o) => o.value)
      .join(' · ') ?? id;
  /** One variation changed — or all of them, when the value is shared. */
  const setVar = (id: string, patch: Partial<Var>) =>
    values &&
    setValues({
      ...values,
      variations: values.variations.map((v) =>
        v.id === id || ('quantity' in patch && !data?.current?.quantityVaries)
          ? { ...v, ...patch }
          : v,
      ),
    });
  const setVarPrice = (id: string, text: string) =>
    setVarPrices((all) =>
      data?.current?.priceVaries
        ? { ...all, [id]: text }
        : Object.fromEntries(Object.keys(all).map((k) => [k, text])),
    );
  const changed = FIELDS.filter((f) => original && edited && !same(original[f], edited[f]));

  // Etsy's rules, shown under the field (rules.md §6: only errors there).
  const errors: Partial<Record<Field, string>> = {};
  if (edited) {
    if (!edited.title.trim()) errors.title = t('errors.titleEmpty');
    else if (edited.title.length > LIMITS.title) errors.title = t('errors.titleTooLong');
    if (edited.tags.length > LIMITS.tags) errors.tags = t('errors.tooManyTags');
    else if (edited.tags.some((x) => x.length > LIMITS.tag)) errors.tags = t('errors.tagTooLong');
    else if (edited.tags.some((x) => !TAG.test(x))) errors.tags = t('errors.tagInvalid');
    if (changed.includes('price') && (priceMinor === null || !(priceMinor >= 20))) {
      errors.price = t('errors.priceInvalid');
    }
    if (
      changed.includes('quantity') &&
      (edited.quantity === null ||
        !Number.isInteger(edited.quantity) ||
        edited.quantity < 0 ||
        edited.quantity > LIMITS.quantity)
    ) {
      errors.quantity = t('errors.quantityInvalid');
    }
  }
  if (edited && changed.includes('variations')) {
    const vs = edited.variations;
    if (vs.some((v) => v.price === null || !(v.price >= 20))) {
      errors.variations = t('errors.priceInvalid');
    } else if (
      vs.some(
        (v) =>
          v.quantity === null ||
          !Number.isInteger(v.quantity) ||
          v.quantity < 0 ||
          v.quantity > LIMITS.quantity,
      )
    ) {
      errors.variations = t('errors.quantityInvalid');
    } else if (vs.every((v) => !v.enabled)) {
      errors.variations = t('errors.noVariationOnSale');
    }
  }
  const valid = Object.keys(errors).length === 0;

  async function save() {
    if (!edited || !original) return;
    setSaving(true);
    setNotice(null);
    const pick = (v: Values) => Object.fromEntries(changed.map((f) => [f, v[f]]));
    try {
      const result = await api<{ current: Editable; history: Change[] }>(
        `${base}/products/${productId}`,
        { method: 'PATCH', json: { changes: pick(edited), expected: pick(original) } },
      );
      reset({ ...data!, current: result.current, history: result.history });
      setStep('edit');
      setNotice({ tone: 'ok', text: t('saved') });
      onSaved();
    } catch (error) {
      const body =
        error instanceof ApiError ? (error.body as Record<string, unknown> | null) : null;
      if (error instanceof ApiError && error.status === 409 && body?.['current']) {
        // Changed on Etsy meanwhile: show the fresh version, nothing was sent.
        reset({ ...data!, current: body['current'] as Editable });
        setStep('edit');
        setNotice({ tone: 'warn', text: t('conflict') });
      } else if (body?.['reason'] === 'variations') {
        setNotice({ tone: 'warn', text: t('variations') });
      } else if (body?.['reason'] === 'rejected') {
        setNotice({
          tone: 'warn',
          text: t('rejected', { message: String(body['message'] ?? '') }),
        });
      } else {
        setNotice({ tone: 'warn', text: t('failed') });
      }
    } finally {
      setSaving(false);
    }
  }

  const show = (f: Field, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (f === 'price') return money(v as number, currency);
    if (f === 'tags') return (v as string[]).join(', ');
    return String(v);
  };

  const label = (f: Field, extra?: string) => (
    <span className="mb-1.5 flex items-center justify-between gap-2 px-3.5 text-sm text-muted">
      <span className="flex items-center gap-1.5">
        {t(`fields.${f}`)}
        {f === 'variations' && <InfoTip text={t('variationsHint')} />}
        {f === 'tags' && <InfoTip text={t('tagsHint')} />}
      </span>
      {extra && <span className="tabular text-xs">{extra}</span>}
    </span>
  );
  const fieldError = (f: Field) =>
    errors[f] && (
      <p className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">{errors[f]}</p>
    );

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass glass-strong animate-rise relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-[28px]"
      >
        <div className="flex items-start gap-3 border-b border-line p-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {step === 'review' ? t('reviewTitle') : t('title')}
            </h2>
            <p className="truncate text-sm text-muted">{data?.current?.title ?? '…'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={t('close')}
            className="icon-btn h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          {notice && (
            <p
              role="status"
              className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                notice.tone === 'ok'
                  ? 'border-line bg-hover'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
              }`}
            >
              {notice.text}
            </p>
          )}

          {loadFailed ? (
            <p className="text-sm text-muted">{t('loadFailed')}</p>
          ) : !data ? (
            <p className="py-10 text-center text-sm text-muted">…</p>
          ) : !data.canEdit ? (
            <div className="flex items-start gap-3 rounded-2xl border border-line p-4 text-sm">
              <Lock size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
              <div>
                <p>{t(`reasons.${data.reason ?? 'connection'}`)}</p>
                {data.reason === 'readOnly' && (
                  <Link href="/connections" className="mt-2 inline-block font-medium underline">
                    {t('enableFullAccess')}
                  </Link>
                )}
              </div>
            </div>
          ) : step === 'edit' && values ? (
            <div className="grid gap-4">
              <label className="block">
                {label('title', `${values.title.length}/${LIMITS.title}`)}
                <input
                  className="field"
                  value={values.title}
                  onChange={(e) => setValues({ ...values, title: e.target.value })}
                />
                {fieldError('title')}
              </label>
              <label className="block">
                {label('description')}
                <textarea
                  className="field scroll-thin min-h-40 resize-y py-3 leading-relaxed"
                  value={values.description}
                  onChange={(e) => setValues({ ...values, description: e.target.value })}
                />
              </label>
              <div>
                {label('tags', `${values.tags.length}/${LIMITS.tags}`)}
                <TagInput
                  tags={values.tags}
                  onChange={(tags) => setValues({ ...values, tags })}
                  label={t('fields.tags')}
                />
                {fieldError('tags')}
              </div>
              {data.current?.hasVariations ? (
                <div>
                  {label('variations', currency)}
                  {/* A shared price or quantity is edited once for every variation. */}
                  {(!data.current.priceVaries || !data.current.quantityVaries) && (
                    <div className="mb-3 grid grid-cols-2 gap-4">
                      {!data.current.priceVaries && (
                        <label className="block">
                          <span className="mb-1.5 block px-3.5 text-xs text-muted">
                            {t('sharedPrice')}
                          </span>
                          <input
                            className="field tabular"
                            inputMode="decimal"
                            value={varPrices[values.variations[0]?.id ?? ''] ?? ''}
                            onChange={(e) =>
                              setVarPrice(values.variations[0]?.id ?? '', e.target.value)
                            }
                          />
                        </label>
                      )}
                      {!data.current.quantityVaries && (
                        <label className="block">
                          <span className="mb-1.5 block px-3.5 text-xs text-muted">
                            {t('sharedQuantity')}
                          </span>
                          <input
                            className="field tabular"
                            inputMode="numeric"
                            value={values.variations[0]?.quantity ?? ''}
                            onChange={(e) =>
                              setVar(values.variations[0]?.id ?? '', {
                                quantity: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                  <ul className="divide-y divide-line rounded-2xl border border-line">
                    {values.variations.map((v) => (
                      <li
                        key={v.id}
                        className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${
                          v.enabled ? '' : 'text-muted'
                        }`}
                      >
                        <span className="min-w-0 flex-1 basis-40 truncate" title={optionsOf(v.id)}>
                          {optionsOf(v.id)}
                        </span>
                        {data.current!.priceVaries ? (
                          <input
                            className="field tabular h-9 w-28 py-1 text-right"
                            inputMode="decimal"
                            aria-label={t('variationPrice', { variation: optionsOf(v.id) })}
                            value={varPrices[v.id] ?? ''}
                            onChange={(e) => setVarPrice(v.id, e.target.value)}
                          />
                        ) : (
                          <span className="tabular w-28 text-right text-muted">
                            {money(toMinor(varPrices[v.id] ?? '', digits), currency)}
                          </span>
                        )}
                        {data.current!.quantityVaries ? (
                          <input
                            className="field tabular h-9 w-20 py-1 text-right"
                            inputMode="numeric"
                            aria-label={t('variationQuantity', { variation: optionsOf(v.id) })}
                            value={v.quantity ?? ''}
                            onChange={(e) =>
                              setVar(v.id, {
                                quantity: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        ) : (
                          <span className="tabular w-20 text-right text-muted">
                            {v.quantity ?? '—'}
                          </span>
                        )}
                        <Switch
                          checked={v.enabled}
                          onChange={(on) => setVar(v.id, { enabled: on })}
                          label={t('onSale')}
                        />
                      </li>
                    ))}
                  </ul>
                  {fieldError('variations')}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    {label('price', currency)}
                    <input
                      className="field tabular"
                      inputMode="decimal"
                      value={priceText}
                      onChange={(e) => setPriceText(e.target.value)}
                    />
                    {fieldError('price')}
                  </label>
                  <label className="block">
                    {label('quantity')}
                    <input
                      className="field tabular"
                      inputMode="numeric"
                      value={values.quantity ?? ''}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          quantity: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                    {fieldError('quantity')}
                  </label>
                </div>
              )}
            </div>
          ) : (
            original &&
            edited && (
              <ul className="grid gap-3">
                {changed.map((f) => (
                  <li key={f} className="rounded-2xl border border-line p-4">
                    <p className="mb-2 text-xs text-muted">{t(`fields.${f}`)}</p>
                    {f === 'variations' ? (
                      <ul className="grid gap-1.5 text-sm">
                        {edited.variations
                          .filter(
                            (v) =>
                              !same(
                                v,
                                original.variations.find((o) => o.id === v.id),
                              ),
                          )
                          .map((v) => {
                            const o = original.variations.find((x) => x.id === v.id);
                            return (
                              <li key={v.id} className="flex flex-wrap gap-x-3">
                                <span className="font-medium">{optionsOf(v.id)}</span>
                                {o?.price !== v.price && (
                                  <span>
                                    <span className="text-muted line-through">
                                      {money(o?.price ?? null, currency)}
                                    </span>{' '}
                                    → {money(v.price, currency)}
                                  </span>
                                )}
                                {o?.quantity !== v.quantity && (
                                  <span>
                                    {t('fields.quantity')}:{' '}
                                    <span className="text-muted line-through">
                                      {o?.quantity ?? '—'}
                                    </span>{' '}
                                    → {v.quantity ?? '—'}
                                  </span>
                                )}
                                {o?.enabled !== v.enabled && (
                                  <span>{v.enabled ? t('nowOnSale') : t('nowOffSale')}</span>
                                )}
                              </li>
                            );
                          })}
                      </ul>
                    ) : f === 'tags' ? (
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {original.tags
                          .filter((x) => !edited.tags.includes(x))
                          .map((x) => (
                            <span
                              key={`-${x}`}
                              className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-700 line-through dark:text-rose-300"
                            >
                              {x}
                            </span>
                          ))}
                        {edited.tags
                          .filter((x) => !original.tags.includes(x))
                          .map((x) => (
                            <span
                              key={`+${x}`}
                              className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300"
                            >
                              + {x}
                            </span>
                          ))}
                      </div>
                    ) : (
                      <div className="grid gap-1 text-sm">
                        <p className="max-h-32 overflow-y-auto whitespace-pre-line text-muted line-through">
                          {show(f, original[f])}
                        </p>
                        <p className="max-h-32 overflow-y-auto whitespace-pre-line">
                          {show(f, edited[f])}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}

          {data && data.history.length > 0 && step === 'edit' && (
            <section className="mt-6">
              <h3 className="mb-2 px-1 text-sm font-semibold">{t('history')}</h3>
              <ul className="grid gap-1.5 text-xs text-muted">
                {data.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-2 px-1">
                    <span className="tabular">
                      {format.dateTime(new Date(h.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span>·</span>
                    <span>{h.user?.name ?? '—'}</span>
                    <span>·</span>
                    <span>
                      {Object.keys(h.changes)
                        .map((f) => t(`fields.${f as Field}`))
                        .join(', ')}
                    </span>
                    {h.status === 'failed' && (
                      <span className="text-rose-600 dark:text-rose-400" title={h.error ?? ''}>
                        {t('failedBadge')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {data?.canEdit && (
          <div className="flex items-center justify-end gap-2 border-t border-line p-4">
            {step === 'edit' ? (
              <>
                <span className="mr-auto px-1 text-xs text-muted">
                  {changed.length ? t('changedCount', { count: changed.length }) : t('noChanges')}
                </span>
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  disabled={!changed.length || !valid}
                  className="btn-primary inline-flex w-auto items-center gap-2 px-5"
                >
                  {t('review')}
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setStep('edit')}
                  disabled={saving}
                  className="mr-auto inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  {t('back')}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="btn-primary inline-flex w-auto items-center gap-2 px-5"
                >
                  <Check size={15} aria-hidden="true" />
                  {saving ? t('saving') : t('save')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
