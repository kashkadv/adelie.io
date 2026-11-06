'use client';

import type { ReactNode } from 'react';

export type Segment<T extends string> = { value: T; label: ReactNode; title?: string };

/** Segmented control: a few mutually exclusive options side by side (period, platform). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Segment<T>[];
  ariaLabel: string;
}) {
  return (
    <div className="flex rounded-2xl border border-line p-1" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-200 ${
            value === o.value
              ? 'bg-accent text-accent-foreground'
              : 'text-muted hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
