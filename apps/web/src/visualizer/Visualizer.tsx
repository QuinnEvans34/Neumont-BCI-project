import { useEffect, useMemo, useState, type RefObject } from "react";
import type { Telemetry } from "../SignalPanel";
import { sourceName } from "../SignalPanel";
import { EegStack } from "../research/charts";
import type { CairnRecord } from "../cairnScores";
import BrowserHistory from "./BrowserHistory";
import { API, research } from "../research/logger";
import { Plot, Histogram, type Trace } from "./Plots";
import { COLORS, chartPoints, elapsed, histogram, keyOf, percent, pretty, value,
  type Analysis, type Channel, type Event, type LiveData, type Row, type Run } from "./model";
import "./visualizer.css";

type Mode = "live" | "recordings" | "compare" | "history";
const openable = (r: Run) => !r.problem && !["recording", "finalizing", "running", "saving", "missing", "destination_unavailable"].includes(r.state);
const err = (e: unknown) => e instanceof Error ? e.message : String(e);

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${API}/api/visualizer/${path}`, { signal, cache: "no-store" });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail ?? `Request failed (${r.status})`);
  return data;
}
function analysisQuery(run: Run, start: number, span: number, gate: number) {
  return `analysis?${new URLSearchParams({ kind: run.kind, id: run.id, start: String(start), end: String(start + span), gate: String(gate) })}`;
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Visualizer({ telemetry, live, usable, connected, frameAgeMs, cairnRecord }: {
  telemetry: Telemetry | null; live: RefObject<LiveData>; usable: boolean; connected: boolean; frameAgeMs: number | null;
  cairnRecord: CairnRecord;
}) {
  const [mode, setMode] = useState<Mode>("live");
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("");
  const [comparison, setComparison] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    get<{ runs: Run[] }>("runs", controller.signal).then(({ runs: next }) => {
      setRuns(next);
      setSelected((old) => next.some((r) => keyOf(r) === old) ? old : next.find(openable) ? keyOf(next.find(openable)!) : "");
      setComparison((old) => old.length ? old.filter((id) => next.some((r) => keyOf(r) === id)) : next.filter(openable).slice(0, 2).map(keyOf));
    }).catch((e) => { if (e.name !== "AbortError") setError(err(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, telemetry?.research?.state, telemetry?.experiment?.state]);

  const shown = runs.filter((r) => `${r.label} ${r.participant_id ?? ""} ${r.condition ?? ""} ${r.sources.join(" ")} ${r.games.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  const run = runs.find((r) => keyOf(r) === selected);
  const selectedRuns = useMemo(() => comparison.map((id) => runs.find((r) => keyOf(r) === id)).filter((r): r is Run => !!r), [comparison, runs]);

  return <section className="vz" aria-label="Data visualizer">
    <div className="vz-heading"><div><p className="eyebrow">05 / VISUALIZER</p><h1>See the signal.<br /><em>Find the patterns.</em></h1>
      <p>Explore the stream, revisit a recording, and put your runs side by side.</p></div>
      <div className="vz-heading-note"><span className="vz-dot" /> YOUR DATA, IN CONTEXT<small>EEG · signal quality · game performance · events</small></div>
    </div>
    <div className="vz-toolbar"><div className="vz-tabs" aria-label="Visualizer views">{(["live", "recordings", "compare", "history"] as Mode[]).map((m) =>
      <button key={m} aria-pressed={mode === m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>{m === "live" ? "Live stream" : m === "recordings" ? "Recorded runs" : m === "compare" ? "Compare runs" : "Game history"}</button>)}</div>
      <button className="secondary vz-refresh" onClick={() => setRevision((n) => n + 1)} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh recordings"}</button>
    </div>
    {error && <p role="alert" className="notice">Could not load recordings: {error}. Start the Python backend, then refresh.</p>}
    {mode === "live" ? <LiveView t={telemetry} live={live.current} usable={usable} connected={connected} frameAgeMs={frameAgeMs} /> : mode === "history" ? <BrowserHistory record={cairnRecord} /> : <>
      <div className="vz-library-head"><div><h2>{mode === "compare" ? "Choose your comparison" : "Your recording library"}</h2><p>{runs.length} available · raw EEG, research sessions, and experiments</p></div>
        <label className="vz-search">Find a run<input type="search" placeholder="Participant, game, source, or recording…" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      </div>
      {mode === "compare" ? <>
        <div className="vz-run-grid">{shown.map((r) => <label key={keyOf(r)} className={`vz-run-option ${comparison.includes(keyOf(r)) ? "chosen" : ""}`}>
          <input type="checkbox" checked={comparison.includes(keyOf(r))} disabled={!openable(r) || !comparison.includes(keyOf(r)) && comparison.length >= 4}
            onChange={(e) => setComparison((ids) => e.target.checked ? [...ids, keyOf(r)] : ids.filter((id) => id !== keyOf(r)))} />
          <span><b>{r.label}</b><small>{r.kind} · {r.sources.map(sourceName).join(", ")} · {pretty(r.state)}</small></span>
        </label>)}</div><p className="rs-note">Select 2–4 runs. Match source, game mode, calibration and conditions when interpreting differences.</p>
        <Compare runs={selectedRuns} revision={revision} />
      </> : <>
        <div className="vz-table-wrap"><table className="vz-table vz-library"><thead><tr><th>Recording / participant</th><th>Data</th><th>Source / games</th><th>Duration</th><th>Status</th><th /></tr></thead><tbody>
          {shown.map((r) => <tr key={keyOf(r)} className={keyOf(r) === selected ? "selected" : ""}>
            <td><b>{r.label}</b>{r.condition && <small>{r.condition}</small>}{r.started_at && <small>{new Date(r.started_at).toLocaleString()}</small>}</td>
            <td><span className="vz-badge">{r.kind === "raw" ? "Raw EEG" : r.kind === "research" ? "Research" : "Experiment"}</span></td>
            <td>{r.sources.map(sourceName).join(", ")}<small>{r.games.map(pretty).join(" · ") || "EEG only"}</small></td>
            <td>{r.duration_s != null ? elapsed(r.duration_s) : "On inspection"}</td>
            <td><span className={`vz-state ${r.state === "saved" ? "good" : ""}`}>{pretty(r.state)}</span>{r.problem && <small>{r.problem}</small>}</td>
            <td><button className="secondary" disabled={!openable(r)} onClick={() => setSelected(keyOf(r))}>{keyOf(r) === selected ? "Selected" : "Inspect"}</button></td>
          </tr>)}
          {!shown.length && <tr><td colSpan={6}>{loading ? "Loading recordings…" : runs.length ? "No runs match your search." : "No recordings yet. Use Research / Dev Mode to record a session, or add BrainFlow files to data/recordings."}</td></tr>}
        </tbody></table></div>
        {run && openable(run) && <RecordedView key={selected} run={run} revision={revision} onCompare={() => {
          setComparison((ids) => ids.includes(selected) ? ids : [selected, ...ids].slice(0, 4)); setMode("compare");
        }} />}
      </>}
    </>}
  </section>;
}

function Stat({ label, main, note }: { label: string; main: string; note: string }) {
  return <div className="vz-stat"><small>{label}</small><strong>{main}</strong><span>{note}</span></div>;
}

function LiveView({ t, live, usable, connected, frameAgeMs }: { t: Telemetry | null; live: LiveData; usable: boolean; connected: boolean; frameAgeMs: number | null }) {
  const [autoscale, setAutoscale] = useState(true);
  const [frozen, setFrozen] = useState<LiveData | null>(null);
  useEffect(() => setFrozen(null), [live.session]);
  const current = frozen ?? live;
  const points = current.points;
  const latest = points[points.length - 1];
  const x1 = Math.max(30, latest?.t ?? 30), x0 = Math.max(0, x1 - 300);
  const valid = live.points.filter((p) => p.score !== null);
  const published = live.points[live.points.length - 1]?.score;
  const score = valid.length ? valid.reduce((n, p) => n + p.score!, 0) / valid.length : null;
  const included = t?.channels.filter((c) => c.included).length ?? 0;
  const width = t?.waveform[0]?.length ?? 0, rate = t?.sample_rate_hz ?? 250;
  const waveStart = (t?.waveform_start_sample ?? 0) / rate;
  const waveEnd = waveStart + Math.max(1, width - 1) * (t?.waveform_stride ?? 5) / rate;
  const rows = Array.from({ length: width }, (_, i) => ({ t: waveStart + i * (t?.waveform_stride ?? 5) / rate, ch: t!.waveform.map((c) => c[i]) }));
  const events: Event[] = research.recent.slice(-40).reverse().map((e) => ({ t: e.t / 1000 - live.started, type: e.type, game: e.game ?? undefined, reason: e.reason ?? undefined }));
  const channels: Channel[] = (t?.channels ?? []).map((c) => ({ channel: c.channel, label: `Ch${c.channel}`, windows: 1,
    included_pct: c.included ? 100 : 0, std_uv: c.std_uv, ptp_uv: c.ptp_uv, relative_alpha: c.rel_alpha ?? null, reasons: c.included ? {} : { [c.reason]: 1 } }));

  return <>
    <div className="vz-section-head"><div><h2><span className={`vz-dot ${usable ? "" : "muted"}`} />{t?.session_id ? sourceName(t.source) : "No input connected"}</h2>
      <p>{t ? pretty(t.state) : connected ? "Waiting for stream telemetry" : "Backend offline"} · rolling 5-minute signal view</p></div>
      <button className="secondary" disabled={!points.length} aria-pressed={!!frozen} onClick={() => setFrozen(frozen ? null : structuredClone(live))}>{frozen ? "Resume chart" : "Freeze signal charts"}</button>
    </div>
    {(!t?.session_id || !connected) && <div className="vz-empty"><h3>Ready when your signal is.</h3><p>Connect a headset, replay, or simulation in Connect. Saved recordings remain available in Recorded runs.</p></div>}
    {t?.source === "simulated_eeg" || t?.source === "synthetic" ? <p className="vz-context">Simulation data · generated for pipeline testing; no participant EEG.</p> : t?.source === "replay" ? <p className="vz-context">Recorded EEG replay · the live view follows playback, with its current calibration and settings.</p> : null}
    <div className="vz-stats">
      <Stat label="PUBLISHED SCORE" main={usable && published != null ? percent(published * 100) : "—"} note={usable ? "Usable by the game" : "Waiting for usable calibrated input"} />
      <Stat label="CHANNELS INCLUDED" main={t?.source === "synthetic" ? "No EEG" : `${included} / 8`} note={`Latest 2 s · ${value(t?.gate_max_ptp_uv, 0)} µV gate`} />
      <Stat label="SAMPLE DELIVERY" main={t?.source === "synthetic" ? "Score only" : `${value(t?.measured_rate_hz, 1)} Hz`} note={`${value(t?.samples_received, 0)} received samples`} />
      <Stat label="MEAN USABLE SCORE" main={score === null ? "—" : percent(score * 100)} note={`${valid.length} usable frames in rolling view`} />
    </div>
    <div className="vz-card"><div className="vz-section-head"><h3>Signal through time</h3><span className="vz-badge">{frozen ? "Charts frozen · acquisition continues" : "Live · last 5 min"}</span></div>
      <Plot title="Feature & game input" x0={x0} x1={x1} min={0} max={1} unit="Ratio / score (0–1)" traces={[
        { label: "Relative alpha", color: COLORS[2], points: points.map((p) => [p.t, p.alpha]) },
        { label: "Mapped target", color: COLORS[1], points: points.map((p) => [p.t, p.target]) },
        { label: "Published score", color: COLORS[0], points: points.map((p) => [p.t, p.score]) },
      ]} />
      <p className="rs-note">Gaps in the published score indicate unusable input. History starts when this app opens, clears on a new acquisition, and stays in memory. Freezing affects these signal charts only.</p>
      <Plot title="Channels contributing to the feature" x0={x0} x1={x1} min={0} max={8} height={120} unit="Channels" traces={[{ label: "Included", color: COLORS[0], step: true, points: points.map((p) => [p.t, p.included]) }]} />
    </div>
    <div className="vz-card"><div className="vz-section-head"><h3>Raw EEG · current window</h3><label className="vz-check"><input type="checkbox" checked={autoscale} onChange={(e) => setAutoscale(e.target.checked)} /> Autoscale channels</label></div>
      {width && t?.source !== "synthetic" ? <><EegStack t0={waveStart} t1={waveEnd} rows={rows} labels={Array.from({ length: 8 }, (_, i) => `Ch${i+1}`)} autoscale={autoscale} />
        <p className="rs-note">Sample time {value(waveStart, 1)}–{value(waveEnd, 1)} s · {t?.waveform_stride}× display decimation. Spectra are available for saved full-rate EEG.</p></> : <p>No raw EEG is available for this input.</p>}
    </div>
    <div className="vz-two"><div className="vz-card"><h3>Channel quality · latest window</h3><Channels channels={channels} live /></div>
      <div className="vz-card"><h3>Delivery & recording health</h3><dl className="vz-facts">
        <dt>Input frame age</dt><dd>{frameAgeMs === null ? "—" : `${value(frameAgeMs, 0)} ms`}</dd>
        <dt>Baseline center / spread</dt><dd>{value(t?.baseline_center, 4)} / {value(t?.baseline_scale, 4)}</dd>
        <dt>Sample bounds</dt><dd>{t?.signal_chain ? `${t.signal_chain.sample_start}–${t.signal_chain.sample_end}` : "—"}</dd>
        <dt>Lost / corrupt counters</dt><dd>{value(t?.counter_lost, 0)} / {value(t?.counter_corrupt, 0)}</dd>
        <dt>Timestamp gaps</dt><dd>{value(t?.timestamp_gaps, 0)}</dd>
        <dt>Capture</dt><dd>{t?.research ? pretty(t.research.state) : "Not recording"}</dd>
        <dt>Flushed EEG samples</dt><dd>{value(t?.research?.samples_flushed, 0)}</dd>
        <dt>Writer backlog / losses</dt><dd>{value(t?.research?.backlog, 0)} / {value(t?.research?.losses, 0)}</dd>
      </dl>{t?.research?.writer_error && <p role="alert" className="notice">{t.research.writer_error}</p>}
        <h3>Recent events</h3><Events events={events.slice(0, 10)} />
        <p className="rs-note">Game events appear while this tab owns a Research / Dev Mode recording. Use Start… in the recording bar to preserve the complete session.</p>
      </div></div>
  </>;
}

function Channels({ channels, live = false }: { channels: Channel[]; live?: boolean }) {
  return <div className="vz-table-wrap"><table className="vz-table"><thead><tr><th>Channel</th><th>{live ? "Included" : "Inclusion rate"}</th><th>{live ? "SD µV" : "Mean SD µV"}</th><th>{live ? "P-p µV" : "Max p-p µV"}</th><th>Rel. α</th></tr></thead><tbody>
    {channels.map((c) => <tr key={c.channel}><td><b>{c.label}</b><small>{Object.entries(c.reasons).map(([reason, count]) => `${reason}${live ? "" : ` (${count})`}`).join("; ")}</small></td>
      <td><div className="vz-meter"><i style={{ width: `${c.included_pct ?? 0}%` }} /></div><span>{live && c.included_pct !== null ? c.included_pct ? "Yes" : "Excluded" : percent(c.included_pct)}</span></td>
      <td>{value(c.std_uv, 1)}</td><td>{value(c.ptp_uv, 1)}</td><td>{value(c.relative_alpha, 3)}</td></tr>)}
    {!channels.length && <tr><td colSpan={5}>No channel metrics yet.</td></tr>}
  </tbody></table></div>;
}

function Events({ events, seek }: { events: Event[]; seek?: (t: number) => void }) {
  return <ol className="vz-events">{events.map((e, i) => <li key={i}><time>{elapsed(Math.max(0, e.t))}</time><div><b>{pretty(e.type)}</b><span>{[e.game, e.reason].filter(Boolean).join(" · ")}</span></div>
    {seek && <button className="secondary" onClick={() => seek(Math.max(0, e.t - 10))}>Inspect</button>}</li>)}{!events.length && <li>No events available in this view.</li>}</ol>;
}

function RecordedView({ run, revision, onCompare }: { run: Run; revision: number; onCompare: () => void }) {
  const [start, setStart] = useState(0), [span, setSpan] = useState(30), [gate, setGate] = useState(500);
  const [data, setData] = useState<Analysis | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [autoscale, setAutoscale] = useState(true);
  const [section, setSection] = useState<"signals" | "games" | "data">("signals");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    get<Analysis>(analysisQuery(run, start, span, gate), controller.signal).then(setData)
      .catch((e) => { if (e.name !== "AbortError") { setError(err(e)); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [run.id, run.kind, start, span, gate, revision]);
  const duration = data?.summary.duration_s ?? run.duration_s ?? 0;
  const maxStart = Math.max(0, duration - span);
  const seek = (t: number) => setStart(Math.min(maxStart, Math.max(0, t)));
  const marks = data?.selection.events.filter((e) => ["marker", "cairn_fell", "full_bloom", "stage_changed", "gust_started", "bug_started"].includes(e.type)).map((e) => ({ t: e.t, label: pretty(e.type) })) ?? [];

  return <div className="vz-inspector">
    <div className="vz-section-head"><div><p className="eyebrow">RECORDING INSPECTOR</p><h2>{run.label}</h2><p>{run.sources.map(sourceName).join(" · ")} · {pretty(run.state)}{run.condition ? ` · ${run.condition}` : ""}</p></div>
      <div className="vz-actions"><button className="secondary" onClick={onCompare}>Compare this run</button>{run.export_url && <a className="vz-button" href={`${API}${run.export_url}`} download>Download full ZIP ↗</a>}
        {data && <button className="secondary" onClick={() => download(`run-${run.id.split(":").pop()!.replaceAll("/", "-")}-summary.json`, JSON.stringify({ run: data.run, summary: data.summary, channels: data.channels, event_counts: data.event_counts, notes: data.notes }, null, 2), "application/json")}>Export summary</button>}</div>
    </div>
    {run.state !== "saved" && <p className="vz-context">Recording status: {pretty(run.state)}. Incomplete captures and missing intervals can affect comparisons.</p>}
    {error && <p role="alert" className="notice">Unable to inspect this run: {error}</p>}
    {data && <>
      <div className="vz-stats"><Stat label="RECORDED DURATION" main={elapsed(data.summary.duration_s)} note={`${value(data.summary.samples, 0)} full-rate EEG samples`} />
        <Stat label="ACCEPTED WINDOWS" main={percent(data.summary.accepted_pct)} note={`${value(data.summary.windows, 0)} analyzed signal windows`} />
        <Stat label="MEAN RELATIVE ALPHA" main={value(data.summary.mean_alpha, 3)} note="Included channel median · ratio" />
        <Stat label="MEAN USABLE SCORE" main={data.summary.mean_score === null ? "—" : percent(data.summary.mean_score * 100)} note={`${value(data.summary.rounds, 0)} rounds · ${value(data.summary.events, 0)} events`} />
      </div>
      <Insights data={data} />
    </>}
    <div className="vz-range vz-card"><div><h3>Inspect a time window</h3><p>{elapsed(start)} — {elapsed(Math.min(duration || span, start + span))} / {elapsed(duration)} elapsed</p></div>
      <div className="vz-range-controls"><button className="secondary" disabled={start <= 0 || loading} onClick={() => seek(start - span)}>← Earlier</button>
        <label>Window<select value={span} onChange={(e) => { setSpan(Number(e.target.value)); setStart(0); }}>{[10, 30, 60, 120].map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>
        <button className="secondary" disabled={start >= maxStart || loading} onClick={() => seek(start + span)}>Later →</button>
        <label>{run.kind === "raw" ? "Offline feature / PSD gate" : "PSD analysis gate"}<select value={gate} onChange={(e) => setGate(Number(e.target.value))}>{[100, 250, 500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n} µV p-p</option>)}</select></label>
      </div><label className="vz-seek">Window start · seconds<input aria-label="Recording window start" type="range" min="0" max={maxStart} step="0.1" value={Math.min(start, maxStart)} onChange={(e) => setStart(Number(e.target.value))} /></label>
      <p className="rs-note">Full-run statistics stay visible while you inspect an interval. The analysis gate only changes offline calculations; recorded research metrics retain their original gates.</p>
    </div>
    <div className="vz-tabs vz-subtabs" aria-label="Recording views">{(["signals", "games", "data"] as const).map((s) => <button key={s} aria-pressed={section === s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>{s === "signals" ? "Signal analysis" : s === "games" ? "Games & events" : "All recorded data"}</button>)}</div>
    {loading && <p className="vz-loading" role="status">Analyzing full-rate data…</p>}
    {data && !loading && <>
      {section === "signals" && <>
        <div className="vz-card"><Plot title="Full-run overview" x1={Math.max(1, duration)} min={0} max={1} unit="Ratio / score (0–1)" height={130} traces={[
          { label: "Relative alpha", color: COLORS[2], points: data.series.relative_alpha ?? [] },
          { label: "Usable frame score", color: COLORS[0], points: data.series.score ?? [] },
        ]} /><p className="rs-note">Use the time-window controls to inspect a section of this overview.</p></div>
        <div className="vz-card"><Plot title="Signal & score" x0={start} x1={start + span} min={0} max={1} unit="Ratio / score (0–1)" marks={marks} traces={[
          { label: "Relative alpha", color: COLORS[2], points: data.series.relative_alpha ?? [] },
          { label: "Mapped target", color: COLORS[1], points: data.series.target ?? [] },
          { label: "Usable frame score", color: COLORS[0], points: data.series.score ?? [] },
        ]} /><p className="rs-note">Relative alpha is a spectral ratio. The score is baseline-mapped and smoothed. Raw files have no saved game score.</p></div>
        <div className="vz-card"><div className="vz-section-head"><h3>Raw EEG · selected interval</h3><label className="vz-check"><input type="checkbox" checked={autoscale} onChange={(e) => setAutoscale(e.target.checked)} /> Autoscale channels</label></div>
          {data.eeg.length ? <EegStack t0={start} t1={start + span} rows={data.eeg} labels={data.channels.map((c) => c.label)} autoscale={autoscale} marks={marks} /> : <p>No EEG samples in this interval.</p>}
          <p className="rs-note">{value(data.eeg_samples_in_range, 0)} samples in interval · every {data.eeg_stride}th sample displayed · seconds from run start. {data.selection.eeg_time_basis}</p>
        </div>
        <div className="vz-two"><div className="vz-card"><Plot title="Power spectral density · selected interval" traces={[{ label: "Accepted channel/windows", color: COLORS[1], points: data.spectrum.points }]} x0={1} x1={40} min={0} axis="Frequency (Hz)" unit="µV²/Hz" />
          <p className="rs-note">{data.spectrum.method} {data.spectrum.channel_windows} accepted channel/windows. No spectrum means no accepted full windows.</p></div>
          <div className="vz-card"><Histogram counts={data.distribution} label={data.distribution_metric} /></div></div>
        {run.kind === "experiment" && <ExperimentPlots data={data} start={start} end={start + span} />}
        <div className="vz-card"><h3>Channel quality · full run</h3><Channels channels={data.channels} /><p className="rs-note">SD is averaged over windows; peak-to-peak is the largest window span. Inclusion is the fraction of analyzed channel windows. Relative alpha excludes rejected windows.</p></div>
      </>}
      {section === "games" && <>
        <GamePlots data={data} start={start} end={start + span} marks={marks} />
        <div className="vz-two"><div className="vz-card"><h3>Events in this interval</h3><Events events={data.selection.events} seek={seek} />
          <p className="rs-note">Up to 500 events displayed per interval. The table explorer exposes every recorded row.</p></div>
          <div className="vz-card"><h3>Event counts · full run</h3><div className="vz-event-counts">{Object.entries(data.event_counts).sort((a,b) => b[1] - a[1]).map(([name, count]) => <div key={name}><span>{pretty(name)}</span><b>{value(count, 0)}</b></div>)}</div>
            {!Object.keys(data.event_counts).length && <p>This recording has no saved game events.</p>}</div></div>
        <div className="vz-card"><h3>Rounds & plants</h3><RoundTable rows={data.rounds} />{data.calibrations.length > 0 && <p className="rs-note">{data.calibrations.length} calibration attempts recorded. Inspect calibrations in All recorded data for gates, results, medians and spreads.</p>}</div>
      </>}
      {section === "data" && <><DataExplorer run={run} tables={data.tables} /><details className="vz-card"><summary>Recording metadata & experiment summary</summary><pre className="vz-json">{JSON.stringify(data.metadata ?? { ...data.run, notes: data.notes }, null, 2)}</pre></details></>}
      <div className="vz-methods">{data.notes.map((note, i) => <p key={i}>{note}</p>)}</div>
    </>}
  </div>;
}

function Insights({ data }: { data: Analysis }) {
  const s = data.summary;
  const valid = data.channels.filter((c) => c.included_pct !== null).sort((a,b) => b.included_pct! - a.included_pct!);
  return <div className="vz-insights" aria-label="Run observations"><span>OBSERVATIONS</span>
    {s.accepted_pct !== null && <p><b>{percent(s.accepted_pct)} window acceptance.</b> {s.accepted_pct < 50 ? "Many windows were excluded; inspect channel amplitudes and rejection reasons before comparing features." : "Review channel inclusion to see which channels contributed."}</p>}
    {valid.length > 0 && <p><b>{valid[0].label}</b> has the highest inclusion rate ({percent(valid[0].included_pct)}).</p>}
    {s.score_above_pct !== null && <p><b>{percent(s.score_above_pct)}</b> of usable calibrated frames exceeded the 0.5 game baseline.</p>}
    {(s.losses > 0 || (s.backwards_timestamps ?? 0) > 0) && <p className="notice">{s.losses} recorded losses; {s.backwards_timestamps ?? 0} backwards timestamps. Inspect completeness before interpreting the run.</p>}
    {s.mean_alpha === null && s.mean_score === null && <p>No accepted signal feature or game score is available. Use the EEG and recorded tables to inspect the data.</p>}
  </div>;
}

function ExperimentPlots({ data, start, end }: { data: Analysis; start: number; end: number }) {
  const bands = ["theta", "alpha", "beta"].filter((name) => data.series[`band_${name}`]?.length);
  const cca = Object.keys(data.series).filter((key) => key.startsWith("cca_"));
  return <>{bands.length > 0 && <div className="vz-card"><Plot title="Bilateral experiment · recorded band power" unit="µV² · mean of valid channels" x0={start} x1={end} min={0}
    traces={bands.map((name, i) => ({ label: `${name} (${name === "theta" ? "4–<8" : name === "alpha" ? "8–<12" : "12–30"} Hz)`, color: COLORS[i], points: data.series[`band_${name}`] }))} />
    <p className="rs-note">Original experiment metrics, with their original quality gate. Band power is distinct from the relative-alpha scoring ratio.</p></div>}
    {cca.length > 0 && <div className="vz-card"><Plot title="SSVEP experiment · recorded CCA correlations" unit="Correlation (0–1)" x0={start} x1={end} min={0} max={1}
      traces={cca.map((key, i) => ({ label: pretty(key.replace("cca_", "")), color: COLORS[i % COLORS.length], points: data.series[key] }))} />
      <p className="rs-note">Correlations are recorded decoder evidence. Trial decisions, abstentions, thresholds and evaluation counts are in the predictions table and experiment summary.</p></div>}</>;
}

const GAME_GROUPS = [
  { title: "Cairn · stones placed", unit: "Stones", fields: ["cairn_stones"] },
  { title: "Cairn · sway & runtime limits", unit: "Radians", fields: ["cairn_sway_rad", "cairn_fall_angle_rad", "cairn_drop_sway_rad"] },
  { title: "Cairn · modeled response & effects", unit: "Model values (0–1)", fields: ["cairn_focus", "cairn_unrest", "cairn_gust_load", "cairn_flicker_effective"] },
  { title: "Garden · growth & response", unit: "Model values (0–1)", fields: ["garden_growth", "garden_response", "garden_drive"] },
  { title: "Garden · pace & time above baseline", unit: "Seconds", fields: ["garden_pace_s", "garden_above_s"] },
];
function GamePlots({ data, start, end, marks }: { data: Analysis; start: number; end: number; marks: { t: number; label: string }[] }) {
  const groups = GAME_GROUPS.filter((g) => g.fields.some((f) => data.series[f]?.length));
  return <>{groups.map((g) => <div className="vz-card" key={g.title}><Plot title={g.title} unit={g.unit} x0={start} x1={end} min={0} marks={marks}
    traces={g.fields.filter((f) => data.series[f]?.length).map((f, i) => ({ label: pretty(f.replace(/^(cairn|garden)_/, "")), color: COLORS[i], points: data.series[f], step: f.includes("stones") || f.includes("effective") }))} /></div>)}
    {!groups.length && <div className="vz-empty"><h3>No game-state tracks in this recording.</h3><p>Research recordings preserve Cairn and Garden state. Raw EEG files contain signal samples only. Experiment metrics and predictions are in All recorded data.</p></div>}</>;
}

function RoundTable({ rows }: { rows: Row[] }) {
  const summary = (r: Row) => {
    try { const s = JSON.parse(String(r.summary_json ?? "{}")); return Object.entries(s).filter(([k, v]) => ["stones", "growth", "stage", "above_s", "mean_score"].includes(k) && typeof v !== "object").map(([k,v]) => `${pretty(k)}: ${typeof v === "number" ? value(v, 3) : v}`).join(" · "); } catch { return ""; }
  };
  return <div className="vz-table-wrap"><table className="vz-table"><thead><tr><th>Round</th><th>Game / mode</th><th>Outcome</th><th>Active time</th><th>Partial start</th><th>Summary</th></tr></thead><tbody>
    {rows.map((r, i) => <tr key={String(r.round_id ?? i)}><td>{String(r.round_id ?? "").slice(0, 8)}</td><td>{String(r.game)} / {String(r.mode ?? "—")}</td><td>{pretty(String(r.outcome ?? "—"))}</td><td>{value(r.active_s, 1)} s</td><td>{r.partial_start ? "Yes" : "No"}</td><td>{summary(r) || "See rounds table"}</td></tr>)}
    {!rows.length && <tr><td colSpan={6}>No saved rounds. Full round summaries, including zero-progress rounds, appear here after research capture.</td></tr>}
  </tbody></table></div>;
}

function DataExplorer({ run, tables }: { run: Run; tables: Analysis["tables"] }) {
  const [table, setTable] = useState(tables.find((t) => t.name === "signal_windows" && t.count)?.name ?? tables[0]?.name ?? "eeg");
  const [offset, setOffset] = useState(0), [data, setData] = useState<{ columns: { name: string; unit: string; description: string }[]; rows: Row[]; has_more: boolean } | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setLoading(true); setError("");
    get<NonNullable<typeof data>>(`table?${new URLSearchParams({ kind: run.kind, id: run.id, table, offset: String(offset), limit: "50" })}`, controller.signal)
      .then(setData).catch((e) => { if (e.name !== "AbortError") setError(err(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [run.kind, run.id, table, offset]);
  const cell = (v: unknown) => v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return <div className="vz-card"><div className="vz-section-head"><div><h3>Explore every recorded table</h3><p>Original values, 50 rows at a time. Hover column names for units and definitions.</p></div>
    <label className="vz-table-select">Table<select value={table} onChange={(e) => { setTable(e.target.value); setOffset(0); }}>{tables.map((t) => <option key={t.name} value={t.name}>{pretty(t.name)}{t.count != null ? ` · ${value(t.count, 0)} rows` : ""}</option>)}</select></label>
    {run.kind === "research" && <a className="vz-button" download href={`${API}/api/research/recordings/${run.id}/tables/${table}.csv`}>Download table CSV</a>}
  </div>
    {error && <p role="alert" className="notice">{error}</p>}{loading && <p role="status">Loading rows…</p>}
    {data && <div className="vz-table-wrap vz-data-scroll" tabIndex={0} aria-label={`${pretty(table)} data table`}><table className="vz-table"><thead><tr>{data.columns.map((c) => <th key={c.name} title={`${c.description}${c.unit ? ` (${c.unit})` : ""}`}>{c.name}{c.unit && <small>{c.unit}</small>}</th>)}</tr></thead><tbody>
      {data.rows.map((r, i) => <tr key={offset+i}>{data.columns.map((c) => <td key={c.name} title={cell(r[c.name])}>{cell(r[c.name])}</td>)}</tr>)}
      {!data.rows.length && <tr><td colSpan={Math.max(1, data.columns.length)}>No rows in this table.</td></tr>}
    </tbody></table></div>}
    <div className="vz-pagination"><button className="secondary" disabled={offset === 0 || loading} onClick={() => setOffset((n) => Math.max(0, n - 50))}>← Previous</button>
      <span>{data?.rows.length ? `Rows ${offset+1}–${offset+data.rows.length}` : "No rows"}</span>
      <button className="secondary" disabled={!data?.has_more || loading} onClick={() => setOffset((n) => n + 50)}>Next →</button></div>
  </div>;
}

const COMPARE_METRICS = [
  ["relative_alpha", "Relative alpha", "Ratio (0–1)"], ["score", "Usable frame score", "Score (0–1)"],
  ["cairn_stones", "Cairn stones", "Stones"], ["cairn_sway_rad", "Cairn sway", "Radians"],
  ["garden_growth", "Garden growth", "Growth (0–1)"], ["garden_response", "Garden response", "Response (0–1)"],
];
function Compare({ runs, revision }: { runs: Run[]; revision: number }) {
  const [results, setResults] = useState<{ data?: Analysis; error?: string }[]>([]);
  const [loading, setLoading] = useState(false), [metric, setMetric] = useState("relative_alpha");
  const [normalized, setNormalized] = useState(false), [gate, setGate] = useState(500);
  useEffect(() => {
    const controller = new AbortController(); setResults([]); setLoading(true);
    Promise.all(runs.map(async (run) => {
      try { return { data: await get<Analysis>(analysisQuery(run, 0, 30, gate), controller.signal) }; }
      catch (e) { return { error: `${run.label}: ${err(e)}` }; }
    })).then((r) => { if (!controller.signal.aborted) { setResults(r); setLoading(false); } });
    return () => controller.abort();
  }, [runs, revision, gate]);
  const datasets = results.flatMap((r) => r.data ? [r.data] : []);
  const metrics = COMPARE_METRICS.find((m) => m[0] === metric)!;
  const maximum = normalized ? 100 : Math.max(1, ...datasets.map((d) => d.summary.duration_s));
  const traces: Trace[] = datasets.map((d, i) => ({ label: `${i+1}. ${d.run.label}`, color: COLORS[i],
    points: chartPoints(d.series[metric] ?? [], d.summary.duration_s, normalized), step: metric === "cairn_stones" }));
  const fields: { label: string; read: (d: Analysis) => number | null; format?: (n: number | null) => string }[] = [
    { label: "Duration (s)", read: (d) => d.summary.duration_s },
    { label: "EEG samples", read: (d) => d.summary.samples },
    { label: "Accepted windows (%)", read: (d) => d.summary.accepted_pct },
    { label: "Mean relative alpha", read: (d) => d.summary.mean_alpha },
    { label: "Mean usable score", read: (d) => d.summary.mean_score },
    { label: "Frames above 0.5 (%)", read: (d) => d.summary.score_above_pct },
    { label: "Rounds / plants", read: (d) => d.summary.rounds },
    { label: "Events", read: (d) => d.summary.events },
    { label: "Recorded losses", read: (d) => d.summary.losses },
  ];
  function exportComparison() {
    const safe = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
    const lines = [["Run ID", "Kind", "Source", "Run", ...fields.map((f) => f.label)].map(safe).join(","),
      ...datasets.map((d) => [safe(d.run.id), safe(d.run.kind), safe(d.run.sources.join("; ")), safe(d.run.label), ...fields.map((f) => f.read(d) ?? "")].join(","))];
    download("run-comparison.csv", lines.join("\r\n"), "text/csv;charset=utf-8");
  }
  if (runs.length < 2) return <div className="vz-empty"><h3>Choose at least two runs to compare.</h3><p>Compare up to four raw EEG files, research recordings, or experiments. Missing measurements stay blank.</p></div>;
  return <div className="vz-comparison">
    <div className="vz-section-head"><h2>A shared view. Different runs.</h2><button className="secondary" disabled={datasets.length < 2 || loading} onClick={exportComparison}>Export comparison CSV</button></div>
    <div className="vz-compare-controls"><label>Overlay metric<select value={metric} onChange={(e) => setMetric(e.target.value)}>{COMPARE_METRICS.map(([k,label]) => <option key={k} value={k}>{label}</option>)}</select></label>
      <label>Time alignment<select value={normalized ? "normalized" : "elapsed"} onChange={(e) => setNormalized(e.target.value === "normalized")}><option value="elapsed">Seconds from run start</option><option value="normalized">Run progress (0–100%)</option></select></label>
      <label>Raw EEG analysis gate<select value={gate} onChange={(e) => setGate(Number(e.target.value))}>{[100, 250, 500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n} µV p-p</option>)}</select></label>
    </div>
    {loading && <p role="status" className="vz-loading">Analyzing selected runs…</p>}
    {results.filter((r) => r.error).map((r, i) => <p key={i} role="alert" className="notice">{r.error}</p>)}
    {datasets.length > 0 && <><div className="vz-card"><Plot title={`${metrics[1]} · run overlay`} traces={traces} x1={maximum} min={0} max={["relative_alpha", "score", "garden_growth", "garden_response"].includes(metric) ? 1 : undefined} axis={normalized ? "Run progress (%)" : "Elapsed seconds"} unit={metrics[2]} height={230} />
      <p className="rs-note">Each run starts at zero. Progress alignment rescales time and does not align physiological responses. Empty tracks mean the metric was not recorded or no windows passed the gate.</p></div>
      <div className="vz-card"><h3>Full-run statistics</h3><div className="vz-table-wrap"><table className="vz-table vz-comparison-table"><thead><tr><th>Metric</th>{datasets.map((d, i) => <th key={keyOf(d.run)} style={{ color: COLORS[i] }}>{d.run.label}<small>{d.run.sources.map(sourceName).join(" · ")}</small></th>)}{datasets.length === 2 && <th>Run 2 − Run 1</th>}</tr></thead><tbody>
        {fields.map((f) => { const a = f.read(datasets[0]), b = datasets[1] ? f.read(datasets[1]) : null; return <tr key={f.label}><td>{f.label}</td>{datasets.map((d) => <td key={keyOf(d.run)}>{value(f.read(d), 4)}</td>)}{datasets.length === 2 && <td>{a === null || b === null ? "—" : `${b - a > 0 ? "+" : ""}${value(b - a, 4)}`}</td>}</tr>; })}
      </tbody></table></div></div>
      <div className="vz-card"><h3>Channel inclusion across runs</h3><div className="vz-table-wrap"><table className="vz-table"><thead><tr><th>Channel</th>{datasets.map((d, i) => <th key={keyOf(d.run)} style={{ color: COLORS[i] }}>{d.run.label}</th>)}</tr></thead><tbody>
        {Array.from({ length: 8 }, (_, c) => <tr key={c}><td>Ch{c+1}</td>{datasets.map((d) => <td key={keyOf(d.run)}>{percent(d.channels[c]?.included_pct)}<small>{d.channels[c]?.label}</small></td>)}</tr>)}
      </tbody></table></div></div>
      <p className="vz-context">Raw EEG features are recomputed at the selected gate; research features use their recorded gate and calibration. Scores depend on each run’s baseline. Channel numbers may refer to different electrode locations. These are descriptive comparisons.</p>
    </>}
  </div>;
}
