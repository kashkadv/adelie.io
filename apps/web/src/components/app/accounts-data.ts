'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from './workspace-context';

export type ConnectionStatus = 'ACTIVE' | 'REAUTHORIZATION_REQUIRED' | 'REVOKED';

export type SocialAccount = {
  id: string;
  platform: 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK';
  externalId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accountType: string | null;
  followersCount: number | null;
  postsCount: number | null;
  collectingSince: string | null;
  historyAvailableFrom: string | null;
  lastSuccessfulSyncAt: string | null;
  status: ConnectionStatus;
};

/** Roles that may connect accounts (ADR-0007). */
export const CONNECT_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];

/** Accounts of the current project + a way to start connecting a platform. */
export function useProjectAccounts() {
  const { workspace, project } = useWorkspace();
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;

  const reload = useCallback(async () => {
    if (!base) return;
    setAccounts(await api<SocialAccount[]>(`${base}/accounts`).catch(() => []));
  }, [base]);

  useEffect(() => {
    if (!base) return;
    let cancelled = false; // ignore a late response after switching projects
    api<SocialAccount[]>(`${base}/accounts`).then(
      (list) => !cancelled && setAccounts(list),
      () => !cancelled && setAccounts([]),
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  /** Sends the browser to the platform's consent page; it comes back to /accounts?connect=… */
  const connect = useCallback(
    async (platform: 'pinterest') => {
      if (!base) return;
      const { url } = await api<{ url: string }>(`${base}/connections/${platform}`, {
        method: 'POST',
      });
      window.location.assign(url);
    },
    [base],
  );

  return {
    accounts,
    reload,
    connect,
    canConnect: !!workspace && CONNECT_ROLES.includes(workspace.role),
  };
}
