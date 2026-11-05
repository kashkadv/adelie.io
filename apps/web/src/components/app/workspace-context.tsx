'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';
export type WorkspaceSummary = { id: string; name: string; role: Role };
export type Project = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  reportLocale: string;
};
export type WorkspaceDetail = WorkspaceSummary & { projects: Project[] };

type WorkspaceState = {
  workspaces: WorkspaceSummary[] | null;
  workspace: WorkspaceDetail | null;
  project: Project | null;
  selectWorkspace: (id: string) => void;
  selectProject: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

const WORKSPACE_KEY = 'adelie-workspace';
const projectKey = (workspaceId: string) => `adelie-project:${workspaceId}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the selection still applies for this session.
  }
}

/** Current workspace and project for the signed-in user; the choice is remembered per browser. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const loadWorkspace = useCallback(async (id: string) => {
    const detail = await api<WorkspaceDetail>(`/workspaces/${id}`);
    const saved = read(projectKey(id));
    setWorkspace(detail);
    setProjectId(detail.projects.find((p) => p.id === saved)?.id ?? detail.projects[0]?.id ?? null);
  }, []);

  useEffect(() => {
    api<WorkspaceSummary[]>('/workspaces').then(
      (list) => {
        setWorkspaces(list);
        const saved = read(WORKSPACE_KEY);
        const initial = list.find((w) => w.id === saved) ?? list[0];
        if (initial) void loadWorkspace(initial.id);
      },
      () => setWorkspaces([]),
    );
  }, [loadWorkspace]);

  const selectWorkspace = useCallback(
    (id: string) => {
      write(WORKSPACE_KEY, id);
      void loadWorkspace(id);
    },
    [loadWorkspace],
  );

  const selectProject = useCallback(
    (id: string) => {
      if (!workspace) return;
      write(projectKey(workspace.id), id);
      setProjectId(id);
    },
    [workspace],
  );

  const project = workspace?.projects.find((p) => p.id === projectId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{ workspaces, workspace, project, selectWorkspace, selectProject }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return value;
}
