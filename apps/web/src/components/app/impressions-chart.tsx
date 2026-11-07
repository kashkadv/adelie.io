'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

export type SeriesPoint = {
  date: string;
  value: number | null;
  status: 'READY' | 'PROCESSING' | 'ESTIMATE' | 'UNAVAILABLE';
};

const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

/** Rounds the axis maximum up to a "nice" number so gridlines land on readable values. */
function niceMax(max: number): number {
  if (max <= 0) return 4;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

/**
 * Daily line chart of one series (dataviz rules): 2px line, recessive grid, no legend (the card
 * title names the series). Days without data are gaps, never zero; days the platform is still
 * finalizing are dashed. Hover/focus shows a crosshair with the day's value and status.
 */
export function ImpressionsChart({
  points,
  ariaLabel,
}: {
  points: SeriesPoint[];
  ariaLabel: string;
}) {
  const t = useTranslations('Overview');
  const format = useFormatter();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const innerW = Math.max(0, width - PAD.left - PAD.right);
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const max = niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
    const x = (i: number) =>
      PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

    // Split into segments between consecutive days that both have data; dashed if either end
    // is preliminary.
    const solid: string[] = [];
    const dashed: string[] = [];
    const areas: string[] = [];
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1) {
        const line = run.map((i, k) => `${k ? 'L' : 'M'}${x(i)},${y(points[i]!.value!)}`).join('');
        areas.push(`${line}L${x(run.at(-1)!)},${y(0)}L${x(run[0]!)},${y(0)}Z`);
      }
      run = [];
    };
    points.forEach((p, i) => {
      if (p.value === null) return flush();
      if (run.length) {
        const prev = run.at(-1)!;
        const seg = `M${x(prev)},${y(points[prev]!.value!)}L${x(i)},${y(p.value)}`;
        const preliminary = points[prev]!.status !== 'READY' || p.status !== 'READY';
        (preliminary ? dashed : solid).push(seg);
      }
      run.push(i);
    });
    flush();

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: max * f, y: y(max * f) }));
    return { x, y, solid, dashed, areas, ticks, innerW };
  }, [points, width]);

  const label = (date: string, long = false) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), {
      day: 'numeric',
      month: 'short',
      ...(long ? { weekday: 'short' } : {}),
      timeZone: 'UTC',
    });

  function onMove(clientX: number) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || points.length === 0 || geometry.innerW <= 0) return;
    const rel = (clientX - rect.left - PAD.left) / geometry.innerW;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  }

  const h = hover === null ? null : points[hover];
  const xLabels =
    points.length > 2
      ? [0, Math.floor((points.length - 1) / 2), points.length - 1]
      : points.map((_, i) => i);

  return (
    <div
      ref={box}
      className="relative h-[240px] w-full touch-none select-none"
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={ariaLabel}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} className="block overflow-visible">
          {geometry.ticks.map((tk) => (
            <g key={tk.value}>
              <line x1={PAD.left} x2={width - PAD.right} y1={tk.y} y2={tk.y} stroke="var(--line)" />
              <text
                x={PAD.left - 8}
                y={tk.y}
                dy="0.32em"
                textAnchor="end"
                className="fill-[var(--muted)] text-[11px] tabular"
              >
                {format.number(tk.value, { notation: 'compact' })}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              x={geometry.x(i)}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              className="fill-[var(--muted)] text-[11px]"
            >
              {label(points[i]!.date)}
            </text>
          ))}
          {geometry.areas.map((d) => (
            <path key={d} d={d} fill="var(--series-1)" opacity={0.08} />
          ))}
          {geometry.solid.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
          {geometry.dashed.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
          ))}
          {h && hover !== null && (
            <g>
              <line
                x1={geometry.x(hover)}
                x2={geometry.x(hover)}
                y1={PAD.top}
                y2={HEIGHT - PAD.bottom}
                stroke="var(--muted)"
                strokeDasharray="2 3"
              />
              {h.value !== null && (
                <circle
                  cx={geometry.x(hover)}
                  cy={geometry.y(h.value)}
                  r={5}
                  fill="var(--series-1)"
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 w-max rounded-xl bg-accent px-3 py-2 text-xs text-accent-foreground shadow-[0_8px_24px_-8px_var(--shadow)]"
          style={{
            left: Math.min(Math.max(geometry.x(hover) - 70, 0), Math.max(0, width - 150)),
          }}
        >
          <p className="opacity-70">{label(h.date, true)}</p>
          <p className="tabular text-sm font-semibold">
            {h.value === null ? t('noDataDay') : format.number(h.value)}
          </p>
          {h.value !== null && h.status !== 'READY' && (
            <p className="opacity-70">{t('preliminaryDay')}</p>
          )}
        </div>
      )}
    </div>
  );
}
