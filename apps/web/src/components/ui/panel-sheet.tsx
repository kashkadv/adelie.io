'use client';

import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';

/** Id of the element that marks the content panel's place (app-frame.tsx). */
export const PANEL_LAYER_ID = 'panel-layer';

type Box = { top: number; left: number; width: number; height: number };

/** The content panel's place on screen, kept up to date on resize and sidebar toggles. */
function usePanelBox(): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const el = document.getElementById(PANEL_LAYER_ID);
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return box;
}

/**
 * A detail view that takes exactly the place of the content panel — same size, position and
 * corners — over a blurred backdrop of everything around it (header, sidebar). A click on the
 * backdrop closes it. Without a panel (outside the app frame) it fills the window with a margin.
 */
export function PanelSheet({
  labelledBy,
  panelRef,
  onClose,
  closeLabel,
  children,
}: {
  labelledBy: string;
  panelRef?: Ref<HTMLDivElement>;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  const box = usePanelBox();
  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={box ?? undefined}
        className={`glass glass-strong animate-rise absolute flex flex-col overflow-hidden rounded-[32px] outline-none ${
          box ? '' : 'inset-3'
        }`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
