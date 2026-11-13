'use client';

import { ChevronDown, Sparkles } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import type { Advice } from './research-ai';
import type { Competition, TagAudit, TagVerdict } from './research-data';
import { VERDICT_STYLE } from './research-tags';
import { useWorkspace } from './workspace-context';

/** What the research says about one product (ADR-0035): its tags audited, the AI's last advice. */
export interface TagDetail {
  competition: Competition;
  count: number;
  avgFavorers: number;
  pinterestMom: number | null;
  priceVsOwn: 'below' | 'near' | 'above' | null;
}
export interface ProductResearch {
  researches: { id: string; name: string; refreshedAt: string | null }[];
  research: {
    id: string;
    name: string;
    refreshedAt: string | null;
    version: { id: string; createdAt: string } | null;
  } | null;
  audit?: TagAudit | null;
  details?: Record<string, TagDetail>;
  advice?: Advice | null;
}

/** The research's words about a product; null while loading, `{research: null}` when it has none. */
export function useProductResearch(productId: string, enabled = true) {
  const { workspace, project } = useWorkspace();
  const base =
    workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}/research` : null;
  const [chosen, setChosen] = useState<string | undefined>();
  const [state, setState] = useState<{ key: string; data: ProductResearch } | null>(null);
  const key = `${base}|${productId}|${chosen ?? ''}`;
  useEffect(() => {
    if (!base || !enabled) return;
    let cancelled = false;
    api<ProductResearch>(
      `${base}/for-product/${productId}${chosen ? `?researchId=${chosen}` : ''}`,
    ).then(
      (data) => !cancelled && setState({ key, data }),
      () => !cancelled && setState({ key, data: { researches: [], research: null } }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, productId, chosen, enabled, key]);
  const data = state?.key === key ? state.data : null;
  return {
    base,
    data,
    choose: setChosen,
    update: (patch: Partial<ProductResearch>) =>
      setState((s) => (s ? { ...s, data: { ...s.data, ...patch } } : s)),
  };
}

/** The tooltip of a tag: its score and the figures behind it. */
export function useTagTitle() {
  const t = useTranslations('Sales.research');
  const tt = useTranslations('Research.tags');
  const format = useFormatter();
  return (tag: string, score: number | null, detail?: TagDetail) => {
    if (score === null) return tt('audit.unknownHint');
    const parts = [`${tt('colScore')}: ${score}`];
    if (detail) {
      parts.push(
        `${t('competition')}: ${tt(`competition.${detail.competition}`)} (${format.number(detail.count)})`,
        `${tt('colFavorers')}: ${format.number(detail.avgFavorers, { maximumFractionDigits: 0 })}`,
      );
    }
    return `${tag}: ${parts.join(' · ')}`;
  };
}

/** A tag as the audit sees it: filled when strong, amber when weak, struck out when it does not fit. */
export function VerdictChip({
  tag,
  verdict,
  score,
  detail,
  onClick,
  children,
}: {
  tag: string;
  verdict: TagVerdict;
  score: number | null;
  detail?: TagDetail;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const title = useTagTitle();
  const className = `flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${VERDICT_STYLE[verdict]}`;
  const body = (
    <>
      {tag}
      {score !== null && <span className="opacity-70">{score}</span>}
      {children}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title={title(tag, score, detail)}
      className={`${className} hover:opacity-80`}
    >
      {body}
    </button>
  ) : (
    <span title={title(tag, score, detail)} className={className}>
      {body}
    </span>
  );
}

/** The counts of the audit as one line: "strong: 5 · weak: 3 · better ones: 4". */
export function AuditSummary({ audit }: { audit: TagAudit }) {
  const t = useTranslations('Research.tags');
  const parts = (['strong', 'ok', 'weak', 'off', 'unknown'] as const)
    .filter((v) => audit.counts[v] > 0)
    .map((v) => t(`audit.${v}`, { count: audit.counts[v] }));
  return (
    <>
      {parts.length ? parts.join(' · ') : t('audit.none')}
      {audit.replacements.length > 0 &&
        ` · ${t('audit.better', { count: audit.replacements.length })}`}
    </>
  );
}

/** Where the numbers come from: the research and the date of its data, with a way to the page. */
export function ResearchSource({ data }: { data: ProductResearch }) {
  const t = useTranslations('Sales.research');
  const format = useFormatter();
  if (!data.research) return null;
  const date = data.research.version?.createdAt ?? data.research.refreshedAt;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
      <span>
        {t('from', { name: data.research.name })}
        {date && ` · ${format.dateTime(new Date(date), { dateStyle: 'medium' })}`}
      </span>
      <Link href={`/research?id=${data.research.id}`} className="underline hover:text-foreground">
        {t('open')}
      </Link>
    </p>
  );
}

/**
 * In the product card, under the tags: the audit's counts, the better tags the product lacks, and
 * the AI's last advice (or a button to ask for it). A title and tags open in the editor.
 */
export function ProductResearchPanel({
  productId,
  research,
  onEdit,
}: {
  productId: string;
  research: ReturnType<typeof useProductResearch>;
  /** Opens the editor; its research panel offers the advice (nothing is filled in by itself). */
  onEdit?: () => void;
}) {
  const t = useTranslations('Sales.research');
  const ta = useTranslations('Research.ai');
  const locale = useLocale();
  const { data, base, update } = research;
  const [open, setOpen] = useState(false);
  /** The whole block starts folded. */
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const { audit, advice } = data;
  const researchId = data.research?.id;

  if (!data.research) {
    return (
      <p className="mb-6 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {t('noResearch')}
        <Link href="/research" className="underline hover:text-foreground">
          {t('openResearches')}
        </Link>
      </p>
    );
  }

  async function ask() {
    if (!base || !researchId) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api<Advice>(`${base}/${researchId}/advice`, {
        method: 'POST',
        json: { productId, locale },
      });
      update({ advice: a });
      setOpen(true);
    } catch (err) {
      const code =
        err instanceof ApiError
          ? (err.body as { errors?: Record<string, string> } | null)?.errors?.['ai']
          : undefined;
      setError(code === 'limit' ? 'limit' : code === 'off' ? 'off' : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card animate-rise mb-6 grid gap-4 rounded-[24px] p-5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-expanded={shown}
          className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
        >
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform ${shown ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
          <Sparkles size={14} aria-hidden="true" />
          {t('editor.title')}
        </button>
        <InfoTip text={t('editor.hint')} />
        {!shown && audit && (
          <span className="text-muted">
            <AuditSummary audit={audit} />
          </span>
        )}
      </div>
      {shown && (
        <>
          {audit ? (
            <>
              <p className="text-muted">
                <AuditSummary audit={audit} />
              </p>
              {audit.replacements.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted">{t('betterTags')}:</span>
                  {audit.replacements.map((r) => (
                    <VerdictChip
                      key={r.tag}
                      tag={r.tag}
                      score={r.score}
                      verdict={r.score >= 55 ? 'strong' : 'ok'}
                      detail={data.details?.[r.tag]}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-muted">{t('noData')}</p>
          )}

          <div>
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
              <Sparkles size={12} aria-hidden="true" />
              {t('advice')}
              {!advice && ` · ${t('notAsked')}`}
            </button>
            {open && (
              <div className="mt-2 grid gap-3">
                {advice ? (
                  <>
                    <div>
                      <p className="mb-1 text-muted">{ta('titles')}</p>
                      <ul className="grid gap-1">
                        {advice.titles.map((x, i) => (
                          <li key={i}>
                            {x.title}
                            <span className="ml-1.5 text-muted">{x.title.length}/140</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {advice.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {advice.tags.map((tag) => (
                          <span key={tag} className="rounded-full border border-line px-2 py-0.5">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {advice.opening && <p className="text-muted">{advice.opening}</p>}
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => onEdit()}
                        className="w-fit rounded-full border border-line px-3 py-1 hover:text-foreground"
                      >
                        {t('openInEditor')}
                      </button>
                    )}
                  </>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void ask()}
                    className="rounded-full border border-line px-3 py-1 hover:text-foreground disabled:opacity-60"
                  >
                    {busy ? t('asking') : advice ? t('askAgain') : t('ask')}
                  </button>
                  <InfoTip text={t('askHint')} />
                  {error && (
                    <span className="text-rose-600 dark:text-rose-400">
                      {t(`error.${error}` as 'error.failed')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <ResearchSource data={data} />
        </>
      )}
    </section>
  );
}

/** The audit of tags as they are being edited (they are not saved yet): rechecked after a pause. */
export function useLiveAudit(
  base: string | null,
  researchId: string | undefined,
  productId: string,
  tags: string[],
  /** False until the editor has loaded the product (its tags are not known yet). */
  enabled = true,
) {
  const [state, setState] = useState<{
    audit: TagAudit;
    details: Record<string, TagDetail>;
    key: string;
  } | null>(null);
  const key = tags.join('\u0001');
  const check = useCallback(
    (signal: { cancelled: boolean }) => {
      if (!base || !researchId || !enabled) return;
      api<{ audit: TagAudit | null; details: Record<string, TagDetail> }>(
        `${base}/for-product/${productId}/check`,
        { method: 'POST', json: { researchId, tags } },
      ).then(
        (r) => {
          if (!signal.cancelled && r.audit) setState({ audit: r.audit, details: r.details, key });
        },
        () => undefined,
      );
    },
    // `tags` is covered by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, researchId, productId, key, enabled],
  );
  useEffect(() => {
    const signal = { cancelled: false };
    const timer = setTimeout(() => check(signal), 350);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
  }, [check]);
  return state;
}

const MAX_TAGS = 13;
const ranks = (v: TagVerdict) => (v === 'off' ? 0 : v === 'weak' ? 1 : -1);

/** Adds a tag; with 13 already, it takes the place of the weakest one (or nothing changes). */
export function withTag(tags: string[], audit: TagAudit | null, tag: string): string[] {
  if (tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return tags;
  if (tags.length < MAX_TAGS) return [...tags, tag];
  let victim = -1;
  let worst: [number, number] = [-1, 0];
  tags.forEach((x, i) => {
    const a = audit?.tags.find((y) => y.tag === x);
    if (!a || ranks(a.verdict) < 0) return;
    const key: [number, number] = [-ranks(a.verdict), -(a.score ?? 0)];
    if (victim < 0 || key[0] > worst[0] || (key[0] === worst[0] && key[1] > worst[1])) {
      victim = i;
      worst = key;
    }
  });
  return victim < 0 ? tags : tags.map((x, i) => (i === victim ? tag : x));
}

/** Every weak or unfitting tag is swapped for the next better one the product lacks. */
export function replaceWeak(tags: string[], audit: TagAudit | null): string[] {
  if (!audit) return tags;
  const spare = audit.replacements.map((r) => r.tag);
  const out = [...tags];
  for (let i = 0; i < out.length; i++) {
    const a = audit.tags.find((y) => y.tag === out[i]);
    if (!a || ranks(a.verdict) < 0) continue;
    const next = spare.find((s) => !out.some((x) => x.toLowerCase() === s.toLowerCase()));
    if (!next) break;
    out[i] = next;
  }
  return out;
}

/**
 * In the editor, under the tags: the audit of the tags as they are now, the better tags to take
 * (click), the AI's title variants and description opening — each only fills a field; the usual
 * "was → will be" review still stands between it and Etsy (ADR-0035).
 */
export function EditorResearchPanel({
  data,
  audit,
  details,
  tags,
  onTags,
  onTitle,
  title,
  onOpening,
}: {
  data: ProductResearch;
  audit: TagAudit | null;
  details: Record<string, TagDetail>;
  tags: string[];
  onTags: (tags: string[]) => void;
  title: string;
  onTitle: (title: string) => void;
  /** Puts the opening at the start of the description. */
  onOpening: (opening: string) => void;
}) {
  const t = useTranslations('Sales.research');
  const ta = useTranslations('Research.ai');
  if (!data.research) return null;
  const advice = data.advice;
  const weak = audit ? audit.counts.weak + audit.counts.off : 0;
  // The AI's tags the product does not have yet: the ones taken drop out, the rest stay.
  const aiTags = (advice?.tags ?? []).filter(
    (a) => !tags.some((x) => x.toLowerCase() === a.toLowerCase()),
  );
  const swapped = replaceWeak(tags, audit);
  const canReplace = swapped.some((x, i) => x !== tags[i]);
  return (
    <div className="mt-3 grid gap-4 rounded-2xl border border-line p-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Sparkles size={13} aria-hidden="true" />
          {t('editor.title')}
          <InfoTip text={t('editor.hint')} />
        </p>
        {audit && weak > 0 && (
          <button
            type="button"
            disabled={!canReplace}
            onClick={() => onTags(swapped)}
            title={t('editor.replaceWeakHint')}
            className="rounded-full border border-line px-3 py-1 hover:text-foreground disabled:opacity-50"
          >
            {t('editor.replaceWeak', { count: weak })}
          </button>
        )}
      </div>

      {audit ? (
        <p className="text-muted">
          <AuditSummary audit={audit} />
        </p>
      ) : (
        <p className="text-muted">{t('noData')}</p>
      )}

      {audit && audit.replacements.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-muted">{t('editor.addTag')}</span>
          <div className="flex flex-wrap gap-1">
            {audit.replacements.map((r) => (
              <VerdictChip
                key={r.tag}
                tag={r.tag}
                score={r.score}
                verdict={r.score >= 55 ? 'strong' : 'ok'}
                detail={details[r.tag]}
                onClick={() => onTags(withTag(tags, audit, r.tag))}
              />
            ))}
          </div>
        </div>
      )}

      {aiTags.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-muted">{t('editor.aiTags')}</span>
          <div className="flex flex-wrap gap-1">
            {aiTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onTags(withTag(tags, audit, tag))}
                className="rounded-full border border-line px-2 py-0.5 hover:bg-hover"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {advice && advice.titles.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-muted">{ta('titles')}</span>
          <ul className="grid gap-1">
            {advice.titles.map((x, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onTitle(x.title)}
                  title={x.why}
                  className={`w-full rounded-xl border px-2.5 py-1.5 text-left hover:bg-hover ${
                    x.title === title ? 'border-accent' : 'border-line'
                  }`}
                >
                  {x.title}
                  <span className="ml-1.5 text-muted">{x.title.length}/140</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {advice?.opening && (
        <div className="grid gap-1.5">
          <span className="text-muted">{t('editor.opening')}</span>
          <p className="rounded-xl bg-hover px-2.5 py-1.5">{advice.opening}</p>
          <button
            type="button"
            onClick={() => onOpening(advice.opening)}
            className="w-fit rounded-full border border-line px-3 py-1 hover:text-foreground"
          >
            {t('editor.insertOpening')}
          </button>
        </div>
      )}
      <ResearchSource data={data} />
    </div>
  );
}
