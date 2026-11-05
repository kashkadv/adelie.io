'use client';

import { useState } from 'react';
import { avatarUrl, initials, type Me } from './me-context';

/** Round avatar: the photo if there is one (and it loads), otherwise initials on the accent color. */
export function Avatar({
  me,
  fallback,
  size = 36,
}: {
  me: Me | null;
  fallback: { name: string; email: string };
  size?: number;
}) {
  const url = me ? avatarUrl(me) : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size };

  if (url && url !== failedUrl) {
    // Plain <img>: the photo comes from the API with the session cookie, not via next/image.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        style={style}
        className="rounded-full object-cover"
        onError={() => setFailedUrl(url)}
      />
    );
  }
  return (
    <span
      style={{ ...style, fontSize: Math.round(size / 3) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground"
    >
      {initials(me?.name ?? fallback.name, me?.email ?? fallback.email)}
    </span>
  );
}
