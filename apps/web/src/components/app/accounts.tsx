'use client';

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Link2,
  MoreHorizontal,
  Pin,
  Plug,
  Plus,
  RefreshCw,
  Unplug,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';
import { Switch } from '../ui/switch';
import { useStoredFlag } from '@/lib/use-stored-flag';
import { useProjectAccounts, useProjectInvitations, type SocialAccount } from './accounts-data';
import { EmptyState, PageHeader } from './page-header';

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

type RowAction = 'disconnect' | 'remove' | 'reconnect';

const accountName = (a: SocialAccount) => a.displayName || a.username || a.externalId;
/** What the user types to confirm deletion (the API checks the same value). */
const accountHandle = (a: SocialAccount) => a.username ?? a.displayName ?? a.externalId;

/** "⋯" menu of an account row: disconnect / reconnect / delete with data. */
function RowMenu({
  disconnected,
  onAction,
}: {
  disconnected: boolean;
  onAction: (action: RowAction) => void;
}) {
  const t = useTranslations('Accounts');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (action: RowAction, label: string, danger = false) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        onAction(action);
      }}
      className={`flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-hover ${
        danger ? 'text-red-600 dark:text-red-400' : ''
      }`}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('actions')}
        className="icon-btn h-8 w-8"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="glass glass-strong animate-rise absolute top-full right-0 z-50 mt-2 w-60 rounded-2xl p-2"
        >
          {disconnected ? item('reconnect', t('reconnect')) : item('disconnect', t('disconnect'))}
          <div className="my-1 h-px bg-line" />
          {item('remove', t('remove'), true)}
        </div>
      )}
    </div>
  );
}

/** One connected account as a full-width row: who · last sync · status · actions. */
function AccountRow({
  account,
  onAction,
}: {
  account: SocialAccount;
  /** Absent for roles that may not manage accounts. */
  onAction?: (action: RowAction) => void;
}) {
  const t = useTranslations('Accounts');
  const format = useFormatter();
  const needsReauth = account.status === 'REAUTHORIZATION_REQUIRED';
  const disconnected = account.status === 'REVOKED';
  const last = account.lastSync;
  const syncing =
    account.status === 'ACTIVE' &&
    (last?.status === 'RUNNING' ||
      last?.status === 'PENDING' ||
      (!last && account.status === 'ACTIVE'));
  // Pinterest gives apps no pin/board data of personal (PINNER) accounts — only business ones.
  const syncNote: 'personal' | 'partial' | 'failed' | null = disconnected
    ? null
    : last?.status === 'PARTIAL'
      ? account.accountType === 'PINNER'
        ? 'personal'
        : 'partial'
      : last?.status === 'FAILED'
        ? 'failed'
        : null;
  const name = account.displayName || account.username || account.externalId;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:flex-nowrap">
        {/* Who */}
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          {account.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.avatarUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Pin size={18} strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="truncate text-sm text-muted">
              {t(`platforms.${account.platform}`)}
              {account.username ? ` · @${account.username}` : ''}
            </p>
          </div>
        </div>

        {/* Sync: icon + date (the icon spins while syncing); the label is for screen readers. */}
        <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted md:w-56">
          <RefreshCw
            size={13}
            strokeWidth={1.75}
            className={syncing ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          {syncing ? (
            t('syncing')
          ) : account.lastSuccessfulSyncAt ? (
            <>
              <span className="sr-only">{t('lastSyncLabel')}</span>
              {format.dateTime(new Date(account.lastSuccessfulSyncAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </>
          ) : (
            t('notSyncedYet')
          )}
          <InfoTip text={t('collectingHint')} />
        </p>

        {/* Status (+ a warning icon with an explanation, instead of a banner). Fixed width, so the
            columns of all rows line up whether or not a row has a warning. */}
        <div className="flex shrink-0 items-center justify-end gap-2 md:w-60">
          {syncNote && (
            <InfoTip
              tone="warning"
              title={t(`sync.${syncNote}`)}
              text={t(`sync.${syncNote}Hint`)}
            />
          )}
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              needsReauth
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : 'bg-hover text-muted'
            }`}
          >
            {needsReauth ? (
              <AlertTriangle size={14} aria-hidden="true" />
            ) : disconnected ? (
              <Unplug size={14} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={14} aria-hidden="true" />
            )}
            {t(`status.${account.status}`)}
          </span>
          {onAction ? (
            <RowMenu disconnected={disconnected} onAction={onAction} />
          ) : (
            <span className="w-8" aria-hidden="true" />
          )}
        </div>
      </div>
    </li>
  );
}

/** "+ Connect account" button with a glass menu of platforms (top-right of the Accounts page). */
function ConnectMenu({
  canConnect,
  connecting,
  onConnect,
  onInvite,
}: {
  canConnect: boolean;
  connecting: boolean;
  onConnect: () => void;
  /** Creates a connect invitation for Pinterest and copies its link (ADR-0012). */
  onInvite: () => void;
}) {
  const t = useTranslations('Accounts');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={!canConnect || connecting}
        title={canConnect ? undefined : t('noPermission')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn-primary flex w-auto items-center gap-2 px-4"
      >
        {connecting ? (
          <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <Plus size={16} aria-hidden="true" />
        )}
        {t('connectTitle')}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="glass glass-strong animate-rise absolute top-full right-0 z-50 mt-2 w-72 rounded-2xl p-2"
        >
          <p className="flex items-center gap-1.5 px-3 pt-1 pb-2 text-xs tracking-wide text-muted uppercase">
            {t('platformsTitle')}
            <InfoTip text={t('anotherAccountHint')} />
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onConnect();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-hover"
          >
            <Pin size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="flex-1">{t('platforms.PINTEREST')}</span>
            <ArrowRight size={14} className="text-muted" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onInvite();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-muted hover:bg-hover hover:text-foreground"
          >
            <Link2 size={16} strokeWidth={1.75} className="ml-px" aria-hidden="true" />
            <span className="flex-1">{t('copyInvite')}</span>
          </button>
          <div className="my-1 h-px bg-line" />
          {(['INSTAGRAM', 'TIKTOK'] as const).map((p) => (
            <div
              key={p}
              role="menuitem"
              aria-disabled="true"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted"
            >
              <span className="w-[18px]" aria-hidden="true" />
              <span className="flex-1">{t(`platforms.${p}`)}</span>
              <span className="rounded-full border border-line px-2 text-xs">{t('soon')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Accounts page: connected accounts of the project and connecting new ones (ADR-0011). */
export function Accounts() {
  const t = useTranslations('Accounts');
  const { accounts, connect, canConnect, disconnect, remove } = useProjectAccounts();
  const [platform, setPlatform] = useState('');
  const [showDisconnected, setShowDisconnected] = useStoredFlag(
    'adelie-accounts-show-disconnected',
    true,
  );
  const platforms = [...new Set((accounts ?? []).map((a) => a.platform))];
  const visible = (accounts ?? []).filter(
    (a) => (!platform || a.platform === platform) && (showDisconnected || a.status !== 'REVOKED'),
  );
  const [dialog, setDialog] = useState<{
    action: 'disconnect' | 'remove';
    account: SocialAccount;
  } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();

  function onRowAction(account: SocialAccount, action: RowAction) {
    if (action === 'reconnect') return void onConnect();
    setDialogError(undefined);
    setDialog({ action, account });
  }

  async function confirmDialog(typed: string) {
    if (!dialog) return;
    setDialogBusy(true);
    setDialogError(undefined);
    try {
      if (dialog.action === 'disconnect') await disconnect(dialog.account.id);
      else await remove(dialog.account.id, typed);
      setDialog(null);
    } catch {
      setDialogError(t('actionFailed'));
    } finally {
      setDialogBusy(false);
    }
  }
  const { invitations, create: createInvitation, revoke } = useProjectInvitations();
  const [notice, setNotice] = useState<'inviteCopied' | 'inviteFailed' | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const format = useFormatter();

  async function onInvite() {
    try {
      const url = await createInvitation('pinterest');
      await navigator.clipboard.writeText(url);
      setNotice('inviteCopied');
    } catch {
      setNotice('inviteFailed');
    }
  }

  async function copyAgain(id: string, url: string) {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
  }
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
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <ConnectMenu
            canConnect={canConnect}
            connecting={connecting}
            onConnect={onConnect}
            onInvite={onInvite}
          />
        }
      />

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

      {notice && (
        <div
          role="status"
          className={`animate-rise mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
            notice === 'inviteCopied'
              ? 'border-line bg-hover'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          }`}
        >
          {notice === 'inviteCopied' ? (
            <Link2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <p className="flex-1">{t(notice)}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t('dismiss')}
            className="icon-btn -my-1.5 h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {accounts && accounts.length === 0 && (
        <EmptyState
          icon={<Plug size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('emptyTitle')}
          text={t(canConnect ? 'emptyText' : 'noPermission')}
        />
      )}

      {accounts && accounts.length > 0 && (
        <div className="animate-rise mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="w-52">
            <Select
              value={platform}
              onChange={setPlatform}
              options={[
                { value: '', label: t('allPlatforms') },
                ...platforms.map((p) => ({ value: p, label: t(`platforms.${p}`) })),
              ]}
              ariaLabel={t('platform')}
            />
          </div>
          <Switch
            checked={showDisconnected}
            onChange={setShowDisconnected}
            label={t('showDisconnected')}
          />
        </div>
      )}

      {accounts && accounts.length > 0 && visible.length === 0 && (
        <p className="card rounded-[24px] px-5 py-8 text-center text-sm text-muted">
          {t('noMatches')}
        </p>
      )}

      {visible.length > 0 && (
        <ul className="card animate-rise divide-y divide-line rounded-[24px]">
          {visible.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onAction={canConnect ? (action) => onRowAction(account, action) : undefined}
            />
          ))}
        </ul>
      )}

      {invitations.length > 0 && (
        <section className="animate-rise mt-8">
          <h2 className="mb-3 flex items-center gap-2 px-3.5 text-lg font-semibold">
            {t('invitationsTitle')}
            <InfoTip text={t('invitationsHint')} />
          </h2>
          <ul className="card divide-y divide-line rounded-[24px]">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Link2
                  size={18}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {inv.createdBy
                      ? t('invitationBy', {
                          platform: t(`platforms.${inv.platform}`),
                          name: inv.createdBy,
                        })
                      : t('invitationNoName', { platform: t(`platforms.${inv.platform}`) })}
                  </p>
                  <p className="text-xs text-muted">
                    {t('invitationExpires', {
                      date: format.dateTime(new Date(inv.expiresAt), { dateStyle: 'medium' }),
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyAgain(inv.id, inv.url)}
                  className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-hover"
                >
                  {copiedId === inv.id ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                  {copiedId === inv.id ? t('copied') : t('copy')}
                </button>
                <button
                  type="button"
                  onClick={() => revoke(inv.id)}
                  className="rounded-xl px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-foreground"
                >
                  {t('revoke')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {dialog && (
        <ConfirmDialog
          title={t(`${dialog.action}Dialog.title`, { name: accountName(dialog.account) })}
          confirmLabel={t(`${dialog.action}Dialog.confirm`)}
          cancelLabel={t('cancel')}
          danger={dialog.action === 'remove'}
          confirmText={dialog.action === 'remove' ? accountHandle(dialog.account) : undefined}
          inputLabel={t('removeDialog.typeToConfirm', { handle: accountHandle(dialog.account) })}
          busy={dialogBusy}
          error={dialogError}
          onConfirm={confirmDialog}
          onCancel={() => setDialog(null)}
        >
          <p>{t(`${dialog.action}Dialog.text`)}</p>
          {dialog.action === 'disconnect' && <p>{t('disconnectDialog.platformHint')}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
