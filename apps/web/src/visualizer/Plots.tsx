import { useId, useState } from "react";
import type { Point } from "./model";
import { value } from "./model";

export type Trace = { label: string; color: string; points: Point[]; step?: boolean };

/** A small interactive SVG plot. Nulls stay gaps; hover/focus reads actual points. */
export function Plot({ title, traces, x0 = 0, x1, min, max, unit = "", axis = "Elapsed seconds", marks = [], height = 180 }: {
  title: string; traces: Trace[]; x0?: number; x1: number; min?: number; max?: number;
  unit?: string; axis?: string; marks?: { t: number; label: string }[]; height?: number;
}) {
  const id = useId().replaceAll(":", "");
  const [cursor, setCursor] = useState<number | null>(null);
  let low = min ?? Infinity, high = max ?? -Infinity;
  let present = false;
  for (const trace of traces) for (const [t, y] of trace.points) {
    if (y === null || !Number.isFinite(y) || t < x0 || t > x1) continue;
    present = true;
    if (min === undefined) low = Math.min(low, y);
    if (max === undefined) high = Math.max(high, y);
  }
  if (!Number.isFinite(low)) low = 0;
  if (!Number.isFinite(high)) high = 1;
  if (high <= low) { high = low + .5; low -= .5; }
  const span = Math.max(.001, x1 - x0);
  const x = (t: number) => 58 + 914 * (t - x0) / span;
  const y = (n: number) => 12 + (height - 40) * (1 - (n - low) / (high - low));
  const path = (trace: Trace) => {
    let d = "", down = false, previous = 0;
    for (const [t, v] of trace.points) {
      if (v === null || !Number.isFinite(v)) { down = false; continue; }
      if (down && trace.step) d += `L${x(t).toFixed(2)},${previous.toFixed(2)}`;
      d += `${down ? "L" : "M"}${x(t).toFixed(2)},${y(v).toFixed(2)}`;
      previous = y(v); down = true;
    }
    return d;
  };
  const selected = cursor === null ? [] : traces.map((trace) => {
    let nearest: Point | undefined;
    for (const p of trace.points) if (p[0] >= x0 && p[0] <= x1 && (!nearest || Math.abs(p[0] - cursor) < Math.abs(nearest[0] - cursor))) nearest = p;
    return { trace, point: nearest };
  });
  return <figure className="vz-plot">
    <figcaption><b>{title}</b><span>{unit}</span></figcaption>
    <div className="vz-legend">{traces.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    <svg viewBox={`0 0 1000 ${height}`} role="img" aria-label={`${title}. ${axis}: ${value(x0)} to ${value(x1)}. ${unit}`}
      onPointerMove={(e) => { const box = e.currentTarget.getBoundingClientRect(); setCursor(x0 + Math.max(0, Math.min(1, ((e.clientX - box.left) / box.width * 1000 - 58) / 914)) * span); }}
      onPointerLeave={() => setCursor(null)}>
      <defs><clipPath id={id}><rect x="58" y="0" width="914" height={height - 28} /></clipPath></defs>
      {[0, .5, 1].map((n) => <g key={n}>
        <line x1="58" x2="972" y1={y(low + n * (high - low))} y2={y(low + n * (high - low))} className="vz-gridline" />
        <text x="50" y={y(low + n * (high - low)) + 4} textAnchor="end">{value(low + n * (high - low))}</text>
      </g>)}
      {[0, .25, .5, .75, 1].map((n) => <text key={n} x={x(x0 + n * span)} y={height - 7} textAnchor="middle">{value(x0 + n * span, 1)}</text>)}
      <g clipPath={`url(#${id})`}>
        {marks.filter((m) => m.t >= x0 && m.t <= x1).map((m, i) => <line key={i} x1={x(m.t)} x2={x(m.t)} y1="10" y2={height - 28} stroke="#f2c96e" opacity=".45"><title>{m.label}</title></line>)}
        {traces.map((s) => <g key={s.label}>
          <path d={path(s)} fill="none" stroke={s.color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
          {s.points.map(([t,v], i) => v !== null && Number.isFinite(v) && t >= x0 && t <= x1 &&
            (s.points.length <= 80 || s.points[i-1]?.[1] == null && s.points[i+1]?.[1] == null)
            ? <circle key={i} cx={x(t)} cy={y(v)} r="2.2" fill={s.color} /> : null)}
        </g>)}
        {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1="10" y2={height - 28} stroke="#dce9e5" strokeDasharray="3 4" />}
      </g>
      {!present && <text x="500" y={height / 2} textAnchor="middle">No values available for this view</text>}
    </svg>
    <div className="vz-readout">{cursor === null ? axis : `${axis}: ${value(cursor, 2)}`}
      {selected.map(({ trace, point }) => <span key={trace.label} style={{ color: trace.color }}>{trace.label}: {value(point?.[1], 3)}{point ? ` @ ${value(point[0], 2)}` : ""}</span>)}
    </div>
    {present && <input className="vz-scrubber" type="range" aria-label={`Inspect ${title}`} min={x0} max={Math.max(x0 + .001, x1)} step={span / 1000}
      value={cursor ?? x0} onChange={(e) => setCursor(Number(e.target.value))} />}
  </figure>;
}

export function Histogram({ counts, label }: { counts: number[]; label: string }) {
  const maximum = Math.max(1, ...counts);
  return <figure className="vz-histogram"><figcaption><b>{label} distribution</b><span>Full run · observation counts</span></figcaption>
    <div className="vz-bars">{counts.map((count, i) => <div key={i} title={`${i / 10}–${(i+1)/10}: ${count} observations`}>
      <span>{count ? value(count, 0) : ""}</span><i style={{ height: `${Math.max(1, count / maximum * 100)}px` }} />
      <small>{(i / 10).toFixed(1)}</small>
    </div>)}</div>
    <p className="rs-note">Bins span 0.1; the last bin includes 1.0. Missing and rejected values are excluded.</p>
  </figure>;
}
