'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { InfoTip } from '../ui/info-tip';
import { PlatformIcon, type PlatformKey } from '../ui/platform-icon';

/**
 * The connection's own name: how it is called in Adelie (lists, switches, filters). Emptied or
 * reset, it goes back to the name the platform gives it.
 */
export function RenameDialog({
  platform,
  current,
  custom,
  onSave,
  onClose,
}: {
  platform: PlatformKey;
  /** The name shown now. */
  current: string;
  /** Whether it is the member's own name (then it can be reset). */
  custom: boolean;
  /** `null` = back to the platform's name. */
  onSave: (name: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('Accounts.renameDialog');
  const titleId = useId();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function save(value: string | null) {
    setBusy(true);
    setFailed(false);
    try {
      await onSave(value);
      onClose();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!busy && name.trim()) void save(name.trim());
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
            <PlatformIcon platform={platform} size={18} strokeWidth={1.75} aria-hidden="true" />
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

        <label className="mt-5 block">
          <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
            {t('name')}
            <InfoTip text={t('nameHint')} />
          </span>
          <input
            autoFocus
            className="field"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          {failed && (
            <p role="alert" className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">
              {t('failed')}
            </p>
          )}
        </label>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          {custom ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="-ml-3.5 rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
            >
              {t('reset')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
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
              disabled={busy || !name.trim() || name.trim() === current}
              className="btn-primary w-auto px-5"
            >
              {busy ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
