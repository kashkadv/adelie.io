'use client';

import { Globe, Pencil, Plus, Search, Telescope, X } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { DayField } from '../ui/day-picker';
import { InfoTip } from '../ui/info-tip';
import { PlatformIcon } from '../ui/platform-icon';
import { Select } from '../ui/select';
import { CONNECT_ROLES } from './accounts-data';
import { EmptyState, PageHeader } from './page-header';
import { ResearchDetail } from './research-detail';
import type { Market, ResearchSummary, SalesAccount, Seeds } from './research-data';
import { SeedSuggest } from './seed-suggest';
import { useWorkspace } from './workspace-context';

/**
 * Niche research (ADR-0032): the project's researches — a niche, where it sells, the channel that
 * promotes it — and the project's markets. `?id=` opens one.
 */
export function ResearchPage() {
  const t = useTranslations('Research');
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('id');
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const base =
    workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}/research` : null;

  const [data, setData] = useState<{
    researches: ResearchSummary[];
    salesAccounts: SalesAccount[];
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!base || openId) return;
    let cancelled = false;
    api<{ researches: ResearchSummary[]; salesAccounts: SalesAccount[] }>(base).then(
      (r) => !cancelled && setData(r),
      () => !cancelled && setData({ researches: [], salesAccounts: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, openId, version]);

  if (base && openId) {
    return (
      <ResearchDetail
        base={base}
        id={openId}
        canManage={canManage}
        onBack={() => router.push('/research')}
      />
    );
  }

  const accountOf = (id: string) => data?.salesAccounts.find((a) => a.id === id);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canManage && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn-primary flex w-auto items-center gap-2 px-4"
            >
              <Plus size={16} aria-hidden="true" />
              {t('new')}
            </button>
          )
        }
      />

      {base && <Markets base={base} canManage={canManage} />}

      {!data ? (
        <p className="py-10 text-center text-sm text-muted">…</p>
      ) : data.researches.length === 0 ? (
        <EmptyState
          icon={<Telescope size={22} strokeWidth={1.75} aria-hidden="true" />}
          title={t('emptyTitle')}
          text={t('emptyText')}
          action={
            canManage ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="btn-primary w-auto px-5"
              >
                {t('new')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="animate-rise grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.researches.map((r) => {
            const account = accountOf(r.salesAccountId);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => router.push(`/research?id=${r.id}`)}
                className="card rounded-[24px] p-5 text-left transition-colors hover:bg-hover"
              >
                <p className="font-semibold">{r.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {account && (
                    <span className="inline-flex items-center gap-1">
                      <PlatformIcon platform={account.platform} size={13} strokeWidth={1.75} />
                      {account.name}
                    </span>
                  )}
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <PlatformIcon platform="PINTEREST" size={13} strokeWidth={1.75} />
                    {t(`channels.${r.channel as 'pinterest'}`)}
                  </span>
                </p>
                <p className="mt-2 line-clamp-2 text-sm">{r.keywords.join(', ')}</p>
                <p className="mt-3 text-xs text-muted">
                  {t('productsCount', { count: r.products })}
                  {r.endsOn &&
                    ` · ${t('until', { date: format.dateTime(new Date(`${r.endsOn}T00:00:00Z`), { day: 'numeric', month: 'short', timeZone: 'UTC' }) })}`}
                  {' · '}
                  {r.refreshedAt
                    ? t('refreshedAt', {
                        date: format.dateTime(new Date(r.refreshedAt), {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        }),
                      })
                    : t('notRefreshed')}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {creating && base && data && (
        <NewResearch
          base={base}
          salesAccounts={data.salesAccounts}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setVersion((v) => v + 1);
            router.push(`/research?id=${id}`);
          }}
        />
      )}
    </>
  );
}

/** The project's markets (from orders unless edited) and delivery days, with an editor. */
function Markets({ base, canManage }: { base: string; canManage: boolean }) {
  const t = useTranslations('Research');
  const locale = useLocale();
  const [data, setData] = useState<{
    markets: Market[];
    suggested: boolean;
    deliveryDays: number | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ markets: Market[]; suggested: boolean; deliveryDays: number | null }>(
      `${base}/markets`,
    ).then(
      (r) => !cancelled && setData(r),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (!data) return null;
  const country = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  return (
    <section className="card animate-rise mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[24px] px-5 py-3.5 text-sm">
      <span className="flex items-center gap-1.5 font-medium">
        <Globe size={15} aria-hidden="true" />
        {t('markets')}
        <InfoTip text={data.suggested ? t('marketsSuggested') : t('marketsHint')} />
      </span>
      <span className="text-muted">
        {data.markets.map((m) => `${country(m.code)} ${m.share}%`).join(' · ')}
      </span>
      <span className="text-muted">
        {t('delivery')}:{' '}
        {data.deliveryDays ? t('days', { count: data.deliveryDays }) : t('deliveryNone')}
      </span>
      {canManage && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-foreground"
        >
          <Pencil size={13} aria-hidden="true" />
          {t('edit')}
        </button>
      )}
      {editing && (
        <MarketsDialog
          base={base}
          initial={data}
          country={country}
          onClose={() => setEditing(false)}
          onSaved={(r) => {
            setData(r);
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

function MarketsDialog({
  base,
  initial,
  country,
  onClose,
  onSaved,
}: {
  base: string;
  initial: { markets: Market[]; deliveryDays: number | null };
  country: (code: string) => string;
  onClose: () => void;
  onSaved: (r: { markets: Market[]; suggested: boolean; deliveryDays: number | null }) => void;
}) {
  const t = useTranslations('Research');
  const titleId = useId();
  const [markets, setMarkets] = useState(
    initial.markets.map((m) => ({ ...m, share: String(m.share) })),
  );
  const [days, setDays] = useState(initial.deliveryDays ? String(initial.deliveryDays) : '');
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ markets: Market[]; suggested: boolean; deliveryDays: number | null }>(
        `${base}/markets`,
        {
          method: 'PUT',
          json: {
            markets: markets.map((m) => ({ code: m.code, share: Number(m.share) || 0 })),
            deliveryDays: days ? Number(days) : null,
          },
        },
      );
      onSaved(r);
    } catch {
      setError(true);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={save}
        className="glass glass-strong animate-rise relative w-full max-w-md rounded-[28px] p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {t('marketsTitle')}
        </h2>
        <ul className="mt-4 grid gap-2">
          {markets.map((m, i) => (
            <li key={m.code} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm">
                {country(m.code)} <span className="text-muted">{m.code}</span>
              </span>
              <input
                inputMode="numeric"
                className="field tabular w-20"
                value={m.share}
                aria-label={t('share')}
                onChange={(e) =>
                  setMarkets(
                    markets.map((x, j) =>
                      j === i ? { ...x, share: e.target.value.replace(/\D/g, '').slice(0, 3) } : x,
                    ),
                  )
                }
              />
              <span className="text-sm text-muted">%</span>
              <button
                type="button"
                onClick={() => setMarkets(markets.filter((_, j) => j !== i))}
                aria-label={t('remove')}
                className="icon-btn h-8 w-8"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            className="field w-24 uppercase"
            maxLength={2}
            placeholder="DE"
            aria-label={t('countryCode')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
          />
          <button
            type="button"
            disabled={code.length !== 2 || markets.some((m) => m.code === code)}
            onClick={() => {
              setMarkets([...markets, { code, share: '5' }]);
              setCode('');
            }}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-line px-3.5 text-sm hover:bg-hover"
          >
            <Plus size={14} aria-hidden="true" />
            {t('addCountry')}
          </button>
        </div>
        <label className="mt-5 block">
          <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
            {t('deliveryDays')}
            <InfoTip text={t('deliveryHint')} />
          </span>
          <input
            inputMode="numeric"
            className="field tabular w-32"
            placeholder="14"
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 px-3.5 text-xs text-rose-600 dark:text-rose-400">
            {t('failed')}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover"
          >
            {t('cancel')}
          </button>
          <button type="submit" disabled={markets.length === 0} className="btn-primary w-auto px-5">
            {t('save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function NewResearch({
  base,
  salesAccounts,
  onClose,
  onCreated,
}: {
  base: string;
  salesAccounts: SalesAccount[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('Research');
  const locale = useLocale();
  const titleId = useId();
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [account, setAccount] = useState(
    salesAccounts.find((a) => a.platform === 'ETSY')?.id ?? salesAccounts[0]?.id ?? '',
  );
  const [endsOn, setEndsOn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(base, {
        method: 'POST',
        json: {
          name,
          keywords: keywords.split(/[,;\n]/).map((k) => k.trim()),
          salesAccountId: account,
          channel: 'pinterest',
          endsOn,
        },
      });
      onCreated(r.id);
    } catch (err) {
      const errors =
        err instanceof ApiError
          ? (err.body as { errors?: Record<string, string> } | null)?.errors
          : undefined;
      setError(errors ? (Object.keys(errors)[0] ?? 'failed') : 'failed');
      setBusy(false);
    }
  }

  const label = (text: string, hint?: string) => (
    <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
      {text}
      {hint && <InfoTip text={hint} />}
    </span>
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
        className="glass glass-strong animate-rise relative w-full max-w-lg rounded-[28px] p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {t('newTitle')}
            </h2>
            <p className="text-sm text-muted">{t('newLead')}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4">
          <label className="block">
            {label(t('name'))}
            <input
              autoFocus
              required
              maxLength={100}
              className="field"
              placeholder={t('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            {label(t('keywords'), t('keywordsHint'))}
            <input
              required
              className="field"
              placeholder="wool pillow, shaggy pillow cover"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              aria-invalid={error === 'keywords'}
            />
            {error === 'keywords' && (
              <p role="alert" className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">
                {t('errors.keywords')}
              </p>
            )}
          </label>
          <SeedSuggest
            disabled={!account || (!name.trim() && !keywords.trim())}
            request={() =>
              api<Seeds>(`${base}/seeds`, {
                method: 'POST',
                json: {
                  name,
                  keywords: keywords.split(/[,;\n]/).map((k) => k.trim()),
                  salesAccountId: account,
                  locale,
                },
              })
            }
            onApply={(phrases) => setKeywords(phrases.join(', '))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              {label(t('salesPoint'), t('salesPointHint'))}
              <Select
                ariaLabel={t('salesPoint')}
                value={account}
                onChange={setAccount}
                options={salesAccounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
            <div>
              {label(t('channel'))}
              <Select
                ariaLabel={t('channel')}
                value="pinterest"
                onChange={() => undefined}
                options={[{ value: 'pinterest', label: t('channels.pinterest') }]}
              />
            </div>
          </div>
          <div>
            {label(t('endsOn'), t('endsOnHint'))}
            <DayField
              ariaLabel={t('endsOn')}
              value={endsOn}
              onChange={setEndsOn}
              emptyLabel={t('noEnd')}
              clearLabel={t('clearEnd')}
              previousLabel={t('previousMonth')}
              nextLabel={t('nextMonth')}
            />
          </div>
          {error && error !== 'keywords' && (
            <p role="alert" className="px-3.5 text-xs text-rose-600 dark:text-rose-400">
              {t('failed')}
            </p>
          )}
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
            type="submit"
            disabled={busy || !name.trim() || !keywords.trim() || !account}
            className="btn-primary w-auto px-5"
          >
            {t('create')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
