import type { SelectOption } from '@/components/ui/select';

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "UTC+2", "UTC−3:30", "UTC" for a time zone right now. */
export function utcOffset(zone: string): string {
  const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
  return (part ?? '').replace('GMT', 'UTC').replace('-', '−');
}

/** All IANA time zones as select options with their current UTC offset; `current` is kept even if
 *  the runtime does not list it. */
export function timezoneOptions(current?: string): SelectOption[] {
  const list = Intl.supportedValuesOf('timeZone');
  const extra = [current, browserTimezone()].filter((z): z is string => !!z && !list.includes(z));
  return [...new Set([...extra, ...list])].map((z) => ({
    value: z,
    label: z.replaceAll('_', ' '),
    hint: utcOffset(z),
  }));
}
