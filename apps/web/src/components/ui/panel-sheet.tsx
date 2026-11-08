'use client';

import type { ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';

/** Id of the layer over the content panel (app-frame.tsx) that sheets open in. */
export const PANEL_LAYER_ID = 'panel-layer';

/**
 * A detail view that takes exactly the place of the content panel — same size, position and
 * corners — while the header and sidebar stay visible: "a page over the page". Falls back to the
 * whole window where there is no panel (e.g. outside the app frame).
 */
export function PanelSheet({
  labelledBy,
  panelRef,
  children,
}: {
  labelledBy: string;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const layer = typeof document === 'undefined' ? null : document.getElementById(PANEL_LAYER_ID);
  const sheet = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={`content-panel animate-rise pointer-events-auto flex flex-col overflow-hidden rounded-[32px] outline-none ${
        layer ? 'absolute inset-0' : 'fixed inset-3 z-[90]'
      }`}
    >
      {children}
    </div>
  );
  return createPortal(sheet, layer ?? document.body);
}
