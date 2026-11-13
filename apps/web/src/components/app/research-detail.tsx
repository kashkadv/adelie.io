'use client';

import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  ListChecks,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { Checkbox } from '../ui/checkbox';
import { InfoTip } from '../ui/info-tip';
import { PlatformIcon } from '../ui/platform-icon';
import { AdviceDialog, ResearchContext, type Advice } from './research-ai';
import { RatedTags, TagAuditLine } from './research-tags';
import { Select } from '../ui/select';
import type { PoolPhrase, Research, Seeds } from './research-data';
import { SeedSuggest } from './seed-suggest';

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
  const [advice, setAdvice] = useState<Record<string, Advice>>({});
  const [advising, setAdvising] = useState<{ id: string; title: string } | null>(null);
  const [editingPhrases, setEditingPhrases] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  /** A version other than the latest, when the owner looks back. */
  const [versionId, setVersionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Research>(`${base}/${id}${versionId ? `?version=${versionId}` : ''}`).then(
      (r) => !cancelled && setData(r),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [base, id, version, versionId]);

  useEffect(() => {
    let cancelled = false;
    api<{ advice: Record<string, Advice> }>(`${base}/${id}/advice`).then(
      (r) => !cancelled && setAdvice(r.advice),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base, id]);

  /** The owner's word on a pool phrase: hide, keep against the AI, or give back to the AI. */
  async function phraseAction(phrase: string, phraseAction: 'hide' | 'keep' | 'reset') {
    await api(`${base}/${id}`, { method: 'PATCH', json: { phrase, phraseAction } }).catch(
      () => undefined,
    );
    setVersion((v) => v + 1);
  }

  async function review() {
    setReviewing(true);
    try {
      await api(`${base}/${id}/review`, { method: 'POST' });
      setVersion((v) => v + 1);
    } catch {
      // the pool stays as it was
    } finally {
      setReviewing(false);
    }
  }

  /**
   * Starts an update (it runs on the server for up to a minute or two) and asks again every few
   * seconds until the new version is there.
   */
  async function refresh() {
    setRefreshing(true);
    setVersionId(null);
    try {
      await api(`${base}/${id}/refresh`, { method: 'POST' });
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await api<Research>(`${base}/${id}`);
        if (!r.refreshing) {
          setData(r);
          break;
        }
      }
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
  const hiddenCount = data.pool.filter((p) => !p.visible).length;
  const verdictLabel = (p: PoolPhrase) =>
    p.byOwner === 'hidden' ? t('verdicts.byOwner') : p.verdict ? t(`verdicts.${p.verdict}`) : '';

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
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEditingPhrases(true)}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-line px-4 text-sm hover:bg-hover"
            >
              <Pencil size={15} aria-hidden="true" />
              {t('editPhrases')}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="btn-primary flex w-auto items-center gap-2 px-4"
            >
              <RefreshCw
                size={15}
                className={refreshing ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              {refreshing ? t('refreshing') : t('refresh')}
            </button>
          </span>
        )}
      </header>

      {data.refreshError && !refreshing && (
        <p
          role="alert"
          className="animate-rise mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          {t('refreshFailed', { error: data.refreshError })}
        </p>
      )}

      {data.versions.length > 1 && (
        <div className="animate-rise mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            {t('versions')}
            <InfoTip text={t('versionsHint')} />
          </span>
          <div className="w-72">
            <Select
              ariaLabel={t('versions')}
              value={data.version?.id ?? ''}
              onChange={(v) => setVersionId(v === data.versions[0]?.id ? null : v)}
              options={data.versions.map((v, i) => ({
                value: v.id,
                label: `${when(v.createdAt)}${i === 0 ? ` · ${t('latest')}` : ''}`,
                hint: v.keywords.join(', ').slice(0, 40),
              }))}
            />
          </div>
          {data.version && data.version.id !== data.versions[0]?.id && (
            <button
              type="button"
              onClick={() => setVersionId(null)}
              className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-foreground"
            >
              {t('toLatest')}
            </button>
          )}
        </div>
      )}

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

      <ResearchContext key={version} base={`${base}/${id}`} canManage={canManage} />

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
                  <p className="mt-1 text-xs text-muted">
                    {t('productStats', {
                      sold: n(p.sold12m),
                      favorers: n(p.favorers),
                      views: n(p.views),
                      tags: p.tags,
                    })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
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
                    <p className="mt-3 grid gap-1 text-xs leading-relaxed">
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
                  <TagAuditLine audit={p.tagAudit} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="tabular pt-1 text-sm font-semibold" title={t('score')}>
                    {format.number(p.score, { maximumFractionDigits: 1 })}
                  </span>
                  {(canManage || advice[p.id]) && (
                    <button
                      type="button"
                      onClick={() => setAdvising({ id: p.id, title: p.title })}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs hover:bg-hover ${advice[p.id] ? 'border-accent' : 'border-line'}`}
                    >
                      <Sparkles size={13} aria-hidden="true" />
                      {advice[p.id] ? t('ai.showAdvice') : t('ai.advise')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <RatedTags tags={data.tags} ownPrice={data.ownPrice} error={data.tagsError} />

      {/* The keyword pool: what fits (the AI's review and the owner's word), the rest on request. */}
      <section className="card animate-rise mb-4 rounded-[24px] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            {t('poolTitle')}
            <InfoTip text={t('poolHint')} />
          </h2>
          <span className="flex flex-wrap items-center gap-2">
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowHidden(!showHidden)}
                className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-foreground"
              >
                {showHidden ? (
                  <EyeOff size={13} aria-hidden="true" />
                ) : (
                  <Eye size={13} aria-hidden="true" />
                )}
                {showHidden ? t('hideHidden') : t('showHidden', { count: hiddenCount })}
              </button>
            )}
            {canManage && data.pool.length > 0 && (
              <button
                type="button"
                onClick={() => void review()}
                disabled={reviewing}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-1 text-xs hover:bg-hover"
                title={
                  data.reviewedAt ? t('reviewedAt', { date: when(data.reviewedAt) }) : undefined
                }
              >
                <Sparkles
                  size={13}
                  className={reviewing ? 'animate-pulse' : ''}
                  aria-hidden="true"
                />
                {data.reviewedAt ? t('reviewAgain') : t('review')}
              </button>
            )}
          </span>
        </div>
        {data.pool.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('poolEmpty')}</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pr-3 pb-2 font-normal">{t('colPhrase')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colMom')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colYoy')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colEtsy')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('colOwn')}</th>
                  <th className="px-3 pb-2 text-right font-normal">{t('score')}</th>
                  <th className="pb-2 pl-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.pool
                  .filter((p) => p.visible || showHidden)
                  .slice(0, showHidden ? 80 : 50)
                  .map((p) => (
                    <tr key={p.phrase} className={p.visible ? '' : 'text-muted'}>
                      <td className="py-1.5 pr-3">
                        <span className={p.visible ? '' : 'line-through'}>{p.phrase}</span>
                        {p.pinterest && (
                          <span className="ml-1.5 text-xs text-muted">
                            {p.pinterest.regions.join(', ')}
                          </span>
                        )}
                        {!p.visible && (
                          <span className="ml-1.5 text-xs" title={p.why ?? undefined}>
                            · {verdictLabel(p)}
                            {p.why ? ` — ${p.why}` : ''}
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
                      <td className="tabular px-3 py-1.5 text-right font-medium">
                        {format.number(p.score, { maximumFractionDigits: 1 })}
                      </td>
                      <td className="py-1 pl-3 text-right">
                        {canManage && (
                          <button
                            type="button"
                            onClick={() =>
                              void phraseAction(
                                p.phrase,
                                p.byOwner ? 'reset' : p.visible ? 'hide' : 'keep',
                              )
                            }
                            title={
                              p.byOwner
                                ? t('phraseReset')
                                : p.visible
                                  ? t('phraseHide')
                                  : t('phraseKeep')
                            }
                            aria-label={
                              p.byOwner
                                ? t('phraseReset')
                                : p.visible
                                  ? t('phraseHide')
                                  : t('phraseKeep')
                            }
                            className="icon-btn h-7 w-7"
                          >
                            {p.visible ? (
                              <EyeOff size={13} aria-hidden="true" />
                            ) : (
                              <Eye size={13} aria-hidden="true" />
                            )}
                          </button>
                        )}
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

      {editingPhrases && (
        <PhrasesDialog
          base={`${base}/${id}`}
          initial={data.keywords}
          onClose={() => setEditingPhrases(false)}
          onSaved={() => {
            setEditingPhrases(false);
            void refresh();
          }}
        />
      )}

      {advising && (
        <AdviceDialog
          base={`${base}/${id}`}
          product={advising}
          initial={advice[advising.id] ?? null}
          canManage={canManage}
          isEtsy={data.salesAccount.platform === 'ETSY'}
          onClose={() => setAdvising(null)}
          onAdvice={(a) => setAdvice((all) => ({ ...all, [advising.id]: a }))}
        />
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

/** The research's niche phrases, with the AI's better ones to pick from; saving refreshes the data. */
function PhrasesDialog({
  base,
  initial,
  onClose,
  onSaved,
}: {
  base: string;
  initial: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Research');
  const locale = useLocale();
  const titleId = useId();
  const [keywords, setKeywords] = useState(initial.join(', '));
  const [busy, setBusy] = useState(false);
  const list = () =>
    keywords
      .split(/[,;\n]/)
      .map((k) => k.trim())
      .filter(Boolean);

  async function save() {
    setBusy(true);
    try {
      await api(base, { method: 'PATCH', json: { keywords: list() } });
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
        className="glass glass-strong animate-rise scroll-thin relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[28px] p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {t('editPhrases')}
        </h2>
        <label className="mt-4 block">
          <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
            {t('keywords')}
            <InfoTip text={t('keywordsHint')} />
          </span>
          <input className="field" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
        <div className="mt-3">
          <SeedSuggest
            request={() =>
              api<Seeds>(`${base}/seeds`, { method: 'POST', json: { keywords: list(), locale } })
            }
            onApply={(phrases) => setKeywords(phrases.join(', '))}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
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
            disabled={busy || list().length === 0}
            className="btn-primary w-auto px-5"
          >
            {t('saveAndRefresh')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
