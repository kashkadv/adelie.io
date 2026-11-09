'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { PlatformIcon } from '../ui/platform-icon';
import { useWorkspace } from './workspace-context';

type Reason = 'invalidUrl' | 'notAllowed' | 'unreachable' | 'notAFeed' | 'otherProject' | 'failed';

/**
 * Connecting a website by its product feed (ADR-0021): the address of a Google Merchant XML feed
 * and, if wanted, a name. The feed is read once on the server, so a wrong address is refused here.
 */
export function WebsiteDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (accountId: string) => void;
}) {
  const t = useTranslations('Accounts.websiteDialog');
  const { workspace, project } = useWorkspace();
  const titleId = useId();
  const [feedUrl, setFeedUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Reason | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspace || !project || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { accountId } = await api<{ accountId: string }>(
        `/workspaces/${workspace.id}/projects/${project.id}/connections/website`,
        { method: 'POST', json: { feedUrl, name } },
      );
      onConnected(accountId);
    } catch (err) {
      const reason =
        err instanceof ApiError ? (err.body as { reason?: Reason } | null)?.reason : undefined;
      setError(reason && reason !== 'failed' ? reason : 'failed');
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
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        className="glass glass-strong animate-rise relative w-full max-w-md rounded-[28px] p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <PlatformIcon platform="WEBSITE" size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {t('title')}
            </h2>
            <p className="text-sm text-muted">{t('lead')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('close')}
            className="icon-btn h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
              {t('feedUrl')}
              <InfoTip text={t('feedUrlHint')} />
            </span>
            <input
              autoFocus
              type="url"
              inputMode="url"
              required
              className="field"
              placeholder="https://example.com/merchant-feed.xml"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              aria-invalid={error !== null}
            />
            {error && (
              <p role="alert" className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">
                {t(`errors.${error}`)}
              </p>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
              {t('name')}
              <InfoTip text={t('nameHint')} />
            </span>
            <input
              className="field"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !feedUrl.trim()}
            className="btn-primary w-auto px-5"
          >
            {busy ? t('checking') : t('connect')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
