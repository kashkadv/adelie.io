import type { ReactNode } from 'react';

/** Page title and subtitle; `action` sits in the top-right corner (e.g. a primary button or menu). */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    // z-10: popovers opened from `action` stay above the cards below.
    <header className="animate-rise relative z-10 mb-5 flex flex-wrap items-start justify-between gap-4 md:mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-semibold md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** Glass card with an icon, title, text and optional action — for sections without data yet. */
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <section
      className="card animate-rise flex flex-col items-center gap-4 rounded-[28px] px-6 py-14 text-center"
      style={{ animationDelay: '80ms' }}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        {icon}
      </span>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="max-w-md text-muted">{text}</p>
      {action}
    </section>
  );
}
