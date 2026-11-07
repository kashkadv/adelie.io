'use client';

import { Camera, Check, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { resizeToSquare } from '@/lib/resize-image';
import { browserTimezone, timezoneOptions } from '@/lib/timezones';
import { Field, Section } from '../ui/form';
import { Select, type SelectOption } from '../ui/select';
import { LocaleSwitcher } from '../locale-switcher';
import { ThemeToggle } from '../theme-toggle';
import { Avatar } from './avatar';
import { useMe, type Me, type Profile } from './me-context';
import { PageHeader } from './page-header';

type TextField =
  | 'firstName'
  | 'lastName'
  | 'jobTitle'
  | 'contactEmail'
  | 'phone'
  | 'telegram'
  | 'whatsapp'
  | 'viber'
  | 'linkedin'
  | 'timezone'
  | 'workStart'
  | 'workEnd';
type Form = Record<TextField, string> & { workDays: number[] };
type Errors = Partial<Record<TextField | 'workDays' | 'avatar', string>>;

const CONTACTS: { field: TextField; type: string; placeholder: string }[] = [
  { field: 'contactEmail', type: 'email', placeholder: 'name@company.com' },
  { field: 'phone', type: 'tel', placeholder: '+380 67 123 45 67' },
  { field: 'telegram', type: 'text', placeholder: '@username' },
  { field: 'whatsapp', type: 'tel', placeholder: '+380 67 123 45 67' },
  { field: 'viber', type: 'tel', placeholder: '+380 67 123 45 67' },
  { field: 'linkedin', type: 'url', placeholder: 'linkedin.com/in/username' },
];

function toForm(p: Profile): Form {
  const s = (v: string | null | undefined) => v ?? '';
  return {
    firstName: s(p.firstName),
    lastName: s(p.lastName),
    jobTitle: s(p.jobTitle),
    contactEmail: s(p.contactEmail),
    phone: s(p.phone),
    telegram: p.telegram ? `@${p.telegram}` : '',
    whatsapp: s(p.whatsapp),
    viber: s(p.viber),
    linkedin: s(p.linkedin),
    // Not set yet → suggest the browser's time zone (saved only with the form).
    timezone: p.timezone || browserTimezone(),
    workStart: s(p.workStart),
    workEnd: s(p.workEnd),
    workDays: p.workDays,
  };
}

/** Working-hours options every 30 minutes. */
const TIMES: SelectOption[] = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  return { value, label: value };
});

/** Personal settings page (/me): profile, contacts, working hours, sign-in, interface. */
export function PersonalSettings() {
  const { me } = useMe();
  if (!me) return <PageHeader title="…" />;
  return <PersonalSettingsForm key={me.id} me={me} />;
}

function PersonalSettingsForm({ me }: { me: Me }) {
  const t = useTranslations('Profile');
  const locale = useLocale();
  const { setMe } = useMe();
  const [form, setForm] = useState<Form>(() => toForm(me.profile));
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const timezones = useMemo(() => timezoneOptions(form.timezone), [form.timezone]);

  // Mon…Sun names in the UI language (2024-01-01 was a Monday).
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    return [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      day: d,
      label: format.format(new Date(Date.UTC(2024, 0, d))),
    }));
  }, [locale]);

  const set = (field: TextField) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setStatus('idle');
  };

  const errorText = (code?: string) =>
    code ? t(`errors.${code}` as 'errors.invalidType') : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('saving');
    try {
      const updated = await api<Me>('/me/profile', { method: 'PATCH', json: form });
      setMe(updated);
      setForm(toForm(updated.profile));
      setErrors({});
      setStatus('saved');
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { errors?: Errors } | null) : null;
      setErrors(body?.errors ?? {});
      setStatus('error');
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setAvatarBusy(true);
    setErrors((e) => ({ ...e, avatar: undefined }));
    try {
      const dataUrl = await resizeToSquare(file);
      const { avatarUpdatedAt } = await api<{ avatarUpdatedAt: string }>('/me/avatar', {
        method: 'PUT',
        json: { dataUrl },
      });
      setMe({ ...me, profile: { ...me.profile, avatarUpdatedAt } });
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { errors?: Errors } | null) : null;
      setErrors((e) => ({ ...e, avatar: body?.errors?.avatar ?? 'invalidImage' }));
    } finally {
      setAvatarBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removePhoto() {
    setAvatarBusy(true);
    try {
      await api('/me/avatar', { method: 'DELETE' });
      setMe({ ...me, profile: { ...me.profile, avatarUpdatedAt: null } });
    } finally {
      setAvatarBusy(false);
    }
  }

  const input = (field: TextField, type = 'text', placeholder?: string, autoComplete?: string) => (
    <input
      className="field"
      type={type}
      value={form[field]}
      placeholder={placeholder}
      autoComplete={autoComplete}
      aria-invalid={errors[field] ? true : undefined}
      onChange={(e) => set(field)(e.target.value)}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title={t('sections.profile')}>
          <div className="mb-5 flex items-center gap-4">
            <Avatar me={me} fallback={me} size={72} />
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => onPhoto(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-50"
              >
                <Camera size={16} strokeWidth={1.75} aria-hidden="true" />
                {me.profile.avatarUpdatedAt ? t('changePhoto') : t('uploadPhoto')}
              </button>
              {me.profile.avatarUpdatedAt && (
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={removePhoto}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-hover hover:text-foreground disabled:opacity-50"
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('removePhoto')}
                </button>
              )}
              {errors.avatar && (
                <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
                  {errorText(errors.avatar)}
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fields.firstName')} error={errorText(errors.firstName)}>
              {input('firstName', 'text', undefined, 'given-name')}
            </Field>
            <Field label={t('fields.lastName')} error={errorText(errors.lastName)}>
              {input('lastName', 'text', undefined, 'family-name')}
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('fields.jobTitle')} error={errorText(errors.jobTitle)}>
                {input('jobTitle', 'text', t('placeholders.jobTitle'), 'organization-title')}
              </Field>
            </div>
          </div>
        </Section>

        <Section title={t('sections.contacts')} delay={40}>
          <div className="grid gap-4 sm:grid-cols-2">
            {CONTACTS.map(({ field, type, placeholder }) => (
              <Field
                key={field}
                label={t(`fields.${field}` as 'fields.phone')}
                error={errorText(errors[field])}
                hint={field === 'contactEmail' ? t('hints.contactEmail') : undefined}
              >
                {input(field, type, placeholder)}
              </Field>
            ))}
          </div>
        </Section>

        <Section title={t('sections.workingHours')} delay={80}>
          <div className="grid gap-4">
            <Field group label={t('fields.timezone')} error={errorText(errors.timezone)}>
              <Select
                value={form.timezone}
                onChange={set('timezone')}
                options={timezones}
                placeholder={t('placeholders.timezone')}
                searchable
                searchPlaceholder={t('placeholders.search')}
                emptyText={t('nothingFound')}
                ariaLabel={t('fields.timezone')}
                invalid={!!errors.timezone}
              />
            </Field>
            <div>
              <span className="mb-1.5 block px-3.5 text-sm text-muted">{t('fields.workDays')}</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('fields.workDays')}>
                {weekdays.map(({ day, label }) => {
                  const on = form.workDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          workDays: on ? f.workDays.filter((d) => d !== day) : [...f.workDays, day],
                        }));
                        setStatus('idle');
                      }}
                      className={`h-10 min-w-12 rounded-xl px-3 text-sm capitalize transition-colors duration-200 ${
                        on
                          ? 'bg-accent text-accent-foreground'
                          : 'border border-line text-muted hover:bg-hover hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field group label={t('fields.workStart')} error={errorText(errors.workStart)}>
                <Select
                  value={form.workStart}
                  onChange={set('workStart')}
                  options={TIMES}
                  placeholder="––:––"
                  searchable
                  searchPlaceholder="09:00"
                  suggested="09:00"
                  emptyText={t('nothingFound')}
                  ariaLabel={t('fields.workStart')}
                  invalid={!!errors.workStart}
                />
              </Field>
              <Field group label={t('fields.workEnd')} error={errorText(errors.workEnd)}>
                <Select
                  value={form.workEnd}
                  onChange={set('workEnd')}
                  options={TIMES}
                  placeholder="––:––"
                  searchable
                  searchPlaceholder="18:00"
                  suggested="18:00"
                  emptyText={t('nothingFound')}
                  ariaLabel={t('fields.workEnd')}
                  invalid={!!errors.workEnd}
                />
              </Field>
            </div>
          </div>
        </Section>

        <div className="grid gap-4">
          <Section title={t('sections.signIn')} delay={120}>
            <Field label={t('fields.loginEmail')} hint={t('hints.loginEmail')}>
              <input className="field opacity-70" value={me.email} readOnly />
            </Field>
          </Section>

          <Section title={t('sections.interface')} delay={160}>
            <div className="flex items-center justify-between gap-4 py-1 pl-3.5">
              <span className="text-sm">{t('fields.theme')}</span>
              <ThemeToggle className="icon-btn border border-line" />
            </div>
            <div className="flex items-center justify-between gap-4 py-1 pl-3.5">
              <span className="text-sm">{t('fields.language')}</span>
              <LocaleSwitcher className="icon-btn border border-line" />
            </div>
          </Section>
        </div>
      </div>

      {/* Save bar */}
      <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-4 py-2">
        {status === 'saved' && (
          <span className="flex items-center gap-1.5 text-sm text-muted" role="status">
            <Check size={16} aria-hidden="true" />
            {t('saved')}
          </span>
        )}
        {status === 'error' && (
          <span className="text-sm text-red-600 dark:text-red-400" role="alert">
            {t('fixErrors')}
          </span>
        )}
        <button type="submit" disabled={status === 'saving'} className="btn-primary w-auto px-6">
          {status === 'saving' ? '…' : t('save')}
        </button>
      </div>
    </form>
  );
}
