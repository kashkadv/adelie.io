const MARK_VIEWBOX = '0 0 465.206 520.464';

/** The penguin mark (from /logo.svg) + optional "Adelie" wordmark. */
export function BrandMark({ className = 'h-8 w-7' }: { className?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} aria-hidden="true" className={`shrink-0 ${className}`}>
      <use href="/logo.svg#mark" />
    </svg>
  );
}
