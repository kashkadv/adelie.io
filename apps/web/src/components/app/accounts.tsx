'use client';

import { AlertTriangle, CheckCircle2, Pin, Plus, RefreshCw, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { InfoTip } from '../ui/info-tip';
import { useProjectAccounts, type SocialAccount } from './accounts-data';
import { PageHeader } from './page-header';

type ConnectResult = 'connected' | 'denied' | 'expired' | 'alreadyConnected' | 'error';
const RESULTS: ConnectResult[] = ['connected', 'denied', 'expired', 'alreadyConnected', 'error'];

/** Reads ?connect=… left by the OAuth callback once, then cleans the URL. */
function useConnectResult(): [ConnectResult | null, () => void] {
  const [result, setResult] = useState<ConnectResult | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('connect') as ConnectResult | null;
    if (value && RESULTS.includes(value)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off read of the redirect result
      setResult(value);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  return [result, () => setResult(null)];
}

function AccountCard({ account }: { account: SocialAccount }) {
  const t = useTranslations('Accounts');
  const format = useFormatter();
  const needsReauth = account.status !== 'ACTIVE';
  const last = account.lastSync;
  const syncing =
    !needsReauth &&
    (last?.status === 'RUNNING' ||
      last?.status === 'PENDING' ||
      (!last && account.status === 'ACTIVE'));
  // Pinterest gives apps no pin/board data of personal (PINNER) accounts — only business ones.
  const syncNote: 'personal' | 'partial' | 'failed' | null =
    last?.status === 'PARTIAL'
      ? account.accountType === 'PINNER'
        ? 'personal'
        : 'partial'
      : last?.status === 'FAILED'
        ? 'failed'
        : null;
  const name = account.displayName || account.username || account.externalId;

  return (
    <article className="card animate-rise flex flex-col gap-4 rounded-[24px] p-5">
      <div className="flex items-center gap-3">
        {account.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Pin size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-sm text-muted">
            {t(`platforms.${account.platform}`)}
            {account.username ? ` · @${account.username}` : ''}
          </p>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
            needsReauth
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
              : 'bg-hover text-muted'
          }`}
        >
          {needsReauth ? (
            <AlertTriangle size={14} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={14} aria-hidden="true" />
          )}
          {t(`status.${account.status}`)}
        </span>
      </div>
      <dl className="tabular grid grid-cols-2 gap-3 text-sm">
        <div className="px-1">
          <dt className="text-muted">{t('followers')}</dt>
          <dd className="font-display text-xl font-semibold">
            {account.followersCount === null ? '—' : format.number(account.followersCount)}
          </dd>
        </div>
        <div className="px-1">
          <dt className="text-muted">{t('pins')}</dt>
          <dd className="font-display text-xl font-semibold">
            {account.postsCount === null ? '—' : format.number(account.postsCount)}
          </dd>
        </div>
      </dl>
      {syncNote && (
        <p className="flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">{t(`sync.${syncNote}`)}</span>
          {syncNote === 'personal' && <InfoTip text={t('sync.personalHint')} />}
        </p>
      )}
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
        {syncing ? (
          <>
            <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
            {t('syncing')}
          </>
        ) : account.lastSuccessfulSyncAt ? (
          t('lastSync', {
            date: format.dateTime(new Date(account.lastSuccessfulSyncAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })
        ) : (
          t('notSyncedYet')
        )}
        <InfoTip text={t('collectingHint')} />
      </p>
    </article>
  );
}

/** Accounts page: connected accounts of the project and connecting new ones (ADR-0011). */
export function Accounts() {
  const t = useTranslations('Accounts');
  const { accounts, connect, canConnect } = useProjectAccounts();
  const [result, dismiss] = useConnectResult();
  const [connecting, setConnecting] = useState(false);
  const [startError, setStartError] = useState(false);

  async function onConnect() {
    setConnecting(true);
    setStartError(false);
    try {
      await connect('pinterest');
    } catch {
      setStartError(true);
      setConnecting(false);
    }
  }

  const ok = result === 'connected';
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {(result || startError) && (
        <div
          role="status"
          className={`animate-rise mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
            ok
              ? 'border-line bg-hover'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          }`}
        >
          {ok ? (
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <p className="flex-1">{t(`result.${startError ? 'error' : result!}`)}</p>
          <button
            type="button"
            onClick={() => {
              dismiss();
              setStartError(false);
            }}
            aria-label={t('dismiss')}
            className="icon-btn -my-1.5 h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts?.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}

        {/* Connect */}
        <section className="card animate-rise flex flex-col gap-3 rounded-[24px] p-5">
          <h2 className="flex items-center gap-2 px-1 text-lg font-semibold">
            {t('connectTitle')}
            <InfoTip text={t('anotherAccountHint')} />
          </h2>
          <button
            type="button"
            disabled={!canConnect || connecting}
            onClick={onConnect}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-left transition-colors duration-200 hover:bg-hover disabled:opacity-50"
          >
            <span className="flex items-center gap-3">
              <Pin size={20} strokeWidth={1.75} aria-hidden="true" />
              {t('platforms.PINTEREST')}
            </span>
            {connecting ? (
              <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={16} aria-hidden="true" />
            )}
          </button>
          {(['INSTAGRAM', 'TIKTOK'] as const).map((p) => (
            <div
              key={p}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-muted"
            >
              <span>{t(`platforms.${p}`)}</span>
              <span className="rounded-full border border-line px-2 text-xs">{t('soon')}</span>
            </div>
          ))}
          {!canConnect && <p className="px-1 text-xs text-muted">{t('noPermission')}</p>}
        </section>
      </div>
    </>
  );
}
