'use client';

import { KeyRound } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';

type Share = { key: string; name: string; ratio: number; index?: number };
export type Audience = {
  /** The connection lacks the permission: "update access". */
  missing: boolean;
  items: {
    type: string;
    date: string;
    size: number | null;
    sizeIsUpperBound: boolean;
    groups: Record<string, Share[]>;
  }[];
};

/** Groups in display order; anything else the platform sends comes after. */
const ORDER = ['ages', 'genders', 'countries', 'metros', 'devices', 'interests'];
const KNOWN_GROUPS = new Set(ORDER);
/** Translated shares: genders by key ("Unspecified & custom" → unspecified). */
const shareKey = (group: string, s: Share): string | null => {
  if (group !== 'genders') return null;
  const k = s.key.toLowerCase();
  return k.startsWith('female') ? 'female' : k.startsWith('male') ? 'male' : 'unspecified';
};

/**
 * Who the audience is (account level: platforms give no demographics per post). With a missing
 * permission it explains and links to "update access" instead of showing emptiness.
 */
export function AudienceSection({ audience }: { audience: Audience | null }) {
  const t = useTranslations('Overview.audience');
  const format = useFormatter();
  const [chosen, setChosen] = useState<string | null>(null);
  if (!audience) return null;

  // Audiences the platform had enough people for; an empty one is explained, not shown empty.
  const withData = audience.items.filter((i) => Object.keys(i.groups).length > 0);
  const empty = audience.items.filter((i) => !Object.keys(i.groups).length).map((i) => i.type);
  const types = withData.map((i) => i.type);
  const current = withData.find((i) => i.type === (chosen ?? 'engaged')) ?? withData[0] ?? null;
  const groups = current
    ? Object.keys(current.groups).sort(
        (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99),
      )
    : [];
  const label = (group: string, s: Share) => {
    const k = shareKey(group, s);
    return k ? t(`shares.genders.${k}` as 'shares.genders.female') : s.name;
  };

  return (
    <section
      className="card animate-rise mt-4 rounded-[24px] p-5"
      style={{ animationDelay: '280ms' }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          {t('title')}
          <InfoTip text={t('hint')} />
        </h2>
        {types.length > 1 && current && (
          <Segmented
            value={current.type}
            onChange={setChosen}
            options={types.map((ty) => ({
              value: ty,
              label: ty === 'engaged' || ty === 'total' ? t(`types.${ty}`) : ty,
            }))}
            ariaLabel={t('title')}
          />
        )}
      </div>

      {audience.missing ? (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-hover p-4 text-sm">
          <KeyRound size={18} className="shrink-0 text-muted" aria-hidden="true" />
          <p className="min-w-0 flex-1">{t('missing')}</p>
          <Link href="/connections" className="btn-primary w-auto px-4">
            {t('updateAccess')}
          </Link>
        </div>
      ) : !current ? (
        <p className="px-1 text-sm text-muted">{t('pending')}</p>
      ) : (
        <>
          <p className="mb-3 flex flex-wrap gap-x-3 px-1 text-xs text-muted">
            {current.size !== null && (
              <span>
                {t(current.sizeIsUpperBound ? 'sizeUpTo' : 'size', {
                  size: format.number(current.size, { notation: 'compact' }),
                })}
              </span>
            )}
            {empty.includes('engaged') && <span>{t('engagedEmpty')}</span>}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => {
              const shares = current.groups[group]!.slice(0, group === 'interests' ? 8 : 6);
              const max = Math.max(...shares.map((s) => s.ratio));
              return (
                <div key={group} className="rounded-2xl bg-hover p-4">
                  <h3 className="mb-3 text-sm font-semibold">
                    {KNOWN_GROUPS.has(group) ? t(`groups.${group}` as 'groups.ages') : group}
                  </h3>
                  <ul className="space-y-2">
                    {shares.map((s) => (
                      <li key={s.key} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{label(group, s)}</span>
                            {/* Affinity vs the average platform user (interests). */}
                            {s.index !== undefined && s.index >= 1.1 && (
                              <span
                                className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 text-[11px] leading-4 text-emerald-700 dark:text-emerald-300"
                                title={t('indexHint', {
                                  index: format.number(s.index, { maximumFractionDigits: 1 }),
                                })}
                              >
                                ×{format.number(s.index, { maximumFractionDigits: 1 })}
                              </span>
                            )}
                          </span>
                          <span className="tabular text-muted">
                            {format.number(s.ratio, { style: 'percent', maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(s.ratio / max) * 100}%`,
                              background: 'var(--series-1)',
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
