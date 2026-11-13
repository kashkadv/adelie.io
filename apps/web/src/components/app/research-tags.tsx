'use client';

import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { InfoTip } from '../ui/info-tip';
import type { Competition, RatedTag, TagAudit, TagVerdict } from './research-data';

type SortKey =
  | 'tag'
  | 'count'
  | 'priceMedian'
  | 'avgFavorers'
  | 'competitors'
  | 'pinterestMom'
  | 'own'
  | 'score';

const COMPETITION_STYLE: Record<Competition, string> = {
  low: 'bg-hover',
  medium: 'bg-hover',
  high: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  very_high: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};
const VERDICT_STYLE: Record<TagVerdict, string> = {
  strong: 'border-accent bg-accent text-accent-foreground',
  ok: 'border-line',
  weak: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  off: 'border-rose-500/40 bg-rose-500/10 text-rose-700 line-through dark:text-rose-300',
  unknown: 'border-dashed border-line text-muted',
};

/**
 * Rated tags of a research (ADR-0034): each candidate tag's competition on Etsy, prices against
 * yours, demand (favourites), use by competitors, Pinterest growth and the score; sortable.
 */
export function RatedTags({
  tags,
  ownPrice,
  error,
}: {
  tags: RatedTag[];
  ownPrice: number | null;
  error: string | null;
}) {
  const t = useTranslations('Research.tags');
  const format = useFormatter();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'score', desc: true });
  const [all, setAll] = useState(false);

  const sorted = useMemo(() => {
    const v = (r: RatedTag) => (sort.key === 'tag' ? r.tag : (r[sort.key] ?? -Infinity));
    return [...tags].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [tags, sort]);

  const head = (key: SortKey, label: string, hint?: string, right = true) => (
    <th className={`px-2 pb-2 font-normal ${right ? 'text-right' : ''}`}>
      <span className={`inline-flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
        <button
          type="button"
          onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'tag' })}
          className="inline-flex items-center gap-0.5 hover:text-foreground"
        >
          {label}
          {sort.key === key &&
            (sort.desc ? (
              <ArrowDown size={11} aria-hidden="true" />
            ) : (
              <ArrowUp size={11} aria-hidden="true" />
            ))}
        </button>
        {hint && <InfoTip text={hint} />}
      </span>
    </th>
  );

  return (
    <section className="card animate-rise mb-4 rounded-[24px] p-5">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        {t('title', { count: tags.length })}
        <InfoTip text={t('hint')} />
      </h2>
      {error ? (
        <p className="py-4 text-center text-sm text-muted">{t('error', { error })}</p>
      ) : tags.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('empty')}</p>
      ) : (
        <>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  {head('tag', t('colTag'), undefined, false)}
                  {head('count', t('colCount'), t('colCountHint'))}
                  {head(
                    'priceMedian',
                    t('colPrice'),
                    ownPrice !== null
                      ? t('colPriceHint', { price: Math.round(ownPrice) })
                      : undefined,
                  )}
                  {head('avgFavorers', t('colFavorers'), t('colFavorersHint'))}
                  {head('competitors', t('colCompetitors'), t('colCompetitorsHint'))}
                  {head('pinterestMom', t('colPinterest'))}
                  {head('own', t('colOwn'))}
                  {head('score', t('colScore'), t('colScoreHint'))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.slice(0, all ? 80 : 25).map((r) => (
                  <tr key={r.tag}>
                    <td className="py-1.5 pr-2">{r.tag}</td>
                    <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                      {format.number(r.count)}
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${COMPETITION_STYLE[r.competition]}`}
                      >
                        {t(`competition.${r.competition}`)}
                      </span>
                    </td>
                    <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                      {r.priceMedian !== null ? `$${r.priceMedian}` : '—'}
                      {r.priceVsOwn && (
                        <span className="ml-1 text-xs text-muted">
                          {t(`price.${r.priceVsOwn}`)}
                        </span>
                      )}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {format.number(r.avgFavorers)}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{r.competitors || '—'}</td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {r.pinterestMom === null
                        ? '—'
                        : r.pinterestMom >= 10000
                          ? '∞'
                          : `${r.pinterestMom > 0 ? '+' : ''}${r.pinterestMom}%`}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{r.own || '—'}</td>
                    <td className="tabular py-1.5 pl-2 text-right">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-hover">
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{ width: `${r.score}%` }}
                          />
                        </span>
                        <span className="w-6 font-medium">{r.score}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tags.length > 25 && (
            <button
              type="button"
              onClick={() => setAll(!all)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <ChevronDown size={13} className={all ? 'rotate-180' : ''} aria-hidden="true" />
              {all ? t('less') : t('more', { count: tags.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** A product's own tags graded against the rated ones, with better tags it lacks. */
export function TagAuditLine({ audit }: { audit: TagAudit }) {
  const t = useTranslations('Research.tags');
  const [open, setOpen] = useState(false);
  if (!audit.tags.length && !audit.replacements.length) return null;
  const parts = (['strong', 'ok', 'weak', 'off', 'unknown'] as const)
    .filter((v) => audit.counts[v] > 0)
    .map((v) => t(`audit.${v}`, { count: audit.counts[v] }));
  return (
    <div className="mt-3 border-t border-line pt-3 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-left text-muted hover:text-foreground"
      >
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
        {t('auditTitle')}: {parts.length ? parts.join(' · ') : t('audit.none')}
        {audit.replacements.length > 0 &&
          ` · ${t('audit.better', { count: audit.replacements.length })}`}
      </button>
      {open && (
        <div className="mt-2.5 grid gap-3">
          <div className="flex flex-wrap gap-1">
            {audit.tags.map((x) => (
              <span
                key={x.tag}
                title={x.score !== null ? `${t('colScore')}: ${x.score}` : t('audit.unknownHint')}
                className={`rounded-full border px-2 py-0.5 ${VERDICT_STYLE[x.verdict]}`}
              >
                {x.tag}
                {x.score !== null && <span className="ml-1 opacity-70">{x.score}</span>}
              </span>
            ))}
          </div>
          {audit.replacements.length > 0 && (
            <p>
              <span className="text-muted">{t('audit.consider')}: </span>
              {audit.replacements.map((r) => `${r.tag} (${r.score})`).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
