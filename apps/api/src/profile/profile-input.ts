// Validation and normalization of personal settings (ADR-0010). Pure functions — unit-tested.
// Error codes are stable strings; the web app maps them to translated messages.

export type ProfileErrorCode =
  | 'tooLong'
  | 'invalidEmail'
  | 'invalidPhone'
  | 'invalidTelegram'
  | 'invalidLinkedin'
  | 'invalidTimezone'
  | 'invalidDays'
  | 'invalidTime'
  | 'timeRequired'
  | 'endBeforeStart'
  | 'invalidType';

export interface ProfileUpdate {
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
  viber?: string | null;
  linkedin?: string | null;
  timezone?: string | null;
  workDays?: number[];
  workStart?: string | null;
  workEnd?: string | null;
}

export type ParseResult =
  | { ok: true; data: ProfileUpdate }
  | { ok: false; errors: Partial<Record<keyof ProfileUpdate, ProfileErrorCode>> };

const TEXT_LIMITS = { firstName: 80, lastName: 80, jobTitle: 120 } as const;
const PHONE_FIELDS = ['phone', 'whatsapp', 'viber'] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims; empty → null. Non-strings are a type error (undefined = field not sent). */
function text(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Phone-like value: digits with optional +, spaces, dashes, parentheses; 7–15 digits. */
export function normalizePhone(value: string): string | null {
  if (!/^\+?[\d\s()-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (value.trim().startsWith('+') ? '+' : '') + digits;
}

/** Accepts "@name", "name", "t.me/name", "https://t.me/name"; returns the bare username. */
export function normalizeTelegram(value: string): string | null {
  const name = value
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(t|telegram)\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '');
  return /^[A-Za-z0-9_]{5,32}$/.test(name) ? name : null;
}

/** Accepts linkedin.com profile/company URLs with or without scheme; returns an https URL. */
export function normalizeLinkedin(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase();
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
    if (url.pathname === '/' || url.pathname === '') return null;
    url.protocol = 'https:';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseProfileUpdate(input: unknown): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: {} };
  }
  const body = input as Record<string, unknown>;
  const data: ProfileUpdate = {};
  const errors: Partial<Record<keyof ProfileUpdate, ProfileErrorCode>> = {};

  for (const [field, limit] of Object.entries(TEXT_LIMITS) as [
    keyof typeof TEXT_LIMITS,
    number,
  ][]) {
    const v = text(body[field]);
    if (v === false) errors[field] = 'invalidType';
    else if (v && v.length > limit) errors[field] = 'tooLong';
    else if (v !== undefined) data[field] = v;
  }

  const email = text(body['contactEmail']);
  if (email === false) errors.contactEmail = 'invalidType';
  else if (email && (email.length > 254 || !EMAIL.test(email)))
    errors.contactEmail = 'invalidEmail';
  else if (email !== undefined) data.contactEmail = email?.toLowerCase() ?? null;

  for (const field of PHONE_FIELDS) {
    const v = text(body[field]);
    if (v === false) errors[field] = 'invalidType';
    else if (v === null || v === undefined) {
      if (v === null) data[field] = null;
    } else {
      const phone = normalizePhone(v);
      if (phone) data[field] = phone;
      else errors[field] = 'invalidPhone';
    }
  }

  const telegram = text(body['telegram']);
  if (telegram === false) errors.telegram = 'invalidType';
  else if (telegram) {
    const name = normalizeTelegram(telegram);
    if (name) data.telegram = name;
    else errors.telegram = 'invalidTelegram';
  } else if (telegram === null) data.telegram = null;

  const linkedin = text(body['linkedin']);
  if (linkedin === false) errors.linkedin = 'invalidType';
  else if (linkedin) {
    const url = normalizeLinkedin(linkedin);
    if (url) data.linkedin = url;
    else errors.linkedin = 'invalidLinkedin';
  } else if (linkedin === null) data.linkedin = null;

  const timezone = text(body['timezone']);
  if (timezone === false) errors.timezone = 'invalidType';
  else if (timezone && !isValidTimezone(timezone)) errors.timezone = 'invalidTimezone';
  else if (timezone !== undefined) data.timezone = timezone;

  if (body['workDays'] !== undefined) {
    const days = body['workDays'];
    const valid = Array.isArray(days) && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    if (valid) data.workDays = [...new Set(days as number[])].sort((a, b) => a - b);
    else errors.workDays = 'invalidDays';
  }

  const start = text(body['workStart']);
  const end = text(body['workEnd']);
  if (start === false) errors.workStart = 'invalidType';
  else if (start && !TIME.test(start)) errors.workStart = 'invalidTime';
  if (end === false) errors.workEnd = 'invalidType';
  else if (end && !TIME.test(end)) errors.workEnd = 'invalidTime';
  if (!errors.workStart && !errors.workEnd && (start !== undefined || end !== undefined)) {
    if (!start !== !end) errors[start ? 'workEnd' : 'workStart'] = 'timeRequired';
    else if (start && end && end <= start) errors.workEnd = 'endBeforeStart';
    else {
      // Type errors were handled above, so here start/end are a time string or null.
      data.workStart = start || null;
      data.workEnd = end || null;
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

/** The display name Better Auth keeps in user.name. */
export function fullName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ');
}

/** Initial first/last name for a user who has no profile yet. */
export function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  return { firstName: first || null, lastName: rest.join(' ') || null };
}
