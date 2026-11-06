'use client';

import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFormatter } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** A day as YYYY-MM-DD (calendar date, no time zone). */
export type Day = string;
export type DateRange =
  { preset: 'all' | '30d' | '12m' } | { preset: 'custom'; from: Day; to: Day };

const pad = (n: number) => String(n).padStart(2, '0');
export const toDay = (d: Date): Day =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromDay = (day: Day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The concrete from/to of a range (inclusive), or null for "all time". */
export function resolveRange(range: DateRange, today = new Date()): { from: Day; to: Day } | null {
  if (range.preset === 'all') return null;
  if (range.preset === 'custom') return { from: range.from, to: range.to };
  const from = new Date(today);
  if (range.preset === '30d') from.setDate(from.getDate() - 29);
  else {
    from.setFullYear(from.getFullYear() - 1);
    from.setDate(from.getDate() + 1);
  }
  return { from: toDay(from), to: toDay(today) };
}

type Labels = {
  all: string;
  '30d': string;
  '12m': string;
  custom: string;
  previous: string;
  next: string;
};

/**
 * Date range picker (custom, the same on every OS — rules.md §6): presets plus a month calendar
 * where the first click sets the start and the second the end.
 */
export function DateRangePicker({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
  labels: Labels;
  ariaLabel?: string;
}) {
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [start, setStart] = useState<Day | null>(null);
  const [hover, setHover] = useState<Day | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const root = useRef<HTMLDivElement>(null);
  const today = toDay(new Date());

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const short = (day: Day, withYear: boolean) =>
    format.dateTime(fromDay(day), {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  const label =
    value.preset === 'custom'
      ? value.from === value.to
        ? short(value.from, true)
        : `${short(value.from, value.from.slice(0, 4) !== value.to.slice(0, 4))} – ${short(value.to, true)}`
      : labels[value.preset];

  function openPicker() {
    setCalendar(value.preset === 'custom');
    setStart(null);
    setHover(null);
    const anchor = value.preset === 'custom' ? fromDay(value.to) : new Date();
    setMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    setOpen(true);
  }

  function pick(day: Day) {
    if (!start) {
      setStart(day);
      return;
    }
    const [from, to] = start <= day ? [start, day] : [day, start];
    onChange({ preset: 'custom', from, to });
    setOpen(false);
  }

  // Calendar grid: weeks start on Monday.
  const first = month;
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (Day | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      toDay(new Date(first.getFullYear(), first.getMonth(), i + 1)),
    ),
  ];
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    format.dateTime(new Date(2024, 0, 1 + i), { weekday: 'narrow' }),
  );
  // Highlighted span: the chosen range, or start → hovered day while picking.
  const span: [Day, Day] | null = start
    ? ([start, hover ?? start].sort() as [Day, Day])
    : value.preset === 'custom'
      ? [value.from, value.to]
      : null;

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const presets = ['all', '30d', '12m'] as const;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="field flex items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays size={15} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="glass glass-strong animate-rise absolute top-full right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl p-1.5">
          <ul>
            {presets.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ preset: p });
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
                >
                  {labels[p]}
                  {value.preset === p && <Check size={16} aria-hidden="true" />}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setCalendar(true)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-hover ${calendar ? 'bg-hover' : ''}`}
              >
                {labels.custom}
                {value.preset === 'custom' && <Check size={16} aria-hidden="true" />}
              </button>
            </li>
          </ul>

          {calendar && (
            <div className="mt-1.5 border-t border-line px-1.5 pt-2.5 pb-1">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => shift(-1)}
                  className="icon-btn h-8 w-8"
                  aria-label={labels.previous}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="text-sm font-medium first-letter:uppercase">
                  {format.dateTime(month, { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  onClick={() => shift(1)}
                  disabled={toDay(month) >= today.slice(0, 8) + '01'}
                  className="icon-btn h-8 w-8 disabled:opacity-30"
                  aria-label={labels.next}
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
              <div className="grid grid-cols-7 gap-y-0.5" onPointerLeave={() => setHover(null)}>
                {cells.map((day, i) => {
                  if (!day) return <span key={`x${i}`} />;
                  const inSpan = span && day >= span[0] && day <= span[1];
                  const edge = span && (day === span[0] || day === span[1]);
                  const future = day > today;
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={future}
                      onClick={() => pick(day)}
                      onPointerEnter={() => start && setHover(day)}
                      className={`tabular h-9 text-sm transition-colors disabled:opacity-30 ${
                        edge
                          ? 'rounded-full bg-accent text-accent-foreground'
                          : inSpan
                            ? 'bg-hover'
                            : 'rounded-full hover:bg-hover'
                      } ${day === today && !edge ? 'font-semibold' : ''}`}
                    >
                      {Number(day.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
