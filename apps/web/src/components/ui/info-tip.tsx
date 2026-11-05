'use client';

import { Info } from 'lucide-react';
import { useId } from 'react';

/**
 * Circled "i" next to a label; the explanation appears on hover or keyboard focus.
 * Used instead of captions under fields (rules.md §6).
 */
export function InfoTip({ text }: { text: string }) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        aria-describedby={id}
        className="inline-flex rounded-full text-muted transition-colors duration-200 hover:text-foreground focus-visible:text-foreground"
      >
        <Info size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-64 -translate-x-1/2 translate-y-1 rounded-xl bg-accent px-3 py-2 text-xs leading-snug font-normal text-accent-foreground opacity-0 shadow-[0_8px_24px_-8px_var(--shadow)] transition-[opacity,transform] duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
