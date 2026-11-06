'use client';

import { Info } from 'lucide-react';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const GAP = 8;
const MARGIN = 12;

/**
 * Circled "i" next to a label; the explanation appears on hover or keyboard focus.
 * Used instead of captions under fields (rules.md §6).
 *
 * The tooltip is portalled to <body> with fixed positioning, so scroll containers and rounded panels
 * never clip it. It opens above the icon, or below when there is no room above, and is kept inside
 * the viewport horizontally. Its typography is reset, so it never inherits e.g. an uppercase label.
 */
export function InfoTip({ text }: { text: string }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const t = tip.current?.getBoundingClientRect();
    if (!a || !t) return;
    const below = a.top - t.height - GAP < MARGIN;
    const top = below ? a.bottom + GAP : a.top - t.height - GAP;
    const centered = a.left + a.width / 2 - t.width / 2;
    const left = Math.min(Math.max(centered, MARGIN), window.innerWidth - t.width - MARGIN);
    setPos({ top, left, below });
  }, []);

  // Measure after the tooltip is in the DOM, before paint (no flicker).
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <span className="inline-flex align-middle">
      <button
        ref={anchor}
        type="button"
        aria-label={text}
        aria-describedby={open ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
        className="inline-flex rounded-full text-muted transition-colors duration-200 hover:text-foreground focus-visible:text-foreground"
      >
        <Info size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <span
            ref={tip}
            id={id}
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={`pointer-events-none z-[100] w-max max-w-72 rounded-xl bg-accent px-3 py-2 text-left text-xs leading-snug font-normal tracking-normal text-accent-foreground normal-case shadow-[0_8px_24px_-8px_var(--shadow)] ${
              pos ? (pos.below ? 'animate-tip-below' : 'animate-tip-above') : ''
            }`}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
