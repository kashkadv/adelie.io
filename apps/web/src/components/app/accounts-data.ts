'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from './workspace-context';

/** URL slug of a platform that can be connected. */
export type PlatformSlug = 'pinterest' | 'instagram' | 'etsy';

export type ConnectionStatus = 'ACTIVE' | 'REAUTHORIZATION_REQUIRED' | 'REVOKED';

export type SocialAccount = {
  id: string;
  platform: 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK' | 'ETSY';
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
  /** Hidden from Overview/Content by a member; syncing goes on. */
  hidden: boolean;
  /** "Sync now" was asked for and the worker has not picked it up yet. */
  syncRequested: boolean;
  /** When "Sync now" becomes available again; null = available. */
  manualSyncAt: string | null;
  /** Read-only or full access (ADR-0019); null where the platform has no levels. */
  access: 'read' | 'write' | null;
  /** Features this connection lacks a permission for (e.g. `audience`): "update access". */
  missingFeatures: string[];
  /** The latest sync run, or null before the first one starts. */
  lastSync: {
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'REAUTHORIZATION_REQUIRED';
    kind: 'INITIAL' | 'DAILY' | 'MANUAL' | 'RETRY';
    errorCode: string | null;
    finishedAt: string | null;
  } | null;
};

/** A sync is queued or running (or the very first one has not started yet). */
export function isSyncing(a: SocialAccount): boolean {
  if (a.status !== 'ACTIVE') return false;
  return (
    a.syncRequested ||
    !a.lastSync ||
    a.lastSync.status === 'PENDING' ||
    a.lastSync.status === 'RUNNING'
  );
}

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

  // While something is syncing, refresh every few seconds so the status and dates update by themselves.
  const syncing = !!accounts?.some(isSyncing);
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [syncing, reload]);

  /** Asks the worker to sync the account now (picked up within a minute). */
  const requestSync = useCallback(
    async (accountId: string) => {
      if (!base) return;
      await api(`${base}/accounts/${accountId}/sync`, { method: 'POST' });
      await reload();
    },
    [base, reload],
  );

  /** Sends the browser to the platform's consent page; it comes back to /connections?connect=… */
  const connect = useCallback(
    async (platform: PlatformSlug, access?: 'read' | 'write', accountId?: string) => {
      if (!base) return;
      const { url } = await api<{ url: string }>(`${base}/connections/${platform}`, {
        method: 'POST',
        // accountId: updating that account's access — consent must come from it (ADR-0020).
        json: { ...(access ? { access } : {}), ...(accountId ? { accountId } : {}) },
      });
      window.location.assign(url);
    },
    [base],
  );

  /** Stops syncing and erases the tokens; the collected history stays. */
  const disconnect = useCallback(
    async (accountId: string) => {
      if (!base) return;
      await api(`${base}/accounts/${accountId}/disconnect`, { method: 'POST' });
      await reload();
    },
    [base, reload],
  );

  /** Hides the account from Overview/Content, or shows it again. */
  const setHidden = useCallback(
    async (accountId: string, hidden: boolean) => {
      if (!base) return;
      await api(`${base}/accounts/${accountId}`, { method: 'PATCH', json: { hidden } });
      await reload();
    },
    [base, reload],
  );

  /** Deletes the account with all its data; `confirm` must repeat the account name. */
  const remove = useCallback(
    async (accountId: string, confirm: string) => {
      if (!base) return;
      await api(`${base}/accounts/${accountId}`, { method: 'DELETE', json: { confirm } });
      await reload();
    },
    [base, reload],
  );

  return {
    accounts,
    reload,
    connect,
    disconnect,
    requestSync,
    setHidden,
    remove,
    canConnect: !!workspace && CONNECT_ROLES.includes(workspace.role),
  };
}

export type Invitation = {
  id: string;
  platform: 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK' | 'ETSY';
  access: 'read' | 'write';
  /** Set when the invitation updates access of a connected account (ADR-0020). */
  account: { username: string | null; displayName: string | null } | null;
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
    async (platform: PlatformSlug, access?: 'read' | 'write', accountId?: string) => {
      if (!base) throw new Error('No project');
      const invitation = await api<Invitation>(`${base}/invitations`, {
        method: 'POST',
        json: { platform, ...(access ? { access } : {}), ...(accountId ? { accountId } : {}) },
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
