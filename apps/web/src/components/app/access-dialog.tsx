'use client';

import { Check, Link2, Lock, PenLine, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlatformIcon, type PlatformKey } from '../ui/platform-icon';

export type AccessLevel = 'read' | 'write';

/**
 * Choosing how much a connection may do (ADR-0019): read-only or full access. Then either go to the
 * platform's consent screen or copy an invitation for the account's owner. Changing access of an
 * existing connection is the same: the platform asks for consent again.
 */
export function AccessDialog({
  platform,
  initial = 'read',
  current,
  onConnect,
  onInvite,
  onClose,
}: {
  platform: PlatformKey;
  initial?: AccessLevel;
  /** The access the connection has now, when changing it. */
  current?: AccessLevel;
  onConnect: (access: AccessLevel) => void;
  onInvite?: (access: AccessLevel) => void;
  onClose: () => void;
}) {
  const t = useTranslations('Accounts.accessDialog');
  const tAccounts = useTranslations('Accounts');
  const titleId = useId();
  const [access, setAccess] = useState<AccessLevel>(initial);
  const name = tAccounts(`platforms.${platform}`);
  const key = platform.toLowerCase() as 'etsy';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const option = (value: AccessLevel) => {
    const Icon = value === 'read' ? Lock : PenLine;
    const selected = access === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => setAccess(value)}
        className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors duration-150 ${
          selected ? 'border-accent bg-hover' : 'border-line hover:bg-hover'
        }`}
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hover">
          <Icon size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            {t(`${value}.title`)}
            {current === value && (
              <span className="rounded-full border border-line px-1.5 text-xs leading-4 font-normal text-muted">
                {t('current')}
              </span>
            )}
          </span>
          <span className="mt-1 block text-sm text-muted">{t(`${value}.${key}`)}</span>
        </span>
        <span
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
            selected
              ? 'border-accent bg-accent text-accent-foreground'
              : 'border-[var(--field-focus)]'
          }`}
          aria-hidden="true"
        >
          {selected && <Check size={13} strokeWidth={3} />}
        </span>
      </button>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass glass-strong animate-rise relative w-full max-w-md rounded-[28px] p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <PlatformIcon platform={platform} size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {current ? t('changeTitle', { platform: name }) : t('title', { platform: name })}
            </h2>
            <p className="text-sm text-muted">{t('lead')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="icon-btn h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div role="radiogroup" aria-labelledby={titleId} className="mt-5 grid gap-2">
          {option('read')}
          {option('write')}
        </div>
        <p className="mt-3 px-1 text-xs text-muted">{t('changeLater')}</p>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {onInvite && (
            <button
              type="button"
              onClick={() => onInvite(access)}
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
            >
              <Link2 size={15} aria-hidden="true" />
              {tAccounts('copyInvite')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onConnect(access)}
            className="btn-primary w-auto px-5"
          >
            {t('continue', { platform: name })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
