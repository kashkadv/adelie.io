'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFormatter } from 'next-intl';
import { useState } from 'react';
import { ChipButton, ChipItem, ChipPanel } from './filter-chip';
import { usePopover } from './popover';
import { Segmented } from './segmented';

/** A day as YYYY-MM-DD (calendar date, no time zone). */
export type Day = string;
export type Preset = '7d' | '30d' | '12m';
export type DateRange =
  { preset: 'all' } | { preset: Preset } | { preset: 'custom'; from: Day; to: Day };

const pad = (n: number) => String(n).padStart(2, '0');
export const toDay = (d: Date): Day =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromDay = (day: Day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

/** The concrete inclusive from/to of a range, or null for "all time". */
export function resolveRange(range: DateRange, today = new Date()): { from: Day; to: Day } | null {
  if (range.preset === 'all') return null;
  if (range.preset === 'custom') return { from: range.from, to: range.to };
  const from = new Date(today);
  if (range.preset === '12m') {
    from.setFullYear(from.getFullYear() - 1);
    from.setDate(from.getDate() + 1);
  } else {
    from.setDate(from.getDate() - (range.preset === '7d' ? 6 : 29));
  }
  return { from: toDay(from), to: toDay(today) };
}

/** "1 Oct – 15 Oct 2026": the year once when both ends share it. */
function useRangeLabel() {
  const format = useFormatter();
  const short = (day: Day, withYear: boolean) =>
    format.dateTime(fromDay(day), {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  return (from: Day, to: Day) =>
    from === to
      ? short(from, true)
      : `${short(from, from.slice(0, 4) !== to.slice(0, 4))} – ${short(to, true)}`;
}

/**
 * Month calendar for picking a range: the first click sets the start, the second the end; the span
 * follows the pointer in between. Future days are disabled.
 */
export function RangeCalendar({
  value,
  onPick,
  previousLabel,
  nextLabel,
}: {
  value: { from: Day; to: Day } | null;
  onPick: (from: Day, to: Day) => void;
  previousLabel: string;
  nextLabel: string;
}) {
  const format = useFormatter();
  const today = toDay(new Date());
  const [start, setStart] = useState<Day | null>(null);
  const [hover, setHover] = useState<Day | null>(null);
  const [month, setMonth] = useState(() => {
    const anchor = value ? fromDay(value.to) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  function pick(day: Day) {
    if (!start) {
      setStart(day);
      return;
    }
    const [from, to] = start <= day ? [start, day] : [day, start];
    setStart(null);
    onPick(from, to);
  }

  // Weeks start on Monday.
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
  const span: [Day, Day] | null = start
    ? ([start, hover ?? start].sort() as [Day, Day])
    : value
      ? [value.from, value.to]
      : null;
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const isCurrentMonth = toDay(month).slice(0, 7) >= today.slice(0, 7);

  return (
    <div className="w-72 p-3">
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
          disabled={isCurrentMonth}
          className="icon-btn h-8 w-8 disabled:opacity-30"
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
      <div className="grid grid-cols-7 gap-y-0.5" onPointerLeave={() => setHover(null)}>
        {cells.map((day, i) => {
          if (!day) return <span key={`x${i}`} />;
          const inSpan = span && day >= span[0] && day <= span[1];
          const edge = span && (day === span[0] || day === span[1]);
          return (
            <button
              key={day}
              type="button"
              disabled={day > today}
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
  );
}

export type RangeLabels = {
  all: string;
  '7d': string;
  '30d': string;
  '12m': string;
  custom: string;
  previous: string;
  next: string;
  clear: string;
};

const PRESETS: Preset[] = ['7d', '30d', '12m'];

/** Filter chip for a date range: presets plus "Custom range" with a calendar. */
export function DateRangeChip({
  label,
  value,
  onChange,
  labels,
}: {
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
  labels: RangeLabels;
}) {
  const { open, setOpen, ref } = usePopover();
  const [calendar, setCalendar] = useState(false);
  const rangeLabel = useRangeLabel();
  const valueLabel =
    value.preset === 'all'
      ? undefined
      : value.preset === 'custom'
        ? rangeLabel(value.from, value.to)
        : labels[value.preset];

  return (
    <div ref={ref} className="relative">
      <ChipButton
        label={label}
        valueLabel={valueLabel}
        open={open}
        onClick={() => {
          setCalendar(value.preset === 'custom');
          setOpen(!open);
        }}
        onClear={() => onChange({ preset: 'all' })}
        clearLabel={labels.clear}
      />
      {open && (
        <ChipPanel>
          {calendar ? (
            <RangeCalendar
              value={value.preset === 'custom' ? value : null}
              onPick={(from, to) => {
                onChange({ preset: 'custom', from, to });
                setOpen(false);
              }}
              previousLabel={labels.previous}
              nextLabel={labels.next}
            />
          ) : (
            <div role="listbox" className="w-56 p-1.5">
              {PRESETS.map((p) => (
                <ChipItem
                  key={p}
                  selected={value.preset === p}
                  onClick={() => {
                    onChange({ preset: p });
                    setOpen(false);
                  }}
                >
                  {labels[p]}
                </ChipItem>
              ))}
              <ChipItem selected={value.preset === 'custom'} onClick={() => setCalendar(true)}>
                {labels.custom}
              </ChipItem>
            </div>
          )}
        </ChipPanel>
      )}
    </div>
  );
}

/**
 * Data period: segments for 7 days / 30 days / 12 months / all time, and a calendar button for a
 * custom range (it shows the chosen range while active).
 */
export function PeriodControl({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
  labels: RangeLabels;
  ariaLabel: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const rangeLabel = useRangeLabel();
  const custom = value.preset === 'custom';
  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <Segmented
        value={value.preset === 'custom' ? ('' as never) : value.preset}
        onChange={(preset) => onChange({ preset } as DateRange)}
        options={(['7d', '30d', '12m', 'all'] as const).map((p) => ({
          value: p,
          label: labels[p],
        }))}
        ariaLabel={ariaLabel}
      />
      <button
        type="button"
        aria-expanded={open}
        aria-label={labels.custom}
        title={labels.custom}
        onClick={() => setOpen(!open)}
        className={`flex h-[42px] items-center gap-2 rounded-2xl border px-3 text-sm whitespace-nowrap transition-colors duration-200 ${
          custom
            ? 'border-transparent bg-accent text-accent-foreground'
            : 'border-line text-muted hover:text-foreground'
        }`}
      >
        <CalendarDays size={16} aria-hidden="true" />
        {custom && rangeLabel(value.from, value.to)}
      </button>
      {open && (
        <ChipPanel>
          <RangeCalendar
            value={custom ? value : null}
            onPick={(from, to) => {
              onChange({ preset: 'custom', from, to });
              setOpen(false);
            }}
            previousLabel={labels.previous}
            nextLabel={labels.next}
          />
        </ChipPanel>
      )}
    </div>
  );
}
