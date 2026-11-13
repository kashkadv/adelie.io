// Holidays and shopping events by market (ADR-0032, stage 2): what falls into a season, with the
// last day to order for delivery before the gift-giving ones. Dates that move (Thanksgiving,
// Mother's Day, Easter) are computed. Pure and unit-tested; extend the list as markets grow.

export interface MarketEvent {
  key: string;
  /** English name (the AI writes in English; the UI shows it as is). */
  name: string;
  date: string;
  /** Countries where it matters. */
  countries: string[];
  /**
   * People give presents on the day: a delivery deadline applies. Shopping events (Black Friday)
   * are when people buy — no deadline of their own.
   */
  gift: boolean;
  /** A shopping event (sales, deals) rather than a holiday. */
  shopping?: boolean;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The n-th weekday (0 = Sunday) of a month; n = -1 for the last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
export function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const ALL = ['*'];
const EU_NICHOLAS = ['DE', 'AT', 'CH', 'NL', 'BE', 'LU', 'PL', 'CZ', 'SK', 'HU', 'UA'];
const BOXING = ['GB', 'IE', 'CA', 'AU', 'NZ'];
const ANGLO = ['US', 'CA', 'GB', 'IE', 'AU', 'NZ'];
/** Hanukkah's first day moves with the Hebrew calendar: a table for the years ahead. */
const HANUKKAH: Record<number, string> = {
  2025: '2025-12-14',
  2026: '2026-12-04',
  2027: '2027-12-24',
  2028: '2028-12-12',
};

/** The events of one year. */
export function eventsOfYear(y: number): MarketEvent[] {
  const thanksgiving = iso(y, 11, nthWeekday(y, 11, 4, 4));
  const e = easter(y);
  const list: MarketEvent[] = [
    { key: 'valentines', name: "Valentine's Day", date: iso(y, 2, 14), countries: ALL, gift: true },
    {
      key: 'womens_day',
      name: "International Women's Day",
      date: iso(y, 3, 8),
      countries: ['UA', 'PL', 'IT', 'DE', 'CZ', 'SK', 'HU', 'RO'],
      gift: true,
    },
    {
      key: 'mothering_sunday',
      name: 'Mothering Sunday (UK)',
      date: addDays(e, -21),
      countries: ['GB', 'IE'],
      gift: true,
    },
    { key: 'easter', name: 'Easter', date: e, countries: ALL, gift: false },
    {
      key: 'mothers_day',
      name: "Mother's Day",
      date: iso(y, 5, nthWeekday(y, 5, 0, 2)),
      countries: ['US', 'CA', 'AU', 'NZ', 'DE', 'AT', 'CH', 'NL', 'BE', 'IT', 'UA', 'DK', 'FI'],
      gift: true,
    },
    {
      key: 'fathers_day',
      name: "Father's Day",
      date: iso(y, 6, nthWeekday(y, 6, 0, 3)),
      countries: ['US', 'CA', 'GB', 'IE', 'NL', 'FR'],
      gift: true,
    },
    {
      key: 'back_to_school',
      name: 'Back to school',
      date: iso(y, 8, 15),
      countries: ['US', 'CA'],
      gift: false,
      shopping: true,
    },
    { key: 'halloween', name: 'Halloween', date: iso(y, 10, 31), countries: ANGLO, gift: false },
    {
      key: 'singles_day',
      name: "Singles' Day sales",
      date: iso(y, 11, 11),
      countries: ['PL', 'DE', 'NL'],
      gift: false,
      shopping: true,
    },
    {
      key: 'thanksgiving',
      name: 'Thanksgiving',
      date: thanksgiving,
      countries: ['US'],
      gift: false,
    },
    {
      key: 'black_friday',
      name: 'Black Friday',
      date: addDays(thanksgiving, 1),
      countries: ALL,
      gift: false,
      shopping: true,
    },
    {
      key: 'small_business_saturday',
      name: 'Small Business Saturday',
      date: addDays(thanksgiving, 2),
      countries: ['US', 'GB'],
      gift: false,
      shopping: true,
    },
    {
      key: 'cyber_monday',
      name: 'Cyber Monday',
      date: addDays(thanksgiving, 4),
      countries: ALL,
      gift: false,
      shopping: true,
    },
    {
      key: 'st_nicholas',
      name: "St Nicholas' Day",
      date: iso(y, 12, 6),
      countries: EU_NICHOLAS,
      gift: true,
    },
    { key: 'christmas', name: 'Christmas', date: iso(y, 12, 25), countries: ALL, gift: true },
    {
      key: 'boxing_day',
      name: 'Boxing Day sales',
      date: iso(y, 12, 26),
      countries: BOXING,
      gift: false,
      shopping: true,
    },
    {
      key: 'new_year',
      name: "New Year's Day",
      date: iso(y + 1, 1, 1),
      countries: ALL,
      gift: false,
    },
  ];
  if (HANUKKAH[y]) {
    list.push({
      key: 'hanukkah',
      name: 'Hanukkah (first day)',
      date: HANUKKAH[y],
      countries: ['US', 'CA', 'GB'],
      gift: true,
    });
  }
  return list;
}

/**
 * The events between two days that matter in the given markets, each with the last day to order
 * for delivery when it is a gift-giving one (delivery days + 2 days to make and send).
 */
export function eventsIn(
  markets: string[],
  from: string,
  to: string,
  deliveryDays: number | null,
): (MarketEvent & { orderBy: string | null })[] {
  const years = [Number(from.slice(0, 4)) - 1, Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  const seen = new Set<string>();
  return [...new Set(years)]
    .flatMap(eventsOfYear)
    .filter((e) => e.date >= from && e.date <= to)
    .filter((e) => e.countries.includes('*') || e.countries.some((c) => markets.includes(c)))
    .filter((e) => !seen.has(`${e.key}${e.date}`) && seen.add(`${e.key}${e.date}`))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => ({
      ...e,
      countries: e.countries.includes('*')
        ? e.countries
        : e.countries.filter((c) => markets.includes(c)),
      orderBy: e.gift && deliveryDays ? addDays(e.date, -(deliveryDays + 2)) : null,
    }));
}
