'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from './workspace-context';

/** Current project (and workspace) with a popover to switch between them. */
export function ProjectSwitcher() {
  const t = useTranslations('Nav');
  const tRoles = useTranslations('Roles');
  const { workspaces, workspace, project, selectProject, selectWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = project?.name ?? '…';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full max-w-72 items-center gap-3 rounded-2xl py-1.5 pr-3 pl-1.5 text-left transition-colors duration-200 hover:bg-hover"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent font-display text-sm font-semibold text-accent-foreground">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted">{workspace?.name ?? ''}</span>
        </span>
        <ChevronsUpDown className="shrink-0 text-muted" size={16} aria-hidden="true" />
      </button>

      {open && workspace && (
        <div
          role="menu"
          className="glass glass-strong animate-rise absolute top-full left-0 z-40 mt-2 w-64 rounded-2xl p-2"
        >
          <p className="px-3 pt-1 pb-2 text-xs uppercase tracking-wide text-muted">
            {t('projects')}
          </p>
          {workspace.projects.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              onClick={() => {
                selectProject(p.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
            >
              <span className="truncate">{p.name}</span>
              {p.id === project?.id && <Check size={16} aria-hidden="true" />}
            </button>
          ))}

          {workspaces && workspaces.length > 1 && (
            <>
              <div className="my-2 h-px bg-line" />
              <p className="px-3 pt-1 pb-2 text-xs uppercase tracking-wide text-muted">
                {t('workspaces')}
              </p>
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    selectWorkspace(w.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
                >
                  <span className="truncate">{w.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {w.id === workspace.id ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      tRoles(w.role)
                    )}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
