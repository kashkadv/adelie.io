import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="animate-rise mb-6 md:mb-8">
      <h1 className="text-3xl font-semibold md:text-[40px] md:leading-[1.1]">{title}</h1>
      {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
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
      className="glass animate-rise flex flex-col items-center gap-4 rounded-[28px] px-6 py-14 text-center"
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
