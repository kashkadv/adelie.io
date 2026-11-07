'use client';

import { Columns3, GripVertical, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Checkbox } from '../ui/checkbox';
import { ChipPanel } from '../ui/filter-chip';
import { InfoTip } from '../ui/info-tip';
import { usePopover } from '../ui/popover';

/** Full order: the shown columns first, then the hidden ones in the default order. */
const fullOrder = <K extends string>(all: readonly K[], value: readonly K[]) => [
  ...value,
  ...all.filter((k) => !value.includes(k)),
];

function move<K>(list: K[], from: number, to: number): K[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * "Columns" chip: which table columns to show and in what order. Rows are reordered by dragging the
 * handle (mouse or touch, pointer events) or with ↑/↓ on the focused handle. At least one column
 * stays shown.
 */
export function ColumnPicker<K extends string>({
  all,
  value,
  labels,
  isDefault,
  onChange,
  onReset,
}: {
  /** Every column the platform offers, in the default order. */
  all: readonly K[];
  /** Shown columns, in order. */
  value: readonly K[];
  labels: Record<K, string>;
  isDefault: boolean;
  onChange: (value: K[]) => void;
  onReset: () => void;
}) {
  const t = useTranslations('Content.columns');
  const { open, setOpen, ref } = usePopover();
  // Hidden columns keep their place while the panel is open; reopening lists them last.
  const [order, setOrder] = useState<K[]>(() => fullOrder(all, value));
  const [dragging, setDragging] = useState<K | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const shown = new Set(value);

  function apply(nextOrder: K[], nextShown: Set<K>) {
    setOrder(nextOrder);
    onChange(nextOrder.filter((k) => nextShown.has(k)));
  }

  function toggle(key: K, on: boolean) {
    const next = new Set(shown);
    if (on) next.add(key);
    else if (next.size > 1) next.delete(key);
    apply(order, next);
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, key: K) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(key);
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!dragging || !list.current) return;
    const rows = [...list.current.children] as HTMLElement[];
    // The row whose middle is the last one above the pointer becomes the drop place.
    let target = 0;
    rows.forEach((row, i) => {
      const r = row.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) target = i;
    });
    const from = order.indexOf(dragging);
    if (from !== target) apply(move(order, from, target), shown);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, key: K) {
    const from = order.indexOf(key);
    const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : -1;
    if (to < 0 || to >= order.length) return;
    e.preventDefault();
    apply(move(order, from, to), shown);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) setOrder(fullOrder(all, value));
          setOpen(!open);
        }}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors duration-150 ${
          isDefault
            ? 'border-line text-muted hover:text-foreground'
            : 'border-transparent bg-hover text-foreground'
        }`}
      >
        <Columns3 size={15} aria-hidden="true" />
        {t('label')}
      </button>
      {open && (
        <ChipPanel align="right" className="w-72">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-3 text-sm font-medium">
            {t('title')}
            <InfoTip text={t('hint')} />
          </div>
          <ul ref={list} className="p-1.5" aria-label={t('title')}>
            {order.map((key) => (
              <li
                key={key}
                className={`flex items-center gap-2 rounded-xl px-1.5 py-1 transition-colors ${
                  dragging === key ? 'bg-hover' : ''
                }`}
              >
                <button
                  type="button"
                  aria-label={t('move', { column: labels[key] })}
                  title={t('move', { column: labels[key] })}
                  onPointerDown={(e) => onPointerDown(e, key)}
                  onPointerMove={onPointerMove}
                  onPointerUp={() => setDragging(null)}
                  onPointerCancel={() => setDragging(null)}
                  onKeyDown={(e) => onKeyDown(e, key)}
                  className={`flex h-8 w-6 shrink-0 touch-none items-center justify-center rounded-lg text-muted hover:text-foreground ${
                    dragging === key ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                >
                  <GripVertical size={15} aria-hidden="true" />
                </button>
                <Checkbox
                  checked={shown.has(key)}
                  onChange={(on) => toggle(key, on)}
                  label={labels[key]}
                />
                <button
                  type="button"
                  onClick={() => toggle(key, !shown.has(key))}
                  className={`min-w-0 flex-1 truncate py-1.5 text-left text-sm ${
                    shown.has(key) ? '' : 'text-muted'
                  }`}
                >
                  {labels[key]}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-1.5">
            <button
              type="button"
              disabled={isDefault}
              onClick={() => {
                onReset();
                setOrder([...all]);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-hover hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {t('reset')}
            </button>
          </div>
        </ChipPanel>
      )}
    </div>
  );
}
