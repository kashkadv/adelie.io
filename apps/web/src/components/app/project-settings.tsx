'use client';

import { Check, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { timezoneOptions } from '@/lib/timezones';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Field, Section } from '../ui/form';
import { InfoTip } from '../ui/info-tip';
import { Select, type SelectOption } from '../ui/select';
import { PageHeader } from './page-header';
import { useWorkspace, type Project, type Role } from './workspace-context';

/** Languages a shared report can be rendered in (ADR-0006; the API checks the same list). */
const REPORT_LOCALES = ['en', 'uk'] as const;
/** Who edits project settings; creating and deleting projects is for OWNER/ADMIN (ADR-0014). */
const EDIT_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER'];
export const MANAGE_PROJECT_ROLES: Role[] = ['OWNER', 'ADMIN'];

type FieldName = 'name' | 'timezone' | 'currency' | 'reportLocale';
type Form = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;

const toForm = (p: Project): Form => ({
  name: p.name,
  timezone: p.timezone,
  currency: p.currency,
  reportLocale: p.reportLocale,
});

/** Settings page of the current project (ADR-0014): basics now, more sections later. */
export function ProjectSettings() {
  const { workspace, project } = useWorkspace();
  if (!workspace || !project) return null;
  // Keyed by project: switching projects starts a fresh form.
  return <ProjectSettingsForm key={project.id} project={project} role={workspace.role} />;
}

function ProjectSettingsForm({ project, role }: { project: Project; role: Role }) {
  const t = useTranslations('ProjectSettings');
  const locale = useLocale();
  const router = useRouter();
  const { workspace, reloadWorkspace } = useWorkspace();
  const [form, setForm] = useState<Form>(() => toForm(project));
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const canEdit = EDIT_ROLES.includes(role);
  const canDelete = MANAGE_PROJECT_ROLES.includes(role);
  const isLast = (workspace?.projects.length ?? 0) <= 1;
  const dirty = (Object.keys(form) as FieldName[]).some((k) => form[k] !== toForm(project)[k]);

  const timezones = useMemo(() => timezoneOptions(form.timezone), [form.timezone]);
  const currencies = useMemo<SelectOption[]>(() => {
    const names = new Intl.DisplayNames([locale], { type: 'currency' });
    return Intl.supportedValuesOf('currency').map((code) => ({
      value: code,
      label: names.of(code) ?? code,
      hint: code,
    }));
  }, [locale]);
  // Each language in its own name, as in language switchers.
  const reportLocales = useMemo<SelectOption[]>(
    () =>
      REPORT_LOCALES.map((l) => {
        const name = new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l;
        return { value: l, label: name.charAt(0).toUpperCase() + name.slice(1) };
      }),
    [],
  );

  const set = (field: FieldName) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setStatus('idle');
  };
  const errorText = (code?: string) =>
    code ? t(`errors.${code}` as 'errors.required') : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setStatus('saving');
    try {
      await api(`/workspaces/${workspace.id}/projects/${project.id}`, {
        method: 'PATCH',
        json: form,
      });
      await reloadWorkspace();
      setErrors({});
      setStatus('saved');
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { errors?: Errors } | null) : null;
      setErrors(body?.errors ?? {});
      setStatus('error');
    }
  }

  async function onDelete(typed: string) {
    if (!workspace) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await api(`/workspaces/${workspace.id}/projects/${project.id}`, {
        method: 'DELETE',
        json: { confirm: typed },
      });
      await reloadWorkspace();
      router.push('/');
    } catch {
      setDeleteError(t('deleteFailed'));
      setDeleteBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader title={t('title')} subtitle={t('subtitle', { project: project.name })} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title={t('sections.general')}>
          <Field label={t('fields.name')} error={errorText(errors.name)}>
            <input
              className="field"
              value={form.name}
              maxLength={80}
              disabled={!canEdit}
              aria-invalid={errors.name ? true : undefined}
              onChange={(e) => set('name')(e.target.value)}
            />
          </Field>
        </Section>

        <Section title={t('sections.regional')} delay={40}>
          <div className="grid gap-4">
            <Field
              group
              label={t('fields.timezone')}
              hint={t('hints.timezone')}
              error={errorText(errors.timezone)}
            >
              <Select
                value={form.timezone}
                onChange={set('timezone')}
                disabled={!canEdit}
                options={timezones}
                searchable
                searchPlaceholder={t('search')}
                emptyText={t('nothingFound')}
                ariaLabel={t('fields.timezone')}
                invalid={!!errors.timezone}
              />
            </Field>
            <Field
              group
              label={t('fields.currency')}
              hint={t('hints.currency')}
              error={errorText(errors.currency)}
            >
              <Select
                value={form.currency}
                onChange={set('currency')}
                disabled={!canEdit}
                options={currencies}
                searchable
                searchPlaceholder={t('search')}
                emptyText={t('nothingFound')}
                ariaLabel={t('fields.currency')}
                invalid={!!errors.currency}
              />
            </Field>
            <Field
              group
              label={t('fields.reportLocale')}
              hint={t('hints.reportLocale')}
              error={errorText(errors.reportLocale)}
            >
              <Select
                value={form.reportLocale}
                onChange={set('reportLocale')}
                disabled={!canEdit}
                options={reportLocales}
                ariaLabel={t('fields.reportLocale')}
                invalid={!!errors.reportLocale}
              />
            </Field>
          </div>
        </Section>

        {canDelete && (
          <Section title={t('sections.danger')} delay={80}>
            <div className="flex flex-wrap items-center justify-between gap-4 px-3.5">
              <p className="flex items-center gap-1.5 text-sm text-muted">
                {t('deleteText')}
                {isLast && <InfoTip text={t('lastProjectHint')} />}
              </p>
              <button
                type="button"
                disabled={isLast}
                onClick={() => {
                  setDeleteError(undefined);
                  setDeleting(true);
                }}
                className="flex items-center gap-2 rounded-xl border border-red-600/40 px-3 py-2 text-sm text-red-600 hover:bg-red-600/10 disabled:opacity-40 dark:text-red-400"
              >
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('delete')}
              </button>
            </div>
          </Section>
        )}
      </div>

      {canEdit && (
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
          <button
            type="submit"
            disabled={status === 'saving' || !dirty}
            className="btn-primary w-auto px-6"
          >
            {status === 'saving' ? '…' : t('save')}
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('deleteDialog.title', { name: project.name })}
          confirmLabel={t('deleteDialog.confirm')}
          cancelLabel={t('cancel')}
          danger
          confirmText={project.name}
          inputLabel={t('deleteDialog.typeToConfirm', { name: project.name })}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={onDelete}
          onCancel={() => setDeleting(false)}
        >
          <p>{t('deleteDialog.text')}</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
