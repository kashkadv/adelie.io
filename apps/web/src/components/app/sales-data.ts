'use client';

import { useFormatter } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from './workspace-context';

export type Shop = {
  id: string;
  platform: 'ETSY' | 'WEBSITE';
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Products on the channel (not the ones that left it). */
  _count?: { products: number };
};

/** `/workspaces/:id/projects/:id/sales`, or null before the project is known. */
export function useSalesBase(): string | null {
  const { workspace, project } = useWorkspace();
  return workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}/sales` : null;
}

/**
 * Shops (points of sale) of the current project; null while loading. `catalog`: sites with a
 * product feed too (the Products page).
 */
export function useShops(catalog = false): Shop[] | null {
  const base = useSalesBase();
  const [shops, setShops] = useState<{ base: string; list: Shop[] } | null>(null);
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    api<Shop[]>(`${base}/shops${catalog ? '?catalog=1' : ''}`).then(
      (list) => !cancelled && setShops({ base, list }),
      () => !cancelled && setShops({ base, list: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, catalog]);
  return shops && shops.base === base ? shops.list : null;
}

/** Digits after the decimal point of a currency (USD 2, JPY 0). */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Formats money stored as integer minor units (ADR-0018). `compact` drops the cents. */
export function useMoney() {
  const format = useFormatter();
  return useCallback(
    (minor: number | null | undefined, currency: string | null | undefined, compact = false) => {
      if (minor === null || minor === undefined || !currency) return '—';
      const value = minor / 10 ** minorDigits(currency);
      return format.number(value, {
        style: 'currency',
        currency,
        ...(compact ? { maximumFractionDigits: 0 } : {}),
      });
    },
    [format],
  );
}
