'use client';

import { ImagePlus, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/auth-client';
import { resizeToBlob } from '@/lib/resize-image';
import { Select } from '../ui/select';
import type { SceneSketch } from './scenes-data';

/**
 * The owner's sketches of rooms in a location (owner, 2026-11-27): the PC turns a sketch into a photograph keeping its
 * composition and architecture. Pencil, line or coloured - the PC detects which. Each sketch shows one scene type.
 */
export function SceneSketches({
  base,
  locationId,
  sketches,
  sceneTypes,
  typeLabel,
  canManage,
  onChanged,
  onUse,
}: {
  base: string;
  locationId: string;
  sketches: SceneSketch[];
  sceneTypes: { key: string; label: string }[];
  typeLabel: (key: string | null) => string;
  canManage: boolean;
  onChanged: () => void;
  onUse: (sketchId: string) => void;
}) {
  const t = useTranslations('Scenes');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(true);
    setError(null);
    for (const file of list) {
      try {
        const blob = await resizeToBlob(file, 2048);
        const type = sceneTypes[0]?.key ?? 'living';
        const res = await fetch(
          `${apiUrl}${base}/scene-locations/${locationId}/sketches?sceneType=${encodeURIComponent(type)}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
          },
        );
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setError(t('errors.sketch'));
      }
    }
    setBusy(false);
    onChanged();
  }

  const setType = async (sk: SceneSketch, sceneType: string) => {
    await api(`${base}/scene-sketches/${sk.id}`, { method: 'PATCH', json: { sceneType } }).catch(
      () => undefined,
    );
    onChanged();
  };
  const remove = async (sk: SceneSketch) => {
    await api(`${base}/scene-sketches/${sk.id}`, { method: 'DELETE' }).catch(() => undefined);
    onChanged();
  };

  return (
    <section className="animate-rise">
      <p className="mb-3 px-1 text-sm text-muted">{t('sketchesLead')}</p>
      <div
        onDragOver={(e) => {
          if (!canManage) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (canManage) void add(e.dataTransfer.files);
        }}
        className={`grid grid-cols-2 gap-4 rounded-2xl md:grid-cols-3 xl:grid-cols-4 ${dragging ? 'bg-hover' : ''}`}
      >
        {sketches.map((sk) => (
          <div key={sk.id} className="card overflow-hidden rounded-[20px]">
            <div className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with the session cookie */}
              <img
                src={`${apiUrl}${base}/assets/${sk.assetId}`}
                alt={sk.name ?? typeLabel(sk.sceneType)}
                className="aspect-[3/2] w-full bg-white object-cover"
              />
              {canManage && (
                <div className="absolute inset-x-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onUse(sk.id)}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/70 text-xs font-semibold text-white"
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    {t('sketchUse')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(sk)}
                    aria-label={t('delete')}
                    title={t('delete')}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/70 text-white"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            <div className="p-2">
              {canManage ? (
                <Select
                  ariaLabel={t('sceneType')}
                  value={sk.sceneType}
                  onChange={(v) => void setType(sk, v)}
                  options={sceneTypes.map((r) => ({ value: r.key, label: r.label }))}
                />
              ) : (
                <p className="px-1 text-sm">{typeLabel(sk.sceneType)}</p>
              )}
            </div>
          </div>
        ))}
        {canManage && (
          <label className="flex aspect-[3/2] cursor-pointer flex-col items-center justify-center gap-2 rounded-[20px] border-[1.5px] border-dashed border-line p-4 text-center text-sm text-muted hover:text-foreground">
            <ImagePlus size={22} strokeWidth={1.75} aria-hidden="true" />
            {busy ? '…' : t('sketchAdd')}
            <span className="text-xs">{t('sketchAddHint')}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) void add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      {error && <p className="mt-1 px-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </section>
  );
}
