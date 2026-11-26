'use client';

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Cpu,
  MapPin,
  Plus,
  RotateCcw,
  ScrollText,
  Sparkles,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';
import {
  ANGLES,
  DIRECTIONS,
  LIGHTS,
  LOCATION_TEMPLATES,
  PRODUCT_TYPES,
  SIZE_CLASSES,
  type Direction,
  type GpuState,
  type LocationDetail,
  type SceneRule,
} from './scenes-data';

const subtle =
  'rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground disabled:opacity-50';

/** A centred glass dialog (forms are windows in the middle — ADR-0009). */
function Dialog({
  icon: Icon,
  title,
  lead,
  busy = false,
  onClose,
  onSubmit,
  wide = false,
  children,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  lead?: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit?: (e: FormEvent) => void;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations('Scenes');
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  const Box = onSubmit ? 'form' : 'div';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
      />
      <Box
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        className={`glass glass-strong animate-rise scroll-thin relative max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[28px] p-6 ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {lead && <p className="text-sm text-muted">{lead}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('close')}
            className="icon-btn h-8 w-8"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
        {footer && <div className="mt-6 flex items-center justify-end gap-2">{footer}</div>}
      </Box>
    </div>,
    document.body,
  );
}

const Label = ({ text, hint }: { text: string; hint?: string }) => (
  <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
    {text}
    {hint && <InfoTip text={hint} />}
  </span>
);

const ErrorText = ({ text }: { text: string }) => (
  <p role="alert" className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">
    {text}
  </p>
);

function errorField(err: unknown) {
  return err instanceof ApiError
    ? Object.keys((err.body as { errors?: Record<string, string> })?.errors ?? {})[0]
    : undefined;
}

/** A new location (empty or from a template) or its name, direction, style and must-haves. */
export function LocationDialog({
  base,
  location,
  onClose,
  onSaved,
}: {
  base: string;
  location?: LocationDetail['location'];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations('Scenes');
  const [name, setName] = useState(location?.name ?? '');
  const [direction, setDirection] = useState<Direction>(location?.direction ?? 'interior');
  const [description, setDescription] = useState(location?.description ?? '');
  const [mustHave, setMustHave] = useState(location?.mustHave ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError(t('errors.name'));
    setBusy(true);
    setError(null);
    try {
      const saved = await api<{ id: string }>(
        location ? `${base}/scene-locations/${location.id}` : `${base}/scene-locations`,
        { method: location ? 'PATCH' : 'POST', json: { name, direction, description, mustHave } },
      );
      onSaved(saved.id);
    } catch {
      setError(t('errors.failed'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      icon={MapPin}
      title={location ? t('locationEdit') : t('locationNew')}
      lead={t('locationLead')}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={subtle}>
            {t('cancel')}
          </button>
          <button type="submit" disabled={busy} className="btn-primary w-auto px-5">
            {t('save')}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        {!location && (
          <div>
            <Label text={t('templates')} hint={t('templatesHint')} />
            <div className="flex flex-wrap gap-2 px-1">
              {LOCATION_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => {
                    setName(t(`templateNames.${tpl.key}` as 'templateNames.chalet'));
                    setDirection(tpl.direction);
                    setDescription(tpl.description);
                    setMustHave(tpl.mustHave);
                  }}
                  className="h-9 rounded-full border border-line px-3.5 text-sm text-muted hover:text-foreground"
                >
                  {t(`templateNames.${tpl.key}` as 'templateNames.chalet')}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block">
          <Label text={t('locationName')} />
          <input
            autoFocus={!!location}
            className="field"
            maxLength={80}
            placeholder={t('locationNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div>
          <Label text={t('direction')} hint={t('directionHint')} />
          <Select
            ariaLabel={t('direction')}
            value={direction}
            onChange={(v) => setDirection(v as Direction)}
            options={DIRECTIONS.map((d) => ({
              value: d,
              label: t(`directions.${d}`),
              hint: d === 'interior' ? undefined : t('soon'),
            }))}
          />
        </div>
        <label className="block">
          <Label text={t('locationDescription')} hint={t('locationDescriptionHint')} />
          <textarea
            className="field min-h-24 py-2.5"
            maxLength={1000}
            placeholder={t('locationDescriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <span
            className={`mt-1 block px-3.5 text-xs ${description.length > 300 ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}`}
          >
            {t('chars', { count: description.length })}
          </span>
        </label>
        <label className="block">
          <Label text={t('mustHave')} hint={t('mustHaveHint')} />
          <input
            className="field"
            maxLength={500}
            placeholder={t('mustHavePlaceholder')}
            value={mustHave}
            onChange={(e) => setMustHave(e.target.value)}
          />
        </label>
        {error && <ErrorText text={error} />}
      </div>
    </Dialog>
  );
}

/** "Add scenes" inside a location: which scene type, light, angle, size, for which products, how many. */
export function AddScenesDialog({
  base,
  locationId,
  sceneTypes,
  gpu,
  onClose,
  onQueued,
}: {
  base: string;
  locationId: string;
  sceneTypes: { key: string; label: string }[];
  gpu: GpuState;
  onClose: () => void;
  onQueued: () => void;
}) {
  const t = useTranslations('Scenes');
  const [sceneType, setSceneType] = useState(sceneTypes[0]?.key ?? '');
  const [style, setStyle] = useState('');
  const [light, setLight] = useState<string>('sun');
  const [angle, setAngle] = useState<string>('front');
  const [sizeClass, setSizeClass] = useState<string>('medium');
  const [types, setTypes] = useState<string[]>(['lizhnyk', 'rug']);
  const [count, setCount] = useState('4');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!types.length) return setError(t('errors.productTypes'));
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/scene-locations/${locationId}/generate`, {
        method: 'POST',
        json: {
          sceneType,
          style,
          light,
          angle,
          sizeClass,
          productTypes: types,
          count: Number(count),
          notes,
        },
      });
      onQueued();
    } catch (err) {
      const field = errorField(err);
      setError(field ? t(`errors.${field}` as 'errors.failed') : t('errors.failed'));
      setBusy(false);
    }
  }

  const toggle = (type: string) =>
    setTypes((list) => (list.includes(type) ? list.filter((x) => x !== type) : [...list, type]));

  return (
    <Dialog
      icon={Sparkles}
      title={t('addScenes')}
      lead={t('addScenesLead')}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={subtle}>
            {t('cancel')}
          </button>
          <button type="submit" disabled={busy || !sceneType} className="btn-primary w-auto px-5">
            {t('addScenesSubmit')}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        {gpu !== 'ready' && (
          <p className="flex items-start gap-2 rounded-2xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {gpu === 'busy' ? t('pcBusyWarning') : t('pcOfflineWarning')}
          </p>
        )}
        {sceneTypes.length === 0 ? (
          <p className="px-1 text-sm text-muted">{t('noSceneTypes')}</p>
        ) : (
          <div>
            <Label text={t('sceneType')} hint={t('sceneTypeHint')} />
            <Select
              ariaLabel={t('sceneType')}
              value={sceneType}
              onChange={setSceneType}
              options={sceneTypes.map((r) => ({ value: r.key, label: r.label }))}
            />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label text={t('light')} />
            <Select
              ariaLabel={t('light')}
              value={light}
              onChange={setLight}
              options={LIGHTS.map((v) => ({ value: v, label: t(`lights.${v}`) }))}
            />
          </div>
          <div>
            <Label text={t('angle')} />
            <Select
              ariaLabel={t('angle')}
              value={angle}
              onChange={setAngle}
              options={ANGLES.map((v) => ({ value: v, label: t(`angles.${v}`) }))}
            />
          </div>
          <div>
            <Label text={t('count')} />
            <Select
              ariaLabel={t('count')}
              value={count}
              onChange={setCount}
              options={['1', '2', '4', '6', '8'].map((v) => ({ value: v, label: v }))}
            />
          </div>
        </div>
        <div>
          <Label text={t('sizeClass')} hint={t('sizeClassHint')} />
          <Select
            ariaLabel={t('sizeClass')}
            value={sizeClass}
            onChange={setSizeClass}
            options={SIZE_CLASSES.map((v) => ({
              value: v,
              label: t(`sizes.${v}`),
              hint: t(`sizeRanges.${v}`),
            }))}
          />
        </div>
        <div>
          <Label text={t('productTypes')} hint={t('productTypesHint')} />
          <div className="flex flex-wrap gap-2 px-1">
            {PRODUCT_TYPES.map((type) => {
              const on = types.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(type)}
                  className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
                    on
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-line text-muted hover:text-foreground'
                  }`}
                >
                  {on && <Check size={14} aria-hidden="true" />}
                  {t(`types.${type}`)}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block">
          <Label text={t('style')} hint={t('styleHint')} />
          <input
            className="field"
            maxLength={300}
            placeholder={t('stylePlaceholder')}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          />
        </label>
        <label className="block">
          <Label text={t('notes')} hint={t('notesHint')} />
          <input
            className="field"
            maxLength={1000}
            placeholder={t('notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && <ErrorText text={error} />}
      </div>
    </Dialog>
  );
}

/** The rules every scene's prompt is built from: general, and per scene type. */
export function RulesDialog({ base, onClose }: { base: string; onClose: () => void }) {
  const t = useTranslations('Scenes');
  const [rules, setRules] = useState<SceneRule[] | null>(null);
  const [key, setKey] = useState('general');
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (list: SceneRule[], select: string) => {
    setRules(list);
    const cur = list.find((x) => x.key === select) ?? list[0];
    if (cur) {
      setKey(cur.key);
      setText(cur.text);
      setLabel(cur.label);
    }
  };
  const load = async (select: string) =>
    apply((await api<{ rules: SceneRule[] }>(`${base}/scene-rules`)).rules, select);
  useEffect(() => {
    api<{ rules: SceneRule[] }>(`${base}/scene-rules`).then(
      (r) => apply(r.rules, 'general'),
      () => setError(t('errors.failed')),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const current = rules?.find((r) => r.key === key);
  const pick = (k: string) => {
    const r = rules?.find((x) => x.key === k);
    if (!r) return;
    setKey(k);
    setText(r.text);
    setLabel(r.label);
    setAdding(false);
    setSaved(false);
    setError(null);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (adding) {
        const created = await api<SceneRule>(`${base}/scene-rules`, {
          method: 'POST',
          json: { label, text, basedOn: key === 'general' ? 'living' : key },
        });
        setAdding(false);
        await load(created.key);
      } else {
        await api(`${base}/scene-rules/${key}`, {
          method: 'PATCH',
          json: key === 'general' ? { text } : { text, label },
        });
        await load(key);
      }
      setSaved(true);
    } catch {
      setError(t('errors.failed'));
    }
    setBusy(false);
  }

  async function reset() {
    setBusy(true);
    await api(`${base}/scene-rules/${key}/reset`, { method: 'POST' }).catch(() => undefined);
    await load(key).catch(() => undefined);
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`${base}/scene-rules/${key}`, { method: 'DELETE' });
      await load('general');
    } catch (err) {
      setError(errorField(err) === 'key' ? t('errors.ruleInUse') : t('errors.failed'));
    }
    setBusy(false);
  }

  return (
    <Dialog
      icon={ScrollText}
      title={t('rules')}
      lead={t('rulesLead')}
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {current?.builtIn && !adding && (
            <button type="button" onClick={() => void reset()} disabled={busy} className={subtle}>
              <span className="inline-flex items-center gap-1.5">
                <RotateCcw size={14} aria-hidden="true" />
                {t('ruleReset')}
              </span>
            </button>
          )}
          {current && !current.builtIn && !adding && (
            <button type="button" onClick={() => void remove()} disabled={busy} className={subtle}>
              {t('delete')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !text.trim() || ((key !== 'general' || adding) && !label.trim())}
            className="btn-primary w-auto px-5"
          >
            {saved && !busy ? t('saved') : t('save')}
          </button>
        </>
      }
    >
      {!rules ? (
        <p className="py-6 text-center text-sm text-muted">{error ?? '…'}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav className="flex flex-col gap-1" aria-label={t('rules')}>
            {rules.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => pick(r.key)}
                aria-current={r.key === key && !adding ? 'true' : undefined}
                className={`rounded-xl px-3 py-2 text-left text-sm ${
                  r.key === key && !adding
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted hover:bg-hover hover:text-foreground'
                }`}
              >
                {r.key === 'general' ? t('ruleGeneral') : r.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setLabel('');
                setText('');
                setSaved(false);
              }}
              className="mt-1 flex items-center gap-1.5 rounded-xl px-3 py-2 text-left text-sm text-muted hover:bg-hover hover:text-foreground"
            >
              <Plus size={14} aria-hidden="true" />
              {t('ruleAdd')}
            </button>
          </nav>
          <div className="grid content-start gap-3">
            {(key !== 'general' || adding) && (
              <label className="block">
                <Label text={t('ruleLabel')} />
                <input
                  className="field"
                  maxLength={60}
                  value={label}
                  placeholder={t('ruleLabelPlaceholder')}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
            )}
            <label className="block">
              <Label
                text={adding ? t('ruleNewText') : t('ruleText')}
                hint={key === 'general' && !adding ? t('ruleGeneralHint') : t('ruleTypeHint')}
              />
              <textarea
                className="field min-h-64 py-2.5 font-mono text-xs leading-relaxed"
                maxLength={4000}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            {current?.mockup && !adding && (
              <p className="px-3.5 text-xs text-muted">
                {t('ruleMockup', {
                  preset: t(`presets.${current.mockup.preset}` as 'presets.sofa'),
                  size: current.mockup.size,
                })}
              </p>
            )}
            {adding && (
              <p className="px-3.5 text-xs text-muted">
                {t('ruleAddHint', {
                  base:
                    key === 'general'
                      ? (rules.find((r) => r.key === 'living')?.label ?? '')
                      : label || (current?.label ?? ''),
                })}
              </p>
            )}
            {error && <ErrorText text={error} />}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Connect the PC: a worker key shown once, and how to start the agent with it. */
export function PcDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const t = useTranslations('Scenes');
  const [name, setName] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ key: string }>(`/workspaces/${workspaceId}/gpu/workers`, {
        method: 'POST',
        json: { name },
      });
      setKey(r.key);
    } catch {
      setError(t('errors.failed'));
    }
    setBusy(false);
  }

  return (
    <Dialog
      icon={Cpu}
      title={t('pcTitle')}
      lead={t('pcLead')}
      busy={busy}
      onClose={onClose}
      onSubmit={key ? undefined : create}
      footer={
        key ? (
          <button type="button" onClick={onClose} className="btn-primary w-auto px-5">
            {t('done')}
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className={subtle}>
              {t('cancel')}
            </button>
            <button type="submit" disabled={busy} className="btn-primary w-auto px-5">
              {t('pcCreate')}
            </button>
          </>
        )
      }
    >
      {key ? (
        <div className="grid gap-3">
          <p className="px-1 text-sm">{t('pcKeyOnce')}</p>
          <div className="flex items-center gap-2">
            <code className="field flex-1 truncate font-mono text-xs leading-[2.6rem]">{key}</code>
            <button
              type="button"
              className="icon-btn h-10 w-10"
              aria-label={t('copy')}
              onClick={() => {
                void navigator.clipboard.writeText(key).then(() => setCopied(true));
              }}
            >
              {copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="px-1 text-sm text-muted">{t('pcHowTo')}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="block">
            <Label text={t('pcName')} />
            <input
              autoFocus
              className="field"
              maxLength={80}
              placeholder={t('pcNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && <ErrorText text={error} />}
        </div>
      )}
    </Dialog>
  );
}

/** A scene full screen: ←/→ through the list, the decision right there. */
export function SceneViewer({
  src,
  title,
  details,
  actions,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  src: string;
  title: string;
  details: string;
  actions: ReactNode;
  position: string;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('Scenes');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);
  const nav =
    'absolute top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/60 disabled:opacity-30';
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          <p className="truncate text-xs text-white/70">{details}</p>
        </div>
        <span className="text-sm text-white/70 tabular-nums">{position}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 px-16">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with the session cookie */}
        <img src={src} alt={title} className="mx-auto h-full w-auto max-w-full object-contain" />
        <button
          type="button"
          onClick={onPrev}
          disabled={!onPrev}
          aria-label={t('prev')}
          className={`${nav} left-3`}
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!onNext}
          aria-label={t('next')}
          className={`${nav} right-3`}
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-4">{actions}</div>
    </div>,
    document.body,
  );
}
