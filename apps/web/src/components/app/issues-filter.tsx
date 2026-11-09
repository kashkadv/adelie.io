'use client';

import { Check, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ChipButton, ChipPanel } from '../ui/filter-chip';
import { usePopover } from '../ui/popover';
import { ISSUE_LEVELS, ISSUE_STYLE, type IssueCode, type IssueLevel } from './product-issues';

/** The problems by importance (the same levels as the API's product-issues.ts). */
const LEVEL_OF: Record<IssueCode, IssueLevel> = {
  pinToUnavailable: 'critical',
  noPrice: 'critical',
  noPhoto: 'critical',
  soldOutActive: 'critical',
  duplicateSku: 'critical',
  noSku: 'important',
  noTags: 'important',
  noPins: 'important',
  skuGaps: 'important',
  skuOneForAll: 'important',
  fewTags: 'note',
  noViews: 'note',
};

/** A round box like the Checkbox, for rows that are buttons themselves. */
function Box({ checked }: { checked: boolean | 'mixed' }) {
  const on = checked !== false;
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
        on ? 'border-accent bg-accent text-accent-foreground' : 'border-[var(--field-focus)]'
      }`}
    >
      {checked === 'mixed' ? (
        <Minus size={13} strokeWidth={3} />
      ) : checked ? (
        <Check size={13} strokeWidth={3} />
      ) : null}
    </span>
  );
}

/**
 * Filter by problems: grouped by importance, each group lists the problems found (with how many
 * products have each); one or several can be chosen, a group header chooses its whole group. A
 * product matches when it has any of the chosen problems.
 */
export function IssuesFilter({
  selected,
  onChange,
  counts,
  clearLabel,
}: {
  selected: IssueCode[];
  onChange: (codes: IssueCode[]) => void;
  /** Products per problem: only the problems that exist are listed. */
  counts: Partial<Record<IssueCode, number>>;
  clearLabel: string;
}) {
  const t = useTranslations('Sales.issues');
  const { open, setOpen, ref } = usePopover();
  const present = (Object.keys(LEVEL_OF) as IssueCode[]).filter(
    (c) => (counts[c] ?? 0) > 0 || selected.includes(c),
  );
  const toggle = (code: IssueCode) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  const toggleGroup = (codes: IssueCode[]) => {
    const all = codes.every((c) => selected.includes(c));
    onChange(
      all
        ? selected.filter((c) => !codes.includes(c))
        : [...selected, ...codes.filter((c) => !selected.includes(c))],
    );
  };

  return (
    <div ref={ref} className="relative">
      <ChipButton
        label={t('filter')}
        valueLabel={
          selected.length === 0
            ? undefined
            : selected.length === 1
              ? t(`short.${selected[0]!}`)
              : t('selected', { count: selected.length })
        }
        open={open}
        onClick={() => setOpen(!open)}
        onClear={() => onChange([])}
        clearLabel={clearLabel}
      />
      {open && (
        <ChipPanel className="w-80">
          <div
            role="group"
            aria-label={t('filter')}
            className="scroll-thin max-h-96 overflow-y-auto p-1.5"
          >
            {present.length === 0 && <p className="px-3 py-3 text-sm text-muted">{t('none')}</p>}
            {ISSUE_LEVELS.map((level) => {
              const codes = present.filter((c) => LEVEL_OF[c] === level);
              if (!codes.length) return null;
              const chosen = codes.filter((c) => selected.includes(c)).length;
              return (
                <div key={level} className="mb-1 last:mb-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={chosen === 0 ? false : chosen === codes.length ? true : 'mixed'}
                    onClick={() => toggleGroup(codes)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-hover"
                  >
                    <Box
                      checked={chosen === 0 ? false : chosen === codes.length ? true : 'mixed'}
                    />
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${ISSUE_STYLE[level].dot}`}
                    />
                    {t(`levels.${level}`)}
                  </button>
                  {codes.map((code) => (
                    <button
                      key={code}
                      type="button"
                      role="checkbox"
                      aria-checked={selected.includes(code)}
                      onClick={() => toggle(code)}
                      className="flex w-full items-center gap-3 rounded-xl py-2 pr-3 pl-10 text-left text-sm hover:bg-hover"
                    >
                      <Box checked={selected.includes(code)} />
                      <span className="min-w-0 flex-1">{t(`short.${code}`)}</span>
                      <span className="tabular shrink-0 text-xs text-muted">
                        {counts[code] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </ChipPanel>
      )}
    </div>
  );
}
