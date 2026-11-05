/** Adelie penguin mark + wordmark. The mark uses currentColor (dark on light, white on dark). */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-semibold tracking-tight ${className}`}>
      {/* Explicit size with the mark's aspect ratio (465:520) — w-auto clips the right wing. */}
      <svg
        viewBox="0 0 465.206 520.464"
        className="shrink-0"
        style={{ height: '1.35em', width: `${1.35 * (465.206 / 520.464)}em` }}
        aria-hidden="true"
      >
        <use href="/logo.svg#mark" />
      </svg>
      Adelie
    </span>
  );
}
