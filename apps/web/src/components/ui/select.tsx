'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export type SelectOption = { value: string; label: string; hint?: string };

/**
 * Custom select (ADR-0009): native <select> looks different on every OS, this one looks the same
 * everywhere. Glass popover, optional search, keyboard: ↑/↓, Home/End, Enter, Escape, typing filters.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  searchable = false,
  searchPlaceholder,
  emptyText = '—',
  ariaLabel,
  invalid,
  suggested,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel?: string;
  invalid?: boolean;
  /** Option to scroll to when nothing is selected yet (e.g. 09:00 for a start time). */
  suggested?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const selected = options.find((o) => o.value === value);

  function openList() {
    const index = Math.max(
      0,
      options.findIndex((o) => o.value === (value || suggested)),
    );
    setQuery('');
    setActive(index);
    setPlacement(choosePlacement());
    setOpen(true);
  }

  /**
   * Opens upward when there is not enough room below — measured against the scroll container
   * the select lives in (the content panel), or the window.
   */
  function choosePlacement(): 'bottom' | 'top' {
    const el = button.current;
    if (!el) return 'bottom';
    const rect = el.getBoundingClientRect();
    const bounds = el.closest('main')?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    const needed = (searchable ? 44 : 0) + Math.min(options.length * 36 + 12, 268) + 8;
    const below = bounds.bottom - rect.bottom;
    const above = rect.top - bounds.top;
    return below < needed && above > below ? 'top' : 'bottom';
  }

  function choose(option: SelectOption | undefined) {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    button.current?.focus();
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // Focus the search field on open; keep the active option in view.
  useEffect(() => {
    if (open && searchable) search.current?.focus();
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function onKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    const last = filtered.length - 1;
    if (e.key === 'ArrowDown') setActive((i) => Math.min(last, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter') choose(filtered[active]);
    else if (e.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        className="field flex items-center justify-between gap-2 text-left"
      >
        <span className={`truncate ${selected ? '' : 'text-muted'}`}>
          {selected?.label ?? placeholder ?? '—'}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`glass glass-strong animate-rise absolute right-0 left-0 z-50 overflow-hidden rounded-2xl ${
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-line px-3.5">
              <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
                className="h-11 w-full bg-transparent text-sm outline-none"
              />
            </div>
          )}
          <ul
            ref={list}
            id={listId}
            role="listbox"
            className="scroll-thin max-h-64 overflow-y-auto p-1.5"
          >
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">{emptyText}</li>}
            {filtered.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ${
                    i === active ? 'bg-hover' : ''
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    {o.hint}
                    {isSelected && (
                      <Check size={16} className="text-foreground" aria-hidden="true" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
