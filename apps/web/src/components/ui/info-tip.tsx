'use client';

import { Info } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const GAP = 8;
const MARGIN = 12;

/**
 * A small icon whose explanation appears on hover or keyboard focus; a click pins it open (touch
 * screens have no hover), a click outside or Escape closes it.
 * - `tone="info"` (default): circled "i" next to a label — instead of captions under fields (rules.md §6).
 * - `tone="warning"`: amber circle with "!" next to a status — instead of warning banners.
 *
 * The popover is portalled to <body> with fixed positioning, so scroll containers and rounded panels
 * never clip it. It opens above the icon, or below when there is no room above, and stays inside
 * the viewport horizontally. Its typography is reset, so it never inherits e.g. an uppercase label.
 */
export function InfoTip({
  text,
  title,
  tone = 'info',
  lines,
  trigger,
  triggerClassName,
}: {
  text: string;
  /** Optional bold first line (used for warnings: what happened, then `text`: what to do). */
  title?: string;
  tone?: 'info' | 'warning';
  /** Instead of one paragraph: a list, each item with an optional coloured dot. */
  lines?: { text: string; dotClassName?: string }[];
  /** Instead of the "i" icon: any content (e.g. a coloured counter); `text` stays its label. */
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const open = hovered || pinned;

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

  // Measure after the popover is in the DOM, before paint (no flicker).
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

  // A pinned popover closes on a click elsewhere.
  useEffect(() => {
    if (!pinned) return;
    const onPointer = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [pinned]);

  const close = () => {
    setHovered(false);
    setPinned(false);
    setPos(null);
  };

  const warning = tone === 'warning';
  return (
    <span className="inline-flex align-middle">
      <button
        ref={anchor}
        type="button"
        aria-label={title ? `${title} ${text}` : text}
        aria-describedby={open ? id : undefined}
        aria-expanded={pinned}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        className={
          trigger
            ? `inline-flex items-center gap-1 rounded-full transition-colors duration-200 ${triggerClassName ?? ''}`
            : warning
              ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-xs leading-none font-bold text-amber-700 transition-colors duration-200 hover:bg-amber-500/25 dark:text-amber-400'
              : 'inline-flex rounded-full text-muted transition-colors duration-200 hover:text-foreground focus-visible:text-foreground'
        }
      >
        {trigger ? (
          trigger
        ) : warning ? (
          // Same height as a status badge (24px); a plain "!" reads lighter than a triangle icon.
          <span aria-hidden="true">!</span>
        ) : (
          <Info size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
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
            {title && <span className="mb-1 block font-semibold">{title}</span>}
            {lines ? (
              <span className="grid gap-1">
                {lines.map((l) => (
                  <span key={l.text} className="flex items-start gap-2">
                    {l.dotClassName && (
                      <span
                        aria-hidden="true"
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${l.dotClassName}`}
                      />
                    )}
                    <span>{l.text}</span>
                  </span>
                ))}
              </span>
            ) : (
              text
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}
