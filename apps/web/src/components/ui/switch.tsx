'use client';

import { useId } from 'react';

/** On/off switch with a label (custom, the same on every OS — rules.md §6). */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? 'bg-accent' : 'bg-[var(--field-focus)]'
        }`}
      >
        <span
          className={`inline-block h-4.5 w-4.5 rounded-full shadow-[0_1px_3px_var(--shadow)] transition-transform duration-200 ease-(--ease-soft) ${
            checked
              ? 'translate-x-[19px] bg-accent-foreground'
              : 'translate-x-[3px] bg-white dark:bg-background'
          }`}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm text-muted select-none">
        {label}
      </label>
    </span>
  );
}
