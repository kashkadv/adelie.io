'use client';

import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Checkbox } from '../ui/checkbox';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';
import { Select } from '../ui/select';

export type SiteKindId = 'store' | 'landing';
type GoalRule =
  | { type: 'event'; event: string }
  | { type: 'page'; pattern: string }
  | { type: 'outbound'; host: string; path?: string };
export type Goal = { id: string; name?: string; rule: GoalRule; valued?: boolean };
type Step = { event: string } | { goal: string };
export type SiteSettings = {
  kind: SiteKindId;
  goals: Goal[];
  funnel: Step[];
  tabs: string[];
  /** The funnel was set by hand; otherwise it follows the kind. */
  customFunnel: boolean;
};

const KINDS: SiteKindId[] = ['store', 'landing'];
/** Events the SDK sends by itself: offered as funnel steps. */
const KNOWN_EVENTS = [
  'PageView',
  'ViewCategory',
  'ProductView',
  'AddToCart',
  'BeginCheckout',
  'OutboundClick',
];
const RULE_TYPES = ['outbound', 'page', 'event'] as const;
type Draft = {
  id: string | null;
  name: string;
  type: GoalRule['type'];
  host: string;
  path: string;
  pattern: string;
  event: string;
  valued: boolean;
};
const emptyDraft: Draft = {
  id: null,
  name: '',
  type: 'outbound',
  host: '',
  path: '',
  pattern: '',
  event: '',
  valued: false,
};

/** "Download" → "download"; latin, digits, dashes; unique among the goals. */
function goalId(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'goal';
  let id = /^[a-z0-9]/.test(base) ? base : `g-${base}`;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * What a site measures (ADR-0026): its kind (a template), its goals and its funnel. Changes are
 * re-counted over the whole history: events are stored as they came.
 */
export function FlipperGoals({
  base,
  accountId,
  settings,
  canManage,
  onSaved,
}: {
  base: string;
  accountId: string;
  settings: SiteSettings;
  canManage: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('Flipper');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const eventLabel = (e: string) =>
    t.has(`events.${e}` as 'events.PageView') ? t(`events.${e}` as 'events.PageView') : e;
  const goalLabel = (g: Goal) =>
    g.name ||
    (t.has(`goalPresets.${g.id}` as 'goalPresets.purchase')
      ? t(`goalPresets.${g.id}` as 'goalPresets.purchase')
      : g.id);
  const stepLabel = (s: Step) => {
    if ('event' in s) return eventLabel(s.event);
    const g = settings.goals.find((x) => x.id === s.goal);
    return g ? `${goalLabel(g)} · ${t('goalsGoal')}` : s.goal;
  };
  const ruleText = (r: GoalRule) =>
    r.type === 'outbound'
      ? t('goalsRuleOutbound', { target: `${r.host}${r.path ?? ''}` })
      : r.type === 'page'
        ? t('goalsRulePage', { pattern: r.pattern })
        : t('goalsRuleEvent', { event: r.event });

  async function save(patch: { kind?: SiteKindId; goals?: Goal[]; funnel?: Step[] | null }) {
    setBusy(true);
    setError(false);
    try {
      await api(`${base}/${accountId}/settings`, { method: 'PATCH', json: patch });
      onSaved();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toGoal(d: Draft): Goal | null {
    const name = d.name.trim();
    if (!name) return null;
    const rule: GoalRule | null =
      d.type === 'outbound'
        ? d.host.trim()
          ? {
              type: 'outbound',
              host: d.host.trim(),
              ...(d.path.trim() ? { path: d.path.trim() } : {}),
            }
          : null
        : d.type === 'page'
          ? d.pattern.trim()
            ? { type: 'page', pattern: d.pattern.trim() }
            : null
          : d.event.trim()
            ? { type: 'event', event: d.event.trim() }
            : null;
    if (!rule) return null;
    const id =
      d.id ??
      goalId(
        name,
        settings.goals.map((g) => g.id),
      );
    return { id, name, rule, ...(d.type === 'event' && d.valued ? { valued: true } : {}) };
  }

  async function saveDraft() {
    if (!draft) return;
    const goal = toGoal(draft);
    if (!goal) {
      setError(true);
      return;
    }
    const goals = draft.id
      ? settings.goals.map((g) => (g.id === draft.id ? goal : g))
      : [...settings.goals, goal];
    if (await save({ goals })) setDraft(null);
  }

  function edit(g: Goal) {
    setError(false);
    setDraft({
      ...emptyDraft,
      id: g.id,
      name: g.name ?? goalLabel(g),
      type: g.rule.type,
      host: g.rule.type === 'outbound' ? g.rule.host : '',
      path: g.rule.type === 'outbound' ? (g.rule.path ?? '') : '',
      pattern: g.rule.type === 'page' ? g.rule.pattern : '',
      event: g.rule.type === 'event' ? g.rule.event : '',
      valued: !!g.valued,
    });
  }

  function remove(g: Goal) {
    if (!window.confirm(t('goalsRemoveConfirm', { goal: goalLabel(g) }))) return;
    // A removed goal leaves the funnel too.
    const funnel = settings.customFunnel
      ? settings.funnel.filter((s) => !('goal' in s) || s.goal !== g.id)
      : undefined;
    void save({
      goals: settings.goals.filter((x) => x.id !== g.id),
      ...(funnel ? { funnel } : {}),
    });
  }

  const moveStep = (i: number, to: number) => {
    const next = [...settings.funnel];
    const [s] = next.splice(i, 1);
    next.splice(to, 0, s!);
    void save({ funnel: next });
  };
  const stepOptions = [
    ...KNOWN_EVENTS.map((e) => ({ value: `event:${e}`, label: eventLabel(e) })),
    ...settings.goals.map((g) => ({
      value: `goal:${g.id}`,
      label: `${goalLabel(g)} · ${t('goalsGoal')}`,
    })),
  ].filter(
    (o) =>
      !settings.funnel.some((s) =>
        'event' in s ? o.value === `event:${s.event}` : o.value === `goal:${s.goal}`,
      ),
  );

  return (
    <section className="card animate-rise mb-6 rounded-[24px] p-5">
      <h2 className="mb-4 flex items-center gap-1.5 text-sm font-semibold">
        {t('goalsTitle')}
        <InfoTip text={t('goalsHint')} />
      </h2>

      {/* Kind: a template of goals, funnel and tabs. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {t('kind')}
          <InfoTip text={t('kindHint')} />
        </span>
        <Segmented
          ariaLabel={t('kind')}
          value={settings.kind}
          onChange={(k) => canManage && !busy && k !== settings.kind && void save({ kind: k })}
          options={KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
        />
      </div>

      {/* Goals */}
      <h3 className="mb-2 px-1 text-xs font-semibold text-muted uppercase">{t('goalsList')}</h3>
      {settings.goals.length === 0 ? (
        <p className="mb-3 px-1 text-sm text-muted">{t('goalsNone')}</p>
      ) : (
        <ul className="mb-3 divide-y divide-line rounded-2xl border border-line">
          {settings.goals.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
            >
              <span className="font-medium">{goalLabel(g)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{ruleText(g.rule)}</span>
              {g.valued && (
                <span className="rounded-full bg-hover px-2 text-xs leading-5">
                  {t('goalsValued')}
                </span>
              )}
              {canManage && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => edit(g)}
                    aria-label={t('goalsEdit')}
                    title={t('goalsEdit')}
                    className="icon-btn h-7 w-7"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(g)}
                    aria-label={t('goalsRemove')}
                    title={t('goalsRemove')}
                    className="icon-btn h-7 w-7"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && !draft && (
        <button
          type="button"
          onClick={() => {
            setError(false);
            setDraft(emptyDraft);
          }}
          className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs hover:text-foreground"
        >
          <Plus size={13} aria-hidden="true" />
          {t('goalsAdd')}
        </button>
      )}

      {draft && (
        <div className="mb-5 grid gap-3 rounded-2xl bg-hover p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{draft.id ? t('goalsEdit') : t('goalsAdd')}</span>
            <button
              type="button"
              onClick={() => setDraft(null)}
              aria-label={t('goalsCancel')}
              className="icon-btn h-7 w-7"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <label className="block">
            <span className="mb-1.5 block px-3.5 text-xs text-muted">{t('goalsName')}</span>
            <input
              className="field"
              value={draft.name}
              maxLength={60}
              placeholder={t('goalsNamePlaceholder')}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <Segmented
            ariaLabel={t('goalsType')}
            value={draft.type}
            onChange={(type) => setDraft({ ...draft, type })}
            options={RULE_TYPES.map((r) => ({ value: r, label: t(`goalsTypes.${r}`) }))}
          />
          {draft.type === 'outbound' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-xs text-muted">
                  {t('goalsHost')}
                  <InfoTip text={t('goalsHostHint')} />
                </span>
                <input
                  className="field"
                  value={draft.host}
                  placeholder="nexusmods.com"
                  onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-xs text-muted">
                  {t('goalsPath')}
                  <InfoTip text={t('goalsPathHint')} />
                </span>
                <input
                  className="field"
                  value={draft.path}
                  placeholder="/ets2/mods/123"
                  onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                />
              </label>
            </div>
          )}
          {draft.type === 'page' && (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-xs text-muted">
                {t('goalsPattern')}
                <InfoTip text={t('goalsPatternHint')} />
              </span>
              <input
                className="field"
                value={draft.pattern}
                placeholder="/thanks"
                onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
              />
            </label>
          )}
          {draft.type === 'event' && (
            <>
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-xs text-muted">
                  {t('goalsEvent')}
                  <InfoTip text={t('goalsEventHint')} />
                </span>
                <input
                  className="field"
                  value={draft.event}
                  placeholder="Download"
                  onChange={(e) => setDraft({ ...draft, event: e.target.value })}
                />
              </label>
              <span className="flex items-center gap-2 px-1 text-sm">
                <Checkbox
                  checked={draft.valued}
                  onChange={(valued) => setDraft({ ...draft, valued })}
                  label={t('goalsValuedLabel')}
                />
                {t('goalsValuedLabel')}
                <InfoTip text={t('goalsValuedHint')} />
              </span>
            </>
          )}
          {error && (
            <p className="px-3.5 text-xs text-rose-600 dark:text-rose-400">{t('goalsError')}</p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveDraft}
              disabled={busy}
              className="btn-primary w-auto px-5"
            >
              {t('goalsSave')}
            </button>
          </div>
        </div>
      )}

      {/* Funnel: the kind's, or the site's own. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase">
          {t('funnel')}
          <InfoTip text={t('goalsFunnelHint')} />
        </h3>
        {canManage &&
          (settings.customFunnel ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save({ funnel: null })}
              className="text-xs text-muted hover:text-foreground"
            >
              {t('goalsFunnelReset')}
            </button>
          ) : (
            <span className="text-xs text-muted">{t('goalsFunnelKind')}</span>
          ))}
      </div>
      <ol className="mb-3 divide-y divide-line rounded-2xl border border-line">
        {settings.funnel.map((s, i) => (
          <li
            key={'event' in s ? s.event : `goal-${s.goal}`}
            className="flex items-center gap-3 px-4 py-2 text-sm"
          >
            <span className="tabular w-5 text-xs text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{stepLabel(s)}</span>
            {canManage && (
              <span className="flex gap-1">
                <button
                  type="button"
                  disabled={busy || i === 0}
                  onClick={() => moveStep(i, i - 1)}
                  aria-label={t('goalsUp')}
                  className="icon-btn h-7 w-7 disabled:opacity-30"
                >
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={busy || i === settings.funnel.length - 1}
                  onClick={() => moveStep(i, i + 1)}
                  aria-label={t('goalsDown')}
                  className="icon-btn h-7 w-7 disabled:opacity-30"
                >
                  <ArrowDown size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={busy || settings.funnel.length <= 1}
                  onClick={() => void save({ funnel: settings.funnel.filter((_, j) => j !== i) })}
                  aria-label={t('goalsRemove')}
                  className="icon-btn h-7 w-7 disabled:opacity-30"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {canManage && stepOptions.length > 0 && settings.funnel.length < 10 && (
        <div className="w-64">
          <Select
            value=""
            placeholder={t('goalsAddStep')}
            ariaLabel={t('goalsAddStep')}
            options={stepOptions}
            onChange={(v) => {
              if (!v) return;
              const [type, id] = v.split(':') as ['event' | 'goal', string];
              void save({
                funnel: [...settings.funnel, type === 'event' ? { event: id } : { goal: id }],
              });
            }}
          />
        </div>
      )}
    </section>
  );
}
