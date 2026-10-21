// Live diagnostics drawer. Display only: decimated waveforms from telemetry,
// never the persisted data path. Collapsing it never affects recording.

import { useEffect, useRef, useState } from "react";
import type { Telemetry } from "../SignalPanel";
import { EegStack } from "./charts";
import { research } from "./logger";
import { useLoggerStatus } from "./useResearch";

const f = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));

/** Median and worst rAF interval over the last ~2 s (UI frame timing, not optical). */
function useFrameIntervals() {
  const [stats, setStats] = useState({ median: 0, max: 0 });
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const buf: number[] = [];
    let shown = last;
    const loop = (now: number) => {
      buf.push(now - last);
      last = now;
      if (buf.length > 120) buf.shift();
      if (now - shown > 1000) {
        shown = now;
        const s = [...buf].sort((a, b) => a - b);
        setStats({ median: s[Math.floor(s.length / 2)] ?? 0, max: s[s.length - 1] ?? 0 });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return stats;
}

export default function Diagnostics({
  t,
  frameAgeMs,
  frameSeq,
  usable,
}: {
  t: Telemetry | null;
  frameAgeMs: number | null;
  frameSeq: number | null;
  usable: boolean;
}) {
  const [autoscale, setAutoscale] = useState(false);
  const frames = useFrameIntervals();
  const log = useLoggerStatus();
  const s = t?.research ?? null;
  const electrodes = s?.electrodes ?? [];
  const labels = Array.from({ length: 8 }, (_, i) => `Ch${i + 1}${electrodes[i] ? ` ${electrodes[i]}` : ""}`);
  const rate = t?.sample_rate_hz ?? 250;
  const stride = t?.waveform_stride ?? 5;
  const start = t?.waveform_start_sample ?? 0;
  const width = t?.waveform?.[0]?.length ?? 0;
  const rows = Array.from({ length: width }, (_, i) => ({
    t: (start + i * stride) / rate,
    ch: (t?.waveform ?? []).map((w) => w[i]),
  }));
  const t1 = (start + Math.max(1, width - 1) * stride) / rate;
  const t0 = Math.min(t1 - 1, start / rate);
  const chain = t?.signal_chain;
  const included = (t?.channels ?? []).filter((c) => c.included);
  const recent = useRef(research.recent);
  recent.current = research.recent;
  const events = [...recent.current].slice(-14).reverse();

  return (
    <div className="rs-diag">
      <div className="rs-diag-head">
        <p className="eyebrow">LIVE DIAGNOSTICS · DISPLAY ONLY</p>
        <label className="rs-check">
          <input type="checkbox" checked={autoscale} onChange={(e) => setAutoscale(e.target.checked)} /> Autoscale each channel
        </label>
      </div>
      {width > 1 && t?.source !== "synthetic" ? (
        <EegStack t0={t0} t1={t1} rows={rows} labels={labels} autoscale={autoscale} />
      ) : (
        <p className="rs-note">
          {t?.source === "synthetic" ? "Score-only simulation: there is no raw EEG to show." : "No samples yet."}
        </p>
      )}
      <p className="rs-note">Time axis: last {(t1 - t0).toFixed(1)} s by sample index ({rate} Hz, every {stride}th sample shown).</p>

      <div className="rs-cols">
        <div>
          <h3>Channels in the latest 2 s window</h3>
          <table className="rs-table">
            <thead>
              <tr>
                <th>Ch</th>
                <th>Std µV</th>
                <th>P-p µV</th>
                <th>Rel. α</th>
                <th>In median</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {(t?.channels ?? []).map((c) => (
                <tr key={c.channel} className={c.included ? "" : "rs-excluded"}>
                  <td>{labels[c.channel - 1] ?? c.channel}</td>
                  <td>{f(c.std_uv, 1)}</td>
                  <td>{f(c.ptp_uv, 1)}</td>
                  <td>{f(c.rel_alpha ?? null)}</td>
                  <td>{c.included ? "yes" : "no"}</td>
                  <td>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rs-note">
            Gate: peak-to-peak ≤ {f(t?.gate_max_ptp_uv, 0)} µV. {included.length} of {t?.channels?.length ?? 0} channels
            contribute; the feature is the median of their relative alpha. Colour and wording describe signal quality only.
          </p>
        </div>
        <div>
          <h3>Signal chain</h3>
          <dl className="rs-dl">
            <dt>Feature window</dt>
            <dd>
              samples {chain ? `${chain.sample_start.toLocaleString()}–${chain.sample_end.toLocaleString()}` : "—"} (window #
              {chain?.window_id ?? "—"})
            </dd>
            <dt>Relative alpha (median)</dt>
            <dd>{f(chain?.relative_alpha ?? t?.relative_alpha)}</dd>
            <dt>Baseline center / scale</dt>
            <dd>
              {f(t?.baseline_center)} / {f(t?.baseline_scale)}
            </dd>
            <dt>Mapped target</dt>
            <dd>{f(chain?.mapped_target)}</dd>
            <dt>Smoothed (published) score</dt>
            <dd>{f(chain?.published_score)}</dd>
            <dt>Latest frame</dt>
            <dd>
              #{frameSeq ?? "—"} · {frameAgeMs === null ? "—" : `${Math.round(frameAgeMs)} ms old`} · {usable ? "usable by games" : "not usable"}
            </dd>
            {chain?.problem && (
              <>
                <dt>Window problem</dt>
                <dd className="notice">{chain.problem}</dd>
              </>
            )}
          </dl>
          <h3>Delivery and storage</h3>
          <dl className="rs-dl">
            <dt>Packets</dt>
            <dd>
              {t?.measured_rate_hz ?? "—"} Hz · last {t?.packet_age_ms ?? "—"} ms ago · gaps {t?.timestamp_gaps ?? 0} · counter lost{" "}
              {t?.counter_lost ?? 0}
            </dd>
            <dt>Writer</dt>
            <dd>
              {s
                ? `${s.state} · backlog ${s.backlog} rows · ${s.rows_flushed.toLocaleString()} rows on disk${s.writer_error ? ` · error: ${s.writer_error}` : ""} · losses ${s.losses}`
                : "not recording"}
            </dd>
            <dt>Browser items</dt>
            <dd>
              {log.owned
                ? `${log.queued} queued · ${log.acked}/${log.sent} acknowledged${log.lastError ? ` · last error: ${log.lastError}` : ""}`
                : "this tab is not recording"}
            </dd>
            <dt>UI frame interval</dt>
            <dd>
              median {frames.median.toFixed(1)} ms · worst {frames.max.toFixed(1)} ms (software timing)
            </dd>
          </dl>
        </div>
        <div>
          <h3>Event timeline (this tab)</h3>
          {events.length ? (
            <ol className="rs-events">
              {events.map((e, i) => (
                <li key={i}>
                  <time>{new Date(e.t).toLocaleTimeString()}</time> <b>{e.type}</b>
                  {e.game ? ` · ${e.game}` : ""}
                  {e.reason ? ` · ${e.reason}` : ""}
                </li>
              ))}
            </ol>
          ) : (
            <p className="rs-note">Events appear here while this tab is recording.</p>
          )}
          <p className="rs-note">Marker shortcut: Alt+M (⌥M) when no text field is focused.</p>
        </div>
      </div>
    </div>
  );
}
