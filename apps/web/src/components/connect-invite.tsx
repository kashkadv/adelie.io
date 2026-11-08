'use client';

import { CheckCircle2, Lock, PenLine, RefreshCw, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { AuthFrame } from './auth-frame';
import { PlatformIcon } from './ui/platform-icon';

type Invitation = {
  status: 'valid' | 'used' | 'revoked' | 'expired';
  platform: 'pinterest' | 'instagram' | 'etsy';
  /** Access the connection will ask for (ADR-0019). */
  access: 'read' | 'write';
  workspace: string;
  project: string;
  invitedBy: string | null;
  expiresAt: string;
};

const PLATFORM_NAMES: Record<string, string> = {
  pinterest: 'Pinterest',
  instagram: 'Instagram',
  etsy: 'Etsy',
};

/**
 * Public page of a connect invitation (ADR-0012): says plainly who asks for what access before
 * sending the visitor to the platform's consent screen. No Adelie account needed.
 */
export function ConnectInvite({ token }: { token: string }) {
  const t = useTranslations('Invite');
  const format = useFormatter();
  const [invitation, setInvitation] = useState<Invitation | null | 'missing'>(null);
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Invitation>(`/invitations/${encodeURIComponent(token)}`).then(
      (data) => !cancelled && setInvitation(data),
      () => !cancelled && setInvitation('missing'),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onContinue() {
    setStarting(true);
    setStartFailed(false);
    try {
      const { url } = await api<{ url: string }>(
        `/invitations/${encodeURIComponent(token)}/start`,
        { method: 'POST' },
      );
      window.location.assign(url);
    } catch {
      setStarting(false);
      setStartFailed(true);
    }
  }

  if (invitation === null) {
    return (
      <AuthFrame>
        <p className="py-6 text-center text-muted">…</p>
      </AuthFrame>
    );
  }

  if (invitation === 'missing' || invitation.status !== 'valid') {
    const reason: 'missing' | 'expired' | 'used' | 'revoked' =
      invitation === 'missing'
        ? 'missing'
        : (invitation.status as Exclude<Invitation['status'], 'valid'>);
    return (
      <AuthFrame>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <XCircle size={40} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
          <h1 className="text-xl font-semibold">{t('unavailableTitle')}</h1>
          <p className="text-muted">{t(`unavailable.${reason}`)}</p>
        </div>
      </AuthFrame>
    );
  }

  const platform = PLATFORM_NAMES[invitation.platform] ?? invitation.platform;
  return (
    <AuthFrame>
      <div className="flex flex-col gap-5">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <PlatformIcon
            platform={invitation.platform === 'instagram' ? 'INSTAGRAM' : 'PINTEREST'}
            size={22}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{t('title', { platform })}</h1>
          <p className="mt-2 text-muted">
            {invitation.invitedBy
              ? t('lead', { name: invitation.invitedBy, workspace: invitation.workspace })
              : t('leadNoName', { workspace: invitation.workspace })}
          </p>
        </div>

        <dl className="grid gap-2 rounded-2xl border border-line p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t('workspace')}</dt>
            <dd className="text-right font-medium">{invitation.workspace}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t('project')}</dt>
            <dd className="text-right font-medium">{invitation.project}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t('access')}</dt>
            <dd className="flex items-center gap-1.5 text-right font-medium">
              {invitation.access === 'write' ? (
                <PenLine size={14} aria-hidden="true" />
              ) : (
                <Lock size={14} aria-hidden="true" />
              )}
              {invitation.access === 'write' ? t('fullAccess') : t('readOnly')}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">{t('validUntil')}</dt>
            <dd className="text-right font-medium">
              {format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' })}
            </dd>
          </div>
        </dl>

        <p className="text-sm text-muted">
          {t(
            `explain.${invitation.platform === 'etsy' && invitation.access === 'write' ? 'etsyWrite' : invitation.platform}`,
            { platform },
          )}
        </p>

        {startFailed && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t('startFailed')}
          </p>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={starting}
          className="btn-primary flex items-center justify-center gap-2"
        >
          {starting && <RefreshCw size={16} className="animate-spin" aria-hidden="true" />}
          {t('continue', { platform })}
        </button>
      </div>
    </AuthFrame>
  );
}

const subscribe = () => () => undefined;

/** Result page after the platform redirects back from an invitation (no Adelie session). */
export function ConnectInviteResult() {
  const t = useTranslations('Invite');
  // Read once from the URL; the server renders nothing for it (null snapshot).
  const result = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get('connect'),
    () => null,
  );
  if (result === null) {
    return (
      <AuthFrame>
        <p className="py-6 text-center text-muted">…</p>
      </AuthFrame>
    );
  }
  const ok = result === 'connected';
  const RESULTS = ['connected', 'denied', 'expired', 'alreadyConnected', 'error'] as const;
  type Result = (typeof RESULTS)[number];
  const key: Result = (RESULTS as readonly string[]).includes(result)
    ? (result as Result)
    : 'error';
  return (
    <AuthFrame>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        {ok ? (
          <CheckCircle2 size={40} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <XCircle size={40} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
        )}
        <h1 className="text-xl font-semibold">{t(`result.${key}.title`)}</h1>
        <p className="text-muted">{t(`result.${key}.text`)}</p>
      </div>
    </AuthFrame>
  );
}
