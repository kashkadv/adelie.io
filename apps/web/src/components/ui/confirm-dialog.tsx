'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Glass confirmation dialog. With `confirmText`, the user must type it (case-insensitive) before
 * the confirm button unlocks — for irreversible actions. Escape or a click on the backdrop cancels.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  confirmText,
  inputLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  confirmText?: string;
  inputLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: (typed: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const matches =
    !confirmText ||
    typed.trim().replace(/^@/, '').toLowerCase() === confirmText.replace(/^@/, '').toLowerCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={cancelLabel}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass glass-strong animate-rise relative w-full max-w-md rounded-[28px] p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-3 space-y-3 text-sm text-muted">{children}</div>

        {confirmText && (
          <label className="mt-5 block">
            <span className="mb-1.5 block px-3.5 text-sm text-muted">{inputLabel}</span>
            <input
              className="field"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmText}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="mt-3 px-3.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(typed)}
            disabled={busy || !matches}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40 ${
              danger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-accent text-accent-foreground'
            }`}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
