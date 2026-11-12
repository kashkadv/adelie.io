'use client';

import { Archive, ArchiveRestore, Check, Copy, Link2, Pencil, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';
import { CONNECT_ROLES } from './accounts-data';
import { LinkDialog } from './link-dialog';
import { ChannelIcon, shortDestination } from './link-ui';
import type { LinkRow, TrackedLink } from './links-data';
import { EmptyState, PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

const PERIODS = ['today', '7', '30', '90'] as const;
type Period = (typeof PERIODS)[number];

/**
 * Link Builder (ADR-0027): the project's tracked links — both forms to copy — and what each brought
 * in the period: clicks on the short form, visits and goals on the project's sites with Flipper.
 */
export function Links() {
  const t = useTranslations('Links');
  const format = useFormatter();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const base =
    workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}/links` : null;

  const [days, setDays] = useState<Period>('30');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [data, setData] = useState<{ shortLinks: boolean; links: LinkRow[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<TrackedLink | 'new' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const query = new URLSearchParams({ days, ...(view === 'archived' ? { archived: '1' } : {}) });
    api<{ shortLinks: boolean; links: LinkRow[] }>(`${base}?${query}`).then(
      (r) => !cancelled && setData(r),
      () => !cancelled && setData({ shortLinks: false, links: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, days, view, version]);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      // the address stays visible in the dialog
    }
  }

  async function archive(link: LinkRow, archived: boolean) {
    if (!base) return;
    await api(`${base}/${link.id}`, { method: 'PATCH', json: { archived } }).catch(() => undefined);
    setVersion((v) => v + 1);
  }

  const links = data?.links ?? [];
  const anyValue = links.some((l) => l.site?.value !== null && l.site?.value !== undefined);
  const num = (n: number) => format.number(n);
  const dash = <span className="text-muted">—</span>;

  const copyButton = (key: string, text: string, label: string, short: boolean): ReactNode => (
    <button
      type="button"
      onClick={() => void copy(key, text)}
      title={label}
      aria-label={label}
      className={`flex h-8 items-center gap-1.5 rounded-xl border border-line px-2.5 text-xs transition-colors hover:text-foreground ${
        short ? '' : 'text-muted'
      }`}
    >
      {copied === key ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      {short ? t('copyShort') : t('copyFull')}
    </button>
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canManage && (
            <button
              type="button"
              onClick={() => setDialog('new')}
              className="btn-primary flex w-auto items-center gap-2 px-4"
            >
              <Plus size={16} aria-hidden="true" />
              {t('new')}
            </button>
          )
        }
      />

      <div className="animate-rise mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel={t('view')}
          value={view}
          onChange={(v) => {
            setView(v);
            setData(null);
          }}
          options={[
            { value: 'active', label: t('active') },
            { value: 'archived', label: t('archived') },
          ]}
        />
        <Segmented
          ariaLabel={t('period')}
          value={days}
          onChange={(d) => {
            setDays(d);
            setData(null);
          }}
          options={PERIODS.map((p) => ({
            value: p,
            label: p === 'today' ? t('today') : t('days', { count: Number(p) }),
          }))}
        />
      </div>

      {!data ? (
        <p className="py-10 text-center text-sm text-muted">…</p>
      ) : links.length === 0 ? (
        <EmptyState
          icon={<Link2 size={22} strokeWidth={1.75} aria-hidden="true" />}
          title={view === 'archived' ? t('emptyArchived') : t('emptyTitle')}
          text={view === 'archived' ? t('emptyArchivedText') : t('emptyText')}
          action={
            canManage && view === 'active' ? (
              <button
                type="button"
                onClick={() => setDialog('new')}
                className="btn-primary w-auto px-5"
              >
                {t('new')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <section className="card animate-rise rounded-[24px] p-5">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pr-3 pb-2 font-normal">{t('colLink')}</th>
                  <th className="px-3 pb-2 font-normal">{t('colChannel')}</th>
                  <th className="px-3 pb-2 font-normal">{t('colCampaign')}</th>
                  <th className="pb-2 pl-3 text-right font-normal">
                    <span className="inline-flex items-center gap-1">
                      {t('colClicks')}
                      <InfoTip text={t('colClicksHint')} />
                    </span>
                  </th>
                  <th className="pb-2 pl-3 text-right font-normal">
                    <span className="inline-flex items-center gap-1">
                      {t('colVisits')}
                      <InfoTip text={t('colVisitsHint')} />
                    </span>
                  </th>
                  <th className="pb-2 pl-3 text-right font-normal">
                    <span className="inline-flex items-center gap-1">
                      {t('colGoals')}
                      <InfoTip text={t('colGoalsHint')} />
                    </span>
                  </th>
                  {anyValue && (
                    <th className="pb-2 pl-3 text-right font-normal">{t('colValue')}</th>
                  )}
                  <th className="pb-2 pl-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {links.map((l) => (
                  <tr key={l.id} className="align-middle">
                    <td className="max-w-[300px] py-2.5 pr-3">
                      <span className="block truncate font-medium" title={l.name ?? l.destination}>
                        {l.name ?? shortDestination(l.destination)}
                      </span>
                      <span
                        className="block truncate text-xs text-muted"
                        title={l.shortUrl ?? l.url}
                      >
                        {l.name ? `${shortDestination(l.destination)} · ` : ''}
                        {l.content}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <ChannelIcon channel={l.channel} />
                        {l.channel === 'other' ? l.source : t(`channels.${l.channel}`)}
                      </span>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5" title={l.campaign ?? ''}>
                      {l.campaign ?? dash}
                    </td>
                    <td className="tabular py-2.5 pl-3 text-right">
                      {l.shortUrl ? num(l.clicks) : dash}
                    </td>
                    <td className="tabular py-2.5 pl-3 text-right">
                      {l.site ? num(l.site.visits) : dash}
                    </td>
                    <td className="tabular py-2.5 pl-3 text-right">
                      {l.site ? num(l.site.conversions) : dash}
                    </td>
                    {anyValue && (
                      <td className="tabular py-2.5 pl-3 text-right">
                        {l.site?.value !== null && l.site?.value !== undefined
                          ? l.site.currency
                            ? format.number(l.site.value, {
                                style: 'currency',
                                currency: l.site.currency,
                                maximumFractionDigits: 0,
                              })
                            : format.number(l.site.value, { maximumFractionDigits: 0 })
                          : dash}
                      </td>
                    )}
                    <td className="py-2.5 pl-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {l.shortUrl && copyButton(`s${l.id}`, l.shortUrl, t('copyShortHint'), true)}
                        {copyButton(`f${l.id}`, l.url, t('copyFullHint'), false)}
                        {canManage && view === 'active' && (
                          <button
                            type="button"
                            onClick={() => setDialog(l)}
                            title={t('edit')}
                            aria-label={t('edit')}
                            className="icon-btn h-8 w-8"
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void archive(l, view === 'active')}
                            title={view === 'active' ? t('archive') : t('restore')}
                            aria-label={view === 'active' ? t('archive') : t('restore')}
                            className="icon-btn h-8 w-8"
                          >
                            {view === 'active' ? (
                              <Archive size={14} aria-hidden="true" />
                            ) : (
                              <ArchiveRestore size={14} aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dialog && base && (
        <LinkDialog
          base={base}
          link={dialog === 'new' ? undefined : dialog}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            if (dialog === 'new') {
              void copy(`${saved.shortUrl ? 's' : 'f'}${saved.id}`, saved.shortUrl ?? saved.url);
            }
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
