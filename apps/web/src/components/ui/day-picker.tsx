'use client';

import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useFormatter } from 'next-intl';
import { useState } from 'react';
import { toDay, type Day } from './date-range';
import { usePopover } from './popover';

const fromDay = (day: Day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

/**
 * A field for one day (ADR-0009: no native date picker): a button with the chosen day and a month
 * calendar in a glass popover, past and future alike. `clearLabel` offers "no day".
 */
export function DayField({
  value,
  onChange,
  emptyLabel,
  clearLabel,
  previousLabel,
  nextLabel,
  ariaLabel,
}: {
  value: Day | null;
  onChange: (day: Day | null) => void;
  emptyLabel: string;
  clearLabel?: string;
  previousLabel: string;
  nextLabel: string;
  ariaLabel: string;
}) {
  const format = useFormatter();
  const { open, setOpen, ref } = usePopover();
  const today = toDay(new Date());
  const [month, setMonth] = useState(() => {
    const anchor = value ? fromDay(value) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  const lead = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Day | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      toDay(new Date(month.getFullYear(), month.getMonth(), i + 1)),
    ),
  ];
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    format.dateTime(new Date(2024, 0, 1 + i), { weekday: 'narrow' }),
  );
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="field flex items-center justify-between gap-2 text-left"
      >
        <span className={value ? '' : 'text-muted'}>
          {value
            ? format.dateTime(fromDay(value), { weekday: 'short', day: 'numeric', month: 'long' })
            : emptyLabel}
        </span>
        <CalendarDays size={16} className="shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open && (
        <div className="glass glass-strong animate-rise absolute top-full left-0 z-50 mt-2 w-72 rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="icon-btn h-8 w-8"
              aria-label={previousLabel}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="text-sm font-medium first-letter:uppercase">
              {format.dateTime(month, { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={() => shift(1)}
              className="icon-btn h-8 w-8"
              aria-label={nextLabel}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted">
            {weekdays.map((w, i) => (
              <span key={i} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) =>
              day ? (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    onChange(day);
                    setOpen(false);
                  }}
                  className={`tabular h-9 rounded-full text-sm transition-colors ${
                    day === value ? 'bg-accent text-accent-foreground' : 'hover:bg-hover'
                  } ${day === today && day !== value ? 'font-semibold' : ''}`}
                >
                  {Number(day.slice(8))}
                </button>
              ) : (
                <span key={`x${i}`} />
              ),
            )}
          </div>
          {clearLabel && value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-sm text-muted hover:bg-hover hover:text-foreground"
            >
              <X size={14} aria-hidden="true" />
              {clearLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
