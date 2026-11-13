'use client';

import { ArrowLeft, Check, ListChecks, RefreshCw, Search, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { Checkbox } from '../ui/checkbox';
import { InfoTip } from '../ui/info-tip';
import { PlatformIcon } from '../ui/platform-icon';
import type { Research } from './research-data';

const pct = (v: number | null) =>
  v === null ? '—' : v >= 10000 ? '∞' : `${v > 0 ? '+' : ''}${Math.round(v)}%`;

/**
 * One niche research (ADR-0032): its sources (Pinterest Trends, the Etsy market), the products
 * ranked for promotion with why, the keyword pool and what the top Etsy listings share.
 */
export function ResearchDetail({
  base,
  id,
  canManage,
  onBack,
}: {
  base: string;
  id: string;
  canManage: boolean;
  onBack: () => void;
}) {
  const t = useTranslations('Research');
  const format = useFormatter();
  const [data, setData] = useState<Research | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<Research>(`${base}/${id}`).then(
      (r) => !cancelled && setData(r),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [base, id, version]);

  async function refresh() {
    setRefreshing(true);
    try {
      setData(await api<Research>(`${base}/${id}/refresh`, { method: 'POST' }));
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-sm text-muted hover:bg-hover hover:text-foreground"
    >
      <ArrowLeft size={15} aria-hidden="true" />
      {t('back')}
    </button>
  );
  if (failed && !data)
    return (
      <>
        {back}
        <p className="py-10 text-center text-sm text-muted">{t('notFound')}</p>
      </>
    );
  if (!data)
    return (
      <>
        {back}
        <p className="py-10 text-center text-sm text-muted">…</p>
      </>
    );

  const when = (d: string) =>
    format.dateTime(new Date(d), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const n = (v: number | null) => (v === null ? '—' : format.number(v));
  const { pinterest, etsy } = data.sources;

  return (
    <>
      {back}
      <header className="animate-rise mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-semibold md:text-[28px]">{data.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {data.salesAccount.platform && (
              <PlatformIcon
                platform={data.salesAccount.platform as 'ETSY' | 'WEBSITE'}
                size={14}
                strokeWidth={1.75}
              />
            )}
            {data.salesAccount.name} ·{' '}
            <PlatformIcon platform="PINTEREST" size={14} strokeWidth={1.75} />
            {t('channels.pinterest')} · {data.keywords.join(', ')}
            {data.endsOn &&
              ` · ${t('until', { date: format.dateTime(new Date(`${data.endsOn}T00:00:00Z`), { day: 'numeric', month: 'short', timeZone: 'UTC' }) })}`}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="btn-primary flex w-auto items-center gap-2 px-4"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {refreshing ? t('refreshing') : t('refresh')}
          </button>
        )}
      </header>

      <section className="card animate-rise mb-4 grid gap-1.5 rounded-[24px] px-5 py-3.5 text-sm">
        <p className="flex flex-wrap items-center gap-1.5">
          <PlatformIcon platform="PINTEREST" size={14} strokeWidth={1.75} />
          <span className="font-medium">{t('sourcePinterest')}</span>
          <InfoTip text={t('sourcePinterestHint')} />
          <span className="text-muted">
            {!pinterest
              ? t('notRefreshed')
              : pinterest.error
                ? t('sourceError', {
                    error:
                      pinterest.error === 'no_pinterest'
                        ? t('errors.no_pinterest')
                        : pinterest.error,
                  })
                : t('sourcePinterestOk', {
                    count: pinterest.keywords,
                    regions: pinterest.regions.join(', '),
                    date: when(pinterest.fetchedAt),
                  })}
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-1.5">
          <PlatformIcon platform="ETSY" size={14} strokeWidth={1.75} />
          <span className="font-medium">{t('sourceEtsy')}</span>
          <InfoTip text={t('sourceEtsyHint')} />
          <span className="text-muted">
            {!etsy
              ? t('notRefreshed')
              : etsy.error
                ? t('sourceError', { error: etsy.error })
                : t('sourceEtsyOk', { count: etsy.markets.length, date: when(etsy.fetchedAt) })}
          </span>
        </p>
      </section>

      {/* Products ranked for promotion. */}
      <section className="card animate-rise mb-4 rounded-[24px] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            {t('productsTitle', { count: data.products.length })}
            <InfoTip text={t('productsHint')} />
          </h2>
          {canManage && (
            <button
              type="button"
              onClick={() => setChoosing(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs hover:bg-hover"
            >
              <ListChecks size={14} aria-hidden="true" />
              {t('chooseProducts')}
            </button>
          )}
        </div>
        {data.products.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('noProducts')}</p>
        ) : (
          <ol className="divide-y divide-line">
            {data.products.map((p, i) => (
              <li key={p.id} className="flex gap-3 py-3">
                <span className="tabular w-5 shrink-0 pt-1 text-right text-sm text-muted">
                  {i + 1}
                </span>
                <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-hover">
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={p.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="line-clamp-2 text-sm font-medium hover:underline"
                  >
                    {p.title}
                  </a>
                  <p className="mt-0.5 text-xs text-muted">
                    {t('productStats', {
                      sold: n(p.sold12m),
                      favorers: n(p.favorers),
                      views: n(p.views),
                      tags: p.tags,
                    })}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.reasons.map((r) => (
                      <span
                        key={r}
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          r === 'noTags' || r === 'fewTags' || r === 'shortTitle'
                            ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                            : 'bg-hover'
                        }`}
                      >
                        {t(`reasons.${r}`)}
                      </span>
                    ))}
                  </div>
                  {(p.matched.length > 0 || p.missing.length > 0) && (
                    <p className="mt-1.5 text-xs leading-relaxed">
                      {p.matched.length > 0 && (
                        <span className="text-muted">
                          {t('matched')}: {p.matched.slice(0, 6).join(', ')}
                        </span>
                      )}
                      {p.missing.length > 0 && (
                        <span className="block">
                          <span className="text-muted">{t('missing')}: </span>
                          {p.missing.slice(0, 6).join(', ')}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <span className="tabular shrink-0 pt-1 text-sm font-semibold" title={t('score')}>
                  {format.number(p.score, { maximumFractionDigits: 1 })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* The keyword pool. */}
      <section className="card animate-rise mb-4 rounded-[24px] p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          {t('poolTitle')}
          <InfoTip text={t('poolHint')} />
        </h2>
        {data.pool.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('poolEmpty')}</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pr-3 pb-2 font-normal">{t('colPhrase')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colMom')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colYoy')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colEtsy')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colOwn')}</th>
                  <th className="pb-2 pl-3 text-right font-normal">{t('score')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.pool.slice(0, 50).map((p) => (
                  <tr key={p.phrase}>
                    <td className="py-1.5 pr-3">
                      {p.phrase}
                      {p.pinterest && (
                        <span className="ml-1.5 text-xs text-muted">
                          {p.pinterest.regions.join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right">
                      {p.pinterest ? pct(p.pinterest.mom) : '—'}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right">
                      {p.pinterest ? pct(p.pinterest.yoy) : '—'}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right">{p.etsy || '—'}</td>
                    <td className="tabular px-3 py-1.5 text-right">{p.own || '—'}</td>
                    <td className="tabular py-1.5 pl-3 text-right font-medium">
                      {format.number(p.score, { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* What the top Etsy listings share, by phrase. */}
      {etsy && etsy.markets.length > 0 && (
        <section className="animate-rise mb-4 grid gap-3 md:grid-cols-2">
          {etsy.markets.map((m) => (
            <div key={m.keyword} className="card rounded-[24px] p-5 text-sm">
              <h3 className="flex items-center gap-1.5 font-semibold">
                <Search size={14} aria-hidden="true" />«{m.keyword}» {t('onEtsy')}
              </h3>
              <dl className="mt-2 grid gap-1">
                <div className="flex justify-between">
                  <dt className="text-muted">{t('listings')}</dt>
                  <dd className="tabular">{format.number(m.count)}</dd>
                </div>
                {m.priceUsd && (
                  <div className="flex justify-between">
                    <dt className="flex items-center gap-1 text-muted">
                      {t('price')}
                      <InfoTip text={t('priceHint', { count: m.priceUsd.listings })} />
                    </dt>
                    <dd className="tabular">
                      ${m.priceUsd.min} – ${m.priceUsd.max} · {t('median')} ${m.priceUsd.median}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted">{t('avgFavorers')}</dt>
                  <dd className="tabular">{format.number(m.avgFavorers)}</dd>
                </div>
              </dl>
              <p className="mt-3 mb-1 text-xs text-muted">{t('topTags')}</p>
              <div className="flex flex-wrap gap-1">
                {m.tags.slice(0, 18).map((tag) => (
                  <span key={tag.tag} className="rounded-full bg-hover px-2 py-0.5 text-xs">
                    {tag.tag} <span className="text-muted">{tag.n}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {choosing && (
        <ProductPicker
          base={`${base}/${id}`}
          selected={data.productIds}
          onClose={() => setChoosing(false)}
          onSaved={() => {
            setChoosing(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}

/** Chooses the research's products from the sales point's catalogue. */
function ProductPicker({
  base,
  selected,
  onClose,
  onSaved,
}: {
  base: string;
  selected: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Research');
  const titleId = useId();
  const [catalogue, setCatalogue] = useState<
    { id: string; title: string; category: string | null }[] | null
  >(null);
  const [chosen, setChosen] = useState(new Set(selected));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ products: { id: string; title: string; category: string | null }[] }>(
      `${base}/catalogue`,
    ).then(
      (r) => setCatalogue(r.products),
      () => setCatalogue([]),
    );
  }, [base]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = catalogue ?? [];
    const filtered = q
      ? list.filter((p) => `${p.title} ${p.category ?? ''}`.toLowerCase().includes(q))
      : list;
    return [...filtered].sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, query]);

  async function save() {
    setBusy(true);
    try {
      await api(base, { method: 'PATCH', json: { productIds: [...chosen] } });
      onSaved();
    } catch {
      setBusy(false);
    }
  }

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
        className="glass glass-strong animate-rise relative flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col rounded-[28px] p-6"
      >
        <div className="flex items-center gap-3">
          <h2 id={titleId} className="flex-1 text-lg font-semibold">
            {t('chooseProducts')}
          </h2>
          <span className="text-sm text-muted">{t('chosen', { count: chosen.size })}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="icon-btn h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <input
          autoFocus
          className="field mt-4"
          placeholder={t('searchProducts')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="scroll-thin mt-3 min-h-40 flex-1 overflow-y-auto">
          {!catalogue ? (
            <li className="py-6 text-center text-sm text-muted">…</li>
          ) : (
            shown.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-hover">
                  <Checkbox
                    checked={chosen.has(p.id)}
                    label={p.title}
                    onChange={(on) => {
                      const next = new Set(chosen);
                      if (on) next.add(p.id);
                      else next.delete(p.id);
                      setChosen(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  {p.category && <span className="shrink-0 text-xs text-muted">{p.category}</span>}
                </label>
              </li>
            ))
          )}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || chosen.size === 0 || chosen.size > 60}
            className="btn-primary flex w-auto items-center gap-1.5 px-5"
          >
            <Check size={15} aria-hidden="true" />
            {t('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
