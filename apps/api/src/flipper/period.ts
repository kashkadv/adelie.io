/** The moment today began in the project's time zone (a shop's day is its own, not UTC's). */
export function startOfToday(timeZone: string, now = new Date()): Date {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(now)
        .map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    const local = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const offset = local - Math.floor(now.getTime() / 1000) * 1000;
    return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!) - offset);
  } catch {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}

/** A period from the query: "today" (since local midnight) or the last 7, 30 or 90 days. */
export function periodOf(days: string | undefined, timeZone: string, now = new Date()) {
  if (days === 'today') return { n: 1, since: startOfToday(timeZone, now) };
  const n = [7, 30, 90].includes(Number(days)) ? Number(days) : 7;
  return { n, since: new Date(now.getTime() - n * 86_400_000) };
}
