'use client';

import { Check, Copy, Cpu, ImagePlus, MapPin, Sparkles, X, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';
import {
  ANGLES,
  LIGHTS,
  PRODUCT_TYPES,
  ROOMS,
  SIZE_CLASSES,
  type SceneLocation,
} from './scenes-data';

/** A centred glass dialog (forms are windows in the middle — status.md, ADR-0009). */
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
          wide ? 'max-w-4xl' : 'max-w-lg'
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

/** A new location or its name, room type and description. */
export function LocationDialog({
  base,
  location,
  onClose,
  onSaved,
}: {
  base: string;
  location?: SceneLocation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Scenes');
  const [name, setName] = useState(location?.name ?? '');
  const [description, setDescription] = useState(location?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError(t('errors.name'));
    setBusy(true);
    setError(null);
    try {
      await api(location ? `${base}/scene-locations/${location.id}` : `${base}/scene-locations`, {
        method: location ? 'PATCH' : 'POST',
        json: { name, description },
      });
      onSaved();
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
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
          >
            {t('cancel')}
          </button>
          <button type="submit" disabled={busy} className="btn-primary w-auto px-5">
            {t('save')}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <label className="block">
          <Label text={t('locationName')} />
          <input
            autoFocus
            className="field"
            maxLength={80}
            placeholder={t('locationNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <Label text={t('locationDescription')} hint={t('locationDescriptionHint')} />
          <textarea
            className="field min-h-24 py-2.5"
            maxLength={1000}
            placeholder={t('locationDescriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && <ErrorText text={error} />}
      </div>
    </Dialog>
  );
}

/** A request for new candidates: what kind of room, for which products, how many. */
export function GenerateDialog({
  base,
  locations,
  locationId,
  onClose,
  onQueued,
}: {
  base: string;
  locations: SceneLocation[];
  locationId: string | null;
  onClose: () => void;
  onQueued: () => void;
}) {
  const t = useTranslations('Scenes');
  const [location, setLocation] = useState(locationId ?? locations[0]?.id ?? '');
  const [room, setRoom] = useState<string>('living');
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
      await api(`${base}/scenes/generate`, {
        method: 'POST',
        json: {
          locationId: location,
          room,
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
      const field =
        err instanceof ApiError
          ? Object.keys((err.body as { errors?: Record<string, string> })?.errors ?? {})[0]
          : undefined;
      setError(field ? t(`errors.${field}` as 'errors.failed') : t('errors.failed'));
      setBusy(false);
    }
  }

  const toggle = (type: string) =>
    setTypes((list) => (list.includes(type) ? list.filter((x) => x !== type) : [...list, type]));

  return (
    <Dialog
      icon={Sparkles}
      title={t('generateTitle')}
      lead={t('generateLead')}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
          >
            {t('cancel')}
          </button>
          <button type="submit" disabled={busy || !location} className="btn-primary w-auto px-5">
            {t('generateSubmit')}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <div>
          <Label text={t('location')} />
          <Select
            ariaLabel={t('location')}
            value={location}
            onChange={setLocation}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
          />
        </div>
        <div>
          <Label text={t('room')} hint={t('roomHint')} />
          <Select
            ariaLabel={t('room')}
            value={room}
            onChange={setRoom}
            options={ROOMS.map((r) => ({ value: r, label: t(`rooms.${r}`) }))}
          />
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
          <Label text={t('notes')} hint={t('notesHint')} />
          <textarea
            className="field min-h-20 py-2.5"
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
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
            >
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

/** A scene large, with what it was made from. */
export function SceneViewer({
  src,
  title,
  details,
  actions,
  onClose,
}: {
  src: string;
  title: string;
  details: [string, string][];
  actions: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog icon={ImagePlus} title={title} onClose={onClose} wide footer={actions}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with the session cookie */}
        <img src={src} alt={title} className="w-full rounded-2xl" />
        <dl className="grid content-start gap-2 text-sm">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Dialog>
  );
}
