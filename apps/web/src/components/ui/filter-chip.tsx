'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { usePopover } from './popover';

export type ChipOption = { value: string; label: string; hint?: string };

/** Chip trigger: quiet when unset ("Board ▾"), filled with the value and a clear button when set. */
export function ChipButton({
  label,
  valueLabel,
  open,
  onClick,
  onClear,
  clearLabel,
}: {
  label: string;
  valueLabel?: string;
  open: boolean;
  onClick: () => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const active = valueLabel !== undefined;
  return (
    <span
      className={`inline-flex h-9 max-w-72 items-center rounded-full border text-sm transition-colors duration-150 ${
        active
          ? 'border-transparent bg-hover text-foreground'
          : 'border-line text-muted hover:text-foreground'
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onClick}
        className={`flex min-w-0 items-center gap-1.5 py-1.5 ${active && onClear ? 'pr-1 pl-3.5' : 'px-3.5'}`}
      >
        <span className="truncate">
          {active ? (
            <>
              <span className="text-muted">{label}:</span> {valueLabel}
            </>
          ) : (
            label
          )}
        </span>
        {!(active && onClear) && (
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {active && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-[var(--field-focus)] hover:text-foreground"
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** Glass popover panel under a chip. */
export function ChipPanel({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <div
      className={`glass glass-strong animate-rise absolute top-full z-50 mt-2 overflow-hidden rounded-2xl ${
        align === 'right' ? 'right-0' : 'left-0'
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** One option row in a chip popover. */
export function ChipItem({
  selected,
  onClick,
  children,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
    >
      <span className="truncate">{children}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
        {hint}
        {selected && <Check size={16} className="text-foreground" aria-hidden="true" />}
      </span>
    </button>
  );
}

/**
 * Filter chip with a list of options. `value === ''` means unset (when `clearable`): the chip shows
 * just its label; otherwise it shows the chosen option.
 */
export function FilterChip({
  label,
  value,
  onChange,
  options,
  clearable = true,
  clearLabel,
  searchable = false,
  searchPlaceholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ChipOption[];
  clearable?: boolean;
  clearLabel?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <div ref={ref} className="relative">
      <ChipButton
        label={label}
        valueLabel={value === '' && clearable ? undefined : selected?.label}
        open={open}
        onClick={() => {
          setQuery('');
          setOpen(!open);
        }}
        onClear={clearable ? () => onChange('') : undefined}
        clearLabel={clearLabel}
      />
      {open && (
        <ChipPanel className="w-64">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-line px-3.5">
              <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-11 w-full bg-transparent text-sm outline-none"
              />
            </div>
          )}
          <div role="listbox" className="scroll-thin max-h-72 overflow-y-auto p-1.5">
            {shown.map((o) => (
              <ChipItem
                key={o.value}
                selected={o.value === value}
                hint={o.hint}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </ChipItem>
            ))}
          </div>
        </ChipPanel>
      )}
    </div>
  );
}
