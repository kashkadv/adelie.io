'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';

const PERIODS = ['7', '30', '90'] as const;
type Count = { value: string; visitors: number };
type Data = {
  steps: { name: string; visitors: number }[];
  fields: { field: string; visitors: number; filled: number }[];
  failures: { field: string; visitors: number }[];
  delivery: Count[];
  payment: Count[];
};

/** Where buyers stop on the checkout page: the steps, the fields, the failures, the choices. */
export function FlipperCheckout({ base, accountId }: { base: string; accountId: string }) {
  const t = useTranslations('Flipper');
  const format = useFormatter();
  const [days, setDays] = useState<(typeof PERIODS)[number]>('30');
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<Data>(`${base}/${accountId}/checkout?days=${days}`).then(
      (d) => !cancelled && setData(d),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base, accountId, days]);

  const top = Math.max(1, ...(data?.steps.map((s) => s.visitors) ?? [0]));
  const list = (title: string, rows: { label: string; value: number }[]) => (
    <section className="card animate-rise rounded-[24px] p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('chkNone')}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between gap-3">
              <span className="truncate">{r.label}</span>
              <span className="tabular text-muted">{format.number(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <>
      <div className="animate-rise mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel={t('period')}
          value={days}
          onChange={(v) => {
            setDays(v);
            setData(null);
          }}
          options={PERIODS.map((p) => ({ value: p, label: t('days', { count: Number(p) }) }))}
        />
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {t('chkNote')}
          <InfoTip text={t('chkHint')} />
        </span>
      </div>

      <section className="card animate-rise mb-6 rounded-[24px] p-5">
        <h2 className="mb-3 text-sm font-semibold">{t('chkSteps')}</h2>
        <ul className="grid gap-3">
          {(data?.steps ?? []).map((step, i, all) => {
            const previous = i > 0 ? all[i - 1]!.visitors : 0;
            return (
              <li key={step.name}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span>{t(`chkStep.${step.name}` as 'chkStep.Purchase')}</span>
                  <span className="tabular">
                    {i > 0 && previous > 0 && (
                      <span className="mr-2 text-xs text-muted">
                        {Math.round((step.visitors / previous) * 100)}%
                      </span>
                    )}
                    {format.number(step.visitors)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-hover">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(step.visitors / top) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="card animate-rise rounded-[24px] p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            {t('chkFields')}
            <InfoTip text={t('chkFieldsHint')} />
          </h2>
          {data && data.fields.length === 0 ? (
            <p className="text-sm text-muted">{t('chkNone')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-normal">{t('chkField')}</th>
                  <th className="pb-2 text-right font-normal">{t('chkReached')}</th>
                  <th className="pb-2 text-right font-normal">{t('chkFilled')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data?.fields ?? []).map((f) => (
                  <tr key={f.field}>
                    <td className="py-1.5">{f.field}</td>
                    <td className="tabular py-1.5 text-right">{format.number(f.visitors)}</td>
                    <td className="tabular py-1.5 text-right">
                      <span className="mr-2 text-xs text-muted">
                        {f.visitors ? Math.round((f.filled / f.visitors) * 100) : 0}%
                      </span>
                      {format.number(f.filled)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {list(
          t('chkFailures'),
          (data?.failures ?? []).map((f) => ({ label: f.field, value: f.visitors })),
        )}
        {list(
          t('chkDelivery'),
          (data?.delivery ?? []).map((d) => ({ label: d.value, value: d.visitors })),
        )}
        {list(
          t('chkPayment'),
          (data?.payment ?? []).map((d) => ({ label: d.value, value: d.visitors })),
        )}
      </div>
    </>
  );
}
