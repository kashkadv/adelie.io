'use client';

import { Check, Minus } from 'lucide-react';

/** Checkbox (custom, the same on every OS — rules.md §6). `mixed` = some of a group selected. */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean | 'mixed';
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const on = checked !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(checked !== true)}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
        on
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-[var(--field-focus)] hover:border-foreground/40'
      }`}
    >
      {checked === 'mixed' ? (
        <Minus size={13} strokeWidth={3} aria-hidden="true" />
      ) : checked ? (
        <Check size={13} strokeWidth={3} aria-hidden="true" />
      ) : null}
    </button>
  );
}
