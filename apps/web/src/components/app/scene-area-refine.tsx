'use client';

import { Brush, Eraser, Square, Undo2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { apiUrl } from '@/lib/auth-client';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';

type Tool = 'brush' | 'rect';
type Op =
  | { kind: 'brush'; width: number; points: [number, number][] }
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number };

/** Brush widths as a share of the photo's short side. */
const SIZES = { s: 0.025, m: 0.05, l: 0.1 } as const;
type Size = keyof typeof SIZES;

function draw(ctx: CanvasRenderingContext2D, ops: Op[], color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const op of ops) {
    if (op.kind === 'rect') {
      ctx.fillRect(
        Math.min(op.x0, op.x1),
        Math.min(op.y0, op.y1),
        Math.abs(op.x1 - op.x0),
        Math.abs(op.y1 - op.y0),
      );
    } else {
      const [first, ...rest] = op.points;
      if (!first) continue;
      ctx.lineWidth = op.width;
      ctx.beginPath();
      ctx.moveTo(first[0], first[1]);
      // a single click is a dot
      if (!rest.length) ctx.lineTo(first[0] + 0.1, first[1]);
      for (const [x, y] of rest) ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
}

/**
 * "Refine an area" (owner, 2026-11-27): paint over a part of the scene with a brush or a rectangle and say what to do
 * there. The mask goes to the PC at the photo's own size (white = change); the PC samples only that area while the
 * model sees the whole room, and pastes the original pixels back around it.
 */
export function AreaRefine({
  base,
  sceneId,
  src,
  title,
  onClose,
  onQueued,
}: {
  base: string;
  sceneId: string;
  src: string;
  title: string;
  onClose: () => void;
  onQueued: () => void;
}) {
  const t = useTranslations('Scenes');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [size, setSize] = useState<Size>('m');
  const [ops, setOps] = useState<Op[]>([]);
  const [current, setCurrent] = useState<Op | null>(null);
  const [instruction, setInstruction] = useState('');
  const [count, setCount] = useState('2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the painted area, half see-through over the photo
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const color = getComputedStyle(c).getPropertyValue('--mask').trim() || 'red';
    draw(ctx, current ? [...ops, current] : ops, color);
  }, [ops, current, natural]);

  const undo = useCallback(() => setOps((o) => o.slice(0, -1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy, undo]);

  const point = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * c.width) / r.width,
      ((e.clientY - r.top) * c.height) / r.height,
    ];
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!natural || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    setError(null);
    setCurrent(
      tool === 'rect'
        ? { kind: 'rect', x0: x, y0: y, x1: x, y1: y }
        : {
            kind: 'brush',
            width: Math.min(natural.w, natural.h) * SIZES[size],
            points: [[x, y]],
          },
    );
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!current) return;
    const [x, y] = point(e);
    setCurrent(
      current.kind === 'rect'
        ? { ...current, x1: x, y1: y }
        : { ...current, points: [...current.points, [x, y]] },
    );
  };
  const up = () => {
    if (!current) return;
    const tiny =
      current.kind === 'rect' &&
      (Math.abs(current.x1 - current.x0) < 4 || Math.abs(current.y1 - current.y0) < 4);
    if (!tiny) setOps((o) => [...o, current]);
    setCurrent(null);
  };

  async function submit() {
    if (busy || !natural || !instruction.trim()) return;
    if (!ops.length) {
      setError(t('areaEmpty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const m = document.createElement('canvas');
      m.width = natural.w;
      m.height = natural.h;
      const ctx = m.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, m.width, m.height);
      draw(ctx, ops, '#fff');
      const blob = await new Promise<Blob | null>((ok) => m.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('mask');
      const q = new URLSearchParams({ instruction: instruction.trim(), count });
      const res = await fetch(`${apiUrl}${base}/scenes/${sceneId}/refine-area?${q}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
      });
      if (!res.ok) throw new Error(String(res.status));
      onQueued();
    } catch {
      setError(t('errors.failed'));
      setBusy(false);
    }
  }

  const toolBtn = (on: boolean) =>
    `flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm ${
      on ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-hover hover:text-foreground'
    }`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('areaTitle', { scene: title })}
      className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{t('areaTitle', { scene: title })}</p>
          <p className="truncate text-xs text-white/70">{t('areaLead')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t('close')}
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with the session cookie */}
          <img
            src={src}
            alt={title}
            draggable={false}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            className="block h-auto max-h-[calc(100dvh-15rem)] w-auto max-w-full select-none"
          />
          {natural && (
            <canvas
              ref={canvas}
              width={natural.w}
              height={natural.h}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none opacity-50"
            />
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="glass glass-strong mx-auto grid max-w-3xl gap-3 rounded-[28px] p-4">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setTool('brush')}
              className={toolBtn(tool === 'brush')}
            >
              <Brush size={15} aria-hidden="true" />
              {t('areaBrush')}
            </button>
            <button
              type="button"
              onClick={() => setTool('rect')}
              className={toolBtn(tool === 'rect')}
            >
              <Square size={15} aria-hidden="true" />
              {t('areaRect')}
            </button>
            {tool === 'brush' && (
              <div className="ml-1 flex items-center gap-1" role="group" aria-label={t('areaSize')}>
                {(Object.keys(SIZES) as Size[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSize(k)}
                    title={t(`areaSizes.${k}`)}
                    aria-label={t(`areaSizes.${k}`)}
                    aria-pressed={size === k}
                    className={`${toolBtn(size === k)} w-9 justify-center px-0`}
                  >
                    <span
                      className="rounded-full bg-current"
                      style={{ width: { s: 5, m: 9, l: 14 }[k], height: { s: 5, m: 9, l: 14 }[k] }}
                    />
                  </button>
                ))}
              </div>
            )}
            <span className="flex-1" />
            <button type="button" onClick={undo} disabled={!ops.length} className={toolBtn(false)}>
              <Undo2 size={15} aria-hidden="true" />
              {t('areaUndo')}
            </button>
            <button
              type="button"
              onClick={() => setOps([])}
              disabled={!ops.length}
              className={toolBtn(false)}
            >
              <Eraser size={15} aria-hidden="true" />
              {t('areaClear')}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-60 flex-1">
              <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
                {t('areaWhat')}
                <InfoTip text={t('areaWhatHint')} />
              </span>
              <input
                className="field"
                maxLength={500}
                placeholder={t('areaPlaceholder')}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </label>
            <div className="w-28">
              <span className="mb-1.5 flex px-3.5 text-sm text-muted">{t('refineCount')}</span>
              <Select
                ariaLabel={t('refineCount')}
                value={count}
                onChange={setCount}
                options={['1', '2', '4'].map((v) => ({ value: v, label: v }))}
              />
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !instruction.trim()}
              className="btn-primary w-auto px-5"
            >
              {t('refineSubmit')}
            </button>
          </div>
          {error && (
            <p role="alert" className="px-3.5 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
