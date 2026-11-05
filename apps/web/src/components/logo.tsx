/** Adelie penguin mark + wordmark. The mark uses currentColor (dark on light, white on dark). */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="190.257 -0.286 465.206 520.464" className="h-6 w-auto" aria-hidden="true">
        <use href="/logo.svg#mark" />
      </svg>
      Adelie
    </span>
  );
}
