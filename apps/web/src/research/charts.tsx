// Small dependency-free SVG charts for research review and live diagnostics.
// Every chart shares a time axis (server wall seconds) so tracks line up.

export type Series = {
  label: string;
  color: string;
  points: [number, number | null][];
  /** Draw as steps (hold each value until the next point). */
  step?: boolean;
  dashed?: boolean;
};
export type Band = { from: number; to: number; label: string; color: string };
export type Mark = { t: number; label: string; color?: string };

const W = 1000;

export function TimeChart({
  t0,
  t1,
  series,
  bands = [],
  marks = [],
  min,
  max,
  height = 120,
  title,
  unit,
  note,
}: {
  t0: number;
  t1: number;
  series: Series[];
  bands?: Band[];
  marks?: Mark[];
  min?: number;
  max?: number;
  height?: number;
  title: string;
  unit?: string;
  note?: string;
}) {
  const values = series.flatMap((s) => s.points.map((p) => p[1]).filter((v): v is number => v !== null && Number.isFinite(v)));
  let lo = min ?? (values.length ? Math.min(...values) : 0);
  let hi = max ?? (values.length ? Math.max(...values) : 1);
  if (hi - lo < 1e-9) {
    hi += 0.5;
    lo -= 0.5;
  }
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (v: number) => height - 6 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (height - 12);
  const path = (s: Series) => {
    let d = "";
    let down = false;
    let prevY = 0;
    for (const [t, v] of s.points) {
      if (v === null || !Number.isFinite(v) || t < t0 - 1 || t > t1 + 1) {
        down = false;
        continue;
      }
      const X = x(t).toFixed(1);
      const Y = y(v).toFixed(1);
      if (down && s.step) d += `L${X},${prevY.toFixed(1)}`;
      d += `${down ? "L" : "M"}${X},${Y}`;
      prevY = y(v);
      down = true;
    }
    return d;
  };
  const empty = series.every((s) => s.points.length === 0);
  return (
    <figure className="rs-chart">
      <figcaption>
        <b>{title}</b>
        {unit && <span> · {unit}</span>}
        <span className="rs-legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={title}>
        {bands.map((b, i) => (
          <rect key={i} x={x(b.from)} width={Math.max(1, x(b.to) - x(b.from))} y={0} height={height} fill={b.color}>
            <title>{b.label}</title>
          </rect>
        ))}
        {series.map((s) => (
          <path
            key={s.label}
            d={path(s)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.6}
            strokeDasharray={s.dashed ? "6 5" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {marks.map((m, i) => (
          <g key={i}>
            <line x1={x(m.t)} x2={x(m.t)} y1={0} y2={height} stroke={m.color ?? "#f2c96e"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <title>{m.label}</title>
          </g>
        ))}
      </svg>
      <div className="rs-axis">
        <span>{lo.toPrecision(3)}</span>
        {empty && <em>No data in this range</em>}
        <span>{hi.toPrecision(3)}</span>
      </div>
      {note && <p className="rs-note">{note}</p>}
    </figure>
  );
}

/** Eight stacked channel traces with one shared time axis. */
export function EegStack({
  t0,
  t1,
  rows,
  labels,
  autoscale,
  marks = [],
  rangeUv = 100,
}: {
  t0: number;
  t1: number;
  rows: { t: number; ch: (number | null)[] }[];
  labels: string[];
  autoscale: boolean;
  marks?: Mark[];
  rangeUv?: number;
}) {
  const lane = 46;
  const height = lane * 8;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const paths = labels.map((_, c) => {
    const vals = rows.map((r) => r.ch[c]).filter((v): v is number => v !== null && Number.isFinite(v));
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const span = autoscale
      ? Math.max(1e-6, ...vals.map((v) => Math.abs(v - mean)))
      : rangeUv;
    let d = "";
    let down = false;
    for (const r of rows) {
      const v = r.ch[c];
      if (v === null || !Number.isFinite(v)) {
        down = false;
        continue;
      }
      const yy = c * lane + lane / 2 - (Math.max(-1, Math.min(1, (v - mean) / span)) * lane) / 2.2;
      d += `${down ? "L" : "M"}${x(r.t).toFixed(1)},${yy.toFixed(1)}`;
      down = true;
    }
    return { d, span };
  });
  return (
    <figure className="rs-chart rs-eeg">
      <figcaption>
        <b>EEG, 8 channels</b>
        <span>
          {" "}
          · µV, mean removed per channel · {autoscale ? "autoscaled per channel (scale shown per lane)" : `fixed ±${rangeUv} µV per lane`} · display is decimated; files keep every sample
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label="Eight EEG channels">
        {paths.map((p, c) => (
          <g key={c}>
            <line x1={0} x2={W} y1={c * lane + lane / 2} y2={c * lane + lane / 2} stroke="#1f3439" vectorEffect="non-scaling-stroke" />
            <path d={p.d} fill="none" stroke="#8ff1d0" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {marks.map((m, i) => (
          <line key={i} x1={x(m.t)} x2={x(m.t)} y1={0} y2={height} stroke={m.color ?? "#f2c96e"} vectorEffect="non-scaling-stroke">
            <title>{m.label}</title>
          </line>
        ))}
      </svg>
      <ol className="rs-lanes">
        {labels.map((l, c) => (
          <li key={c}>
            {l} <small>±{paths[c].span.toFixed(0)}</small>
          </li>
        ))}
      </ol>
    </figure>
  );
}
