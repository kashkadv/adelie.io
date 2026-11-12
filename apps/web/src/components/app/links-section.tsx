'use client';

import { Check, Copy, Link2, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { CONNECT_ROLES } from './accounts-data';
import { LinkDialog } from './link-dialog';
import { ChannelIcon } from './link-ui';
import type { LinkRow } from './links-data';
import { useWorkspace } from './workspace-context';

/**
 * The tracked links of a product or a post (ADR-0027), in its card: what each brought in 30 days.
 * A product's card can make a new link to the product's page.
 */
export function LinksSection({
  product,
  post,
  destination,
}: {
  product?: string;
  post?: string;
  /** Where a new link from here leads (a product's page); none = no "new link" here. */
  destination?: string | null;
}) {
  const t = useTranslations('Links');
  const format = useFormatter();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const base =
    workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}/links` : null;
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const query = new URLSearchParams({
      days: '30',
      ...(product ? { product } : {}),
      ...(post ? { post } : {}),
    });
    api<{ links: LinkRow[] }>(`${base}?${query}`).then(
      (r) => !cancelled && setLinks(r.links),
      () => !cancelled && setLinks([]),
    );
    return () => {
      cancelled = true;
    };
  }, [base, product, post, version]);

  async function copy(link: LinkRow) {
    try {
      await navigator.clipboard.writeText(link.shortUrl ?? link.url);
      setCopied(link.id);
      setTimeout(() => setCopied((c) => (c === link.id ? null : c)), 1800);
    } catch {
      // nothing to do: the Links page shows the address
    }
  }

  // A post without links of Link Builder: nothing to show.
  if (!links || (post && links.length === 0)) return null;
  const num = (n: number) => format.number(n);

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t('cardTitle')}
          <InfoTip text={t('cardHint')} />
        </h3>
        {canManage && destination && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-1 text-xs hover:bg-hover"
          >
            <Plus size={13} aria-hidden="true" />
            {t('new')}
          </button>
        )}
      </div>
      {links.length ? (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <ChannelIcon channel={l.channel} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {l.name ?? (l.channel === 'other' ? l.source : t(`channels.${l.channel}`))}
                </span>
                <span className="block truncate text-xs text-muted">
                  {[l.campaign, l.content].filter(Boolean).join(' · ')}
                  {l.archivedAt ? ` · ${t('archivedOne')}` : ''}
                </span>
              </span>
              <span className="tabular shrink-0 text-xs whitespace-nowrap text-muted">
                {t('cardStats', {
                  clicks: l.shortUrl ? num(l.clicks) : '—',
                  visits: l.site ? num(l.site.visits) : '—',
                  goals: l.site ? num(l.site.conversions) : '—',
                })}
              </span>
              <button
                type="button"
                onClick={() => void copy(l)}
                title={l.shortUrl ? t('copyShortHint') : t('copyFullHint')}
                aria-label={l.shortUrl ? t('copyShortHint') : t('copyFullHint')}
                className="icon-btn h-7 w-7 shrink-0"
              >
                {copied === l.id ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <Copy size={13} aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 px-1 text-sm text-muted">
          <Link2 size={14} aria-hidden="true" />
          {t('cardEmpty')}
          <Link href="/links" className="text-foreground hover:underline">
            {t('title')}
          </Link>
        </p>
      )}

      {creating && base && destination && (
        <LinkDialog
          base={base}
          initialDestination={destination}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            void navigator.clipboard.writeText(saved.shortUrl ?? saved.url).catch(() => undefined);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
