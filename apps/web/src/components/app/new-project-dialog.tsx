'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, api } from '@/lib/api';
import { browserTimezone } from '@/lib/timezones';
import { useWorkspace } from './workspace-context';

/**
 * Glass dialog to create a project: only a name is asked; the time zone comes from the browser,
 * currency and report language from the current project — all editable later in Settings.
 */
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('NewProject');
  const router = useRouter();
  const { workspace, project, reloadWorkspace } = useWorkspace();
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    if (!name.trim()) return setError(t('errors.required'));
    setBusy(true);
    setError(undefined);
    try {
      const created = await api<{ id: string }>(`/workspaces/${workspace.id}/projects`, {
        method: 'POST',
        json: {
          name,
          timezone: browserTimezone(),
          ...(project ? { currency: project.currency, reportLocale: project.reportLocale } : {}),
        },
      });
      await reloadWorkspace(created.id);
      onClose();
      router.push('/accounts');
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { errors?: { name?: string } } | null) : null;
      setError(t(`errors.${body?.errors?.name === 'tooLong' ? 'tooLong' : 'failed'}`));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('cancel')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        noValidate
        className="glass glass-strong animate-rise relative w-full max-w-md rounded-[28px] p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {t('title')}
        </h2>
        <label className="mt-5 block">
          <span className="mb-1.5 block px-3.5 text-sm text-muted">{t('name')}</span>
          <input
            ref={input}
            className="field"
            value={name}
            maxLength={80}
            placeholder={t('namePlaceholder')}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
          />
        </label>
        {error && (
          <p role="alert" className="mt-1 px-3.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity disabled:opacity-40"
          >
            {busy ? '…' : t('create')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
