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
  /** The latest sync run, or null before the first one starts. */
  lastSync: {
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'REAUTHORIZATION_REQUIRED';
    kind: 'INITIAL' | 'DAILY' | 'MANUAL' | 'RETRY';
    errorCode: string | null;
    finishedAt: string | null;
  } | null;
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

export type Invitation = {
  id: string;
  platform: 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK';
  url: string;
  expiresAt: string;
  createdAt: string;
  createdBy: string | null;
};

/** Pending connect invitations of the current project (ADR-0012); empty for roles without access. */
export function useProjectInvitations() {
  const { workspace, project } = useWorkspace();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;
  const allowed = !!workspace && CONNECT_ROLES.includes(workspace.role);

  const load = useCallback(async () => {
    if (!base || !allowed) return [];
    return api<Invitation[]>(`${base}/invitations`).catch(() => []);
  }, [base, allowed]);

  useEffect(() => {
    let cancelled = false;
    load().then((list) => !cancelled && setInvitations(list));
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** Creates an invitation and returns its link. */
  const create = useCallback(
    async (platform: 'pinterest') => {
      if (!base) throw new Error('No project');
      const invitation = await api<Invitation>(`${base}/invitations`, {
        method: 'POST',
        json: { platform },
      });
      setInvitations(await load());
      return invitation.url;
    },
    [base, load],
  );

  const revoke = useCallback(
    async (id: string) => {
      if (!base) return;
      await api(`${base}/invitations/${id}`, { method: 'DELETE' });
      setInvitations((list) => list.filter((i) => i.id !== id));
    },
    [base],
  );

  return { invitations, create, revoke };
}
