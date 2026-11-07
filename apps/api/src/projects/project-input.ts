import { isValidTimezone } from '../profile/profile-input.js';

export const PROJECT_NAME_MAX = 80;
/** Languages a shared report can be rendered in (the interface locales, ADR-0006). */
export const REPORT_LOCALES = ['en', 'uk'] as const;

export type ProjectErrorCode =
  'required' | 'tooLong' | 'invalidTimezone' | 'invalidCurrency' | 'invalidLocale' | 'invalidType';

export interface ProjectSettings {
  name: string;
  timezone: string;
  currency: string;
  reportLocale: string;
}

export type ProjectField = keyof ProjectSettings;

export type ProjectParseResult =
  | { ok: true; data: Partial<ProjectSettings> }
  | { ok: false; errors: Partial<Record<ProjectField, ProjectErrorCode>> };

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/**
 * Validates project settings. `requireName` for creation; on update every field is optional and
 * only the ones present change.
 */
export function parseProjectInput(body: unknown, requireName: boolean): ProjectParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: {} };
  }
  const input = body as Record<string, unknown>;
  const errors: Partial<Record<ProjectField, ProjectErrorCode>> = {};
  const data: Partial<ProjectSettings> = {};

  const name = input['name'];
  if (name === undefined) {
    if (requireName) errors.name = 'required';
  } else if (typeof name !== 'string') errors.name = 'invalidType';
  else if (!name.trim()) errors.name = 'required';
  else if (name.trim().length > PROJECT_NAME_MAX) errors.name = 'tooLong';
  else data.name = name.trim().replace(/\s+/g, ' ');

  const timezone = input['timezone'];
  if (timezone !== undefined) {
    if (typeof timezone !== 'string') errors.timezone = 'invalidType';
    else if (!timezone || !isValidTimezone(timezone)) errors.timezone = 'invalidTimezone';
    else data.timezone = timezone;
  }

  const currency = input['currency'];
  if (currency !== undefined) {
    if (typeof currency !== 'string') errors.currency = 'invalidType';
    else if (!CURRENCIES.has(currency.toUpperCase())) errors.currency = 'invalidCurrency';
    else data.currency = currency.toUpperCase();
  }

  const reportLocale = input['reportLocale'];
  if (reportLocale !== undefined) {
    if (typeof reportLocale !== 'string') errors.reportLocale = 'invalidType';
    else if (!(REPORT_LOCALES as readonly string[]).includes(reportLocale)) {
      errors.reportLocale = 'invalidLocale';
    } else data.reportLocale = reportLocale;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}
