'use client';

import type { ReactNode } from 'react';
import { InfoTip } from './info-tip';

/** A card section of a settings form. */
export function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <section
      className="card animate-rise rounded-[24px] p-5 md:p-6"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Same left line as field labels: the field corner radius (14px). */}
      <h2 className="mb-4 px-3.5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A labelled form field (ADR-0009): label and error are offset by the field radius. */
export function Field({
  label,
  error,
  hint,
  group = false,
  children,
}: {
  label: string;
  error?: string;
  /** Explanation shown in an info tooltip next to the label — never as a caption under the field. */
  hint?: string;
  /** Custom controls (Select): a plain block, so clicks inside the popover are not redirected. */
  group?: boolean;
  children: ReactNode;
}) {
  const Wrapper = group ? 'div' : 'label';
  return (
    // Label and error start where the field's corner radius (14px) ends.
    <Wrapper className="block">
      <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      {children}
      {error && (
        <span role="alert" className="mt-1 block px-3.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </Wrapper>
  );
}
