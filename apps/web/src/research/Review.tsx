// Recording history and review. Reads persisted data from the backend (never
// the browser's memory), one bounded time window at a time.

import { useEffect, useMemo, useState } from "react";
import { API } from "./logger";
import { api } from "./useResearch";
import { EegStack, TimeChart, type Band, type Mark, type Series } from "./charts";

type Row = Record<string, unknown> & { [k: string]: unknown };
type HistoryItem = {
  recording_id: string;
  destination_id: string;
  created_at: string;
  participant_id?: string;
  condition?: string | null;
  storage_format?: string;
  started_at?: string;
  ended_at?: string | null;
  duration_s?: number | null;
  state: string;
  end_reason?: string | null;
  games?: string[];
  sources?: string[];
  samples?: number | null;
  losses?: number;
  exportable?: boolean;
  problem?: string;
};
type Detail = {
  metadata: Record<string, unknown>;
  live?: boolean;
  manifest?: Record<string, unknown> | null;
  rounds?: Row[];
  events?: Row[];
  acquisitions?: Row[];
  calibrations?: Row[];
};
type Window = {
  t0: number;
  t1: number;
  frames: Row[];
  windows: Row[];
  channel_metrics: Row[];
  game_state: Row[];
  events: Row[];
  eeg: { t: number; ch: (number | null)[]; acquisition_id: string; sample_index: number }[];
  eeg_stride: number;
  eeg_samples_in_range: number;
  eeg_time_basis: string;
};

const TABLES = [
  "acquisitions",
  "calibrations",
  "batches",
  "eeg",
  "signal_windows",
  "channel_metrics",
  "input_frames",
  "rounds",
  "events",
  "game_state",
  "clock_sync",
];

const MOMENTS = new Set([
  "cairn_fell",
  "round_ended",
  "round_started",
  "full_bloom",
  "stage_changed",
  "growth_started",
  "growth_stopped",
  "plant_paused",
  "plant_ended",
  "round_paused",
  "settle_interrupted",
  "settle_completed",
  "marker",
  "level_changed",
  "acquisition_started",
  "acquisition_ended",
  "sequence_gap",
]);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const time = (e: Row) => num(e.est_server_wall_s) ?? num(e.server_wall_s) ?? 0;
const json = (v: unknown): Record<string, unknown> => {
  if (typeof v !== "string" || !v) return {};
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString();
const fmt = (v: unknown, d = 3) => (typeof v === "number" ? v.toFixed(d) : v === null || v === undefined ? "—" : String(v));

export default function Review({ onClose, activeId }: { onClose: () => void; activeId: string | null }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function load() {
    try {
      const r = await api<{ recordings: HistoryItem[] }>("/api/research/recordings");
      setItems(r.recordings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = items.filter((i) => !filter || (i.participant_id ?? "").toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="rs-modal" role="dialog" aria-modal="true" aria-label="Research recordings">
      <div className="rs-modal-body">
        <div className="rs-modal-head">
          <div>
            <p className="eyebrow">RESEARCH / DEV MODE</p>
            <h2>{selected ? "Review recording" : "Recordings"}</h2>
          </div>
          <div className="rs-actions">
            {selected && (
              <button className="secondary" onClick={() => setSelected(null)}>
                ← All recordings
              </button>
            )}
            <button className="secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {error && <p className="notice">{error}</p>}
        {!selected ? (
          <>
            <input className="rs-filter" placeholder="Filter by participant" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="rs-table-wrap">
              <table className="rs-table rs-history">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Source</th>
                    <th>Games</th>
                    <th>Format</th>
                    <th>Destination</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.recording_id}>
                      <td>
                        {i.participant_id ?? "—"}
                        {i.condition ? <small> · {i.condition}</small> : null}
                      </td>
                      <td>{i.started_at ? new Date(i.started_at).toLocaleString() : new Date(i.created_at).toLocaleString()}</td>
                      <td>{i.duration_s ? `${Math.round(i.duration_s)} s` : "—"}</td>
                      <td>{(i.sources ?? []).join(", ") || "—"}</td>
                      <td>{(i.games ?? []).join(", ") || "—"}</td>
                      <td>{i.storage_format ?? "—"}</td>
                      <td>{i.destination_id}</td>
                      <td>
                        <span className={`rs-status ${i.state}`}>{i.state.replace(/_/g, " ")}</span>
                        {i.problem && <small className="notice"> {i.problem}</small>}
                        {i.end_reason && i.state !== "saved" && <small> {i.end_reason}</small>}
                      </td>
                      <td>
                        {i.recording_id !== activeId && !i.problem && (
                          <button className="secondary rs-small" onClick={() => setSelected(i.recording_id)}>
                            Open
                          </button>
                        )}
                        {i.exportable && (
                          <a className="rs-download rs-small" href={`${API}/api/research/recordings/${i.recording_id}/export.zip`} download>
                            ZIP
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr>
                      <td colSpan={9}>No recordings yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <RecordingView id={selected} item={items.find((i) => i.recording_id === selected)} />
        )}
      </div>
    </div>
  );
}

type Moment = { t: number; label: string; event?: Row; range: [number, number]; kind: "fall" | "garden" | "plant" | "other" };

function RecordingView({ id, item }: { id: string; item?: HistoryItem }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [moment, setMoment] = useState<Moment | null>(null);
  const [roundFilter, setRoundFilter] = useState<string>("");

  useEffect(() => {
    api<Detail>(`/api/research/recordings/${id}`)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const moments = useMemo(() => {
    const out: Moment[] = [];
    if (!detail?.events) return out;
    for (const r of detail.rounds ?? []) {
      if (r.game !== "garden") continue;
      const evs = (detail.events ?? []).filter((e) => e.round_id === r.round_id);
      if (!evs.length) continue;
      const a = Math.min(...evs.map(time));
      const b = Math.max(...evs.map(time));
      out.push({
        t: a,
        label: `Plant summary (${fmt(num(r.active_s), 0)} s active, ${r.outcome})`,
        range: [a - 2, Math.min(b + 2, a + 600)],
        kind: "plant",
        event: { ...r, type: "plant_summary", round_id: r.round_id },
      });
    }
    for (const e of detail.events) {
      if (!MOMENTS.has(String(e.type))) continue;
      const t = time(e);
      const fall = e.type === "cairn_fell";
      out.push({
        t,
        label: `${e.type}${e.reason ? ` · ${String(e.reason)}` : ""}${e.game ? ` · ${e.game}` : ""}`,
        event: e,
        range: fall ? [t - 15, t + 5] : [t - 10, t + 10],
        kind: fall ? "fall" : e.game === "garden" ? "garden" : "other",
      });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [detail]);

  if (error) return <p className="notice">{error}</p>;
  if (!detail) return <p className="rs-note">Loading…</p>;
  const m = detail.metadata;
  const fmtName = String(m.storage_format ?? item?.storage_format ?? "");
  const final = ["saved", "incomplete", "failed", "recovered_incomplete"].includes(String(m.state));
  const rounds = detail.rounds ?? [];
  const visible = moments.filter((x) => !roundFilter || x.event?.round_id === roundFilter);

  return (
    <div className="rs-review">
      <div className="rs-cols">
        <div>
          <h3>
            {String(m.participant_id)} · <code>{id.slice(0, 8)}</code>
          </h3>
          <p className="rs-note">
            {String(m.started_at ?? "")} → {String(m.ended_at ?? "")} · {String(m.state)}
            {m.end_reason ? ` · ${String(m.end_reason)}` : ""} · {fmtName.toUpperCase()} · condition {String(m.condition ?? "—")}
          </p>
          {Array.isArray(m.losses) && m.losses.length > 0 && (
            <p className="notice">Losses logged: {(m.losses as { reason: string }[]).map((l) => l.reason).join("; ")}</p>
          )}
          {m.parity !== undefined && m.parity !== null && <p className="rs-note">CSV/SQLite parity: {JSON.stringify(m.parity)}</p>}
        </div>
        <div>
          <h3>Downloads</h3>
          {final ? (
            <div className="rs-downloads">
              <p className="rs-note">
                Contains pseudonymous participant data for <b>{String(m.participant_id)}</b>: raw EEG (if a raw source was
                connected), signal windows, game state and events, metadata, a data dictionary and a checksum manifest. No local
                folder paths. Share only where participant data is allowed.
              </p>
              <a className="rs-download" href={`${API}/api/research/recordings/${id}/export.zip`} download>
                Full CSV ZIP (with manifest and data dictionary)
              </a>
              {(fmtName === "sqlite" || fmtName === "both") && (
                <a className="rs-download secondary" href={`${API}/api/research/recordings/${id}/database`} download>
                  SQLite database
                </a>
              )}
              <details>
                <summary>Individual CSV tables</summary>
                <ul>
                  {TABLES.map((t) => (
                    <li key={t}>
                      <a href={`${API}/api/research/recordings/${id}/tables/${t}.csv`} download>
                        {t}.csv
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <p className="rs-note">Downloads appear once the recording is finalized.</p>
          )}
        </div>
      </div>
      <div className="rs-cols">
        <div>
          <h3>Rounds</h3>
          <div className="rs-table-wrap">
            <table className="rs-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Mode</th>
                  <th>Outcome</th>
                  <th>Duration</th>
                  <th>Active</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => {
                  const s = json(r.summary_json);
                  return (
                    <tr
                      key={String(r.round_id)}
                      className={roundFilter === r.round_id ? "chosen" : ""}
                      onClick={() => setRoundFilter(roundFilter === r.round_id ? "" : String(r.round_id))}
                    >
                      <td>{String(r.game)}</td>
                      <td>{String(r.mode ?? "—")}</td>
                      <td>
                        {String(r.outcome)}
                        {r.partial_start ? " · partial start" : ""}
                      </td>
                      <td>{fmt(num(r.duration_s), 1)} s</td>
                      <td>{fmt(num(r.active_s), 1)} s</td>
                      <td>
                        {r.game === "cairn"
                          ? `${fmt(s.stones, 0)} stones${s.cause ? ` · fell (${s.cause})` : ""}`
                          : `growth ${fmt(s.growth, 2)} · above baseline ${fmt(s.above_baseline_s, 0)} s · mean score ${fmt(s.mean_used_score, 2)}`}
                      </td>
                    </tr>
                  );
                })}
                {!rounds.length && (
                  <tr>
                    <td colSpan={6}>No game rounds in this recording.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="rs-note">Click a round to filter its moments.</p>
        </div>
        <div>
          <h3>Moments to inspect</h3>
          <ol className="rs-moments">
            {visible.map((x, i) => (
              <li key={i}>
                <button className={`linkish ${moment === x ? "chosen" : ""}`} onClick={() => setMoment(x)}>
                  <time>{clock(x.t)}</time> {x.label}
                </button>
              </li>
            ))}
            {!visible.length && <li>No moments yet.</li>}
          </ol>
        </div>
      </div>
      {moment && <Inspector id={id} moment={moment} electrodes={(m.electrodes as string[]) ?? []} />}
    </div>
  );
}

function Inspector({ id, moment, electrodes }: { id: string; moment: Moment; electrodes: string[] }) {
  const [w, setW] = useState<Window | null>(null);
  const [error, setError] = useState("");
  const [autoscale, setAutoscale] = useState(true);
  const [t0, t1] = moment.range;
  useEffect(() => {
    setW(null);
    setError("");
    api<Window>(`/api/research/recordings/${id}/window?t0=${t0}&t1=${t1}`)
      .then(setW)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, t0, t1]);
  if (error) return <p className="notice">{error}</p>;
  if (!w) return <p className="rs-note">Loading window…</p>;

  const game = String(moment.event?.game ?? (moment.kind === "plant" ? "garden" : ""));
  const round = moment.event?.round_id;
  const states = w.game_state.filter((s) => (!game || s.game === game) && (!round || s.round_id === round || moment.kind !== "plant"));
  const st = (k: string): [number, number | null][] => states.map((s) => [num(s.est_server_wall_s) ?? 0, num(s[k])]);
  const marks: Mark[] = [{ t: moment.t, label: moment.label, color: "#f2c96e" }];
  for (const e of w.events) if (e.type === "marker") marks.push({ t: time(e), label: `marker: ${e.reason ?? ""}`, color: "#c8a0ff" });

  // Coverage: label the window when data stops short of the requested range.
  const times = [...w.frames.map((f) => num(f.emitted_wall_s) ?? 0), ...w.eeg.map((e) => e.t)];
  const first = times.length ? Math.min(...times) : null;
  const last = times.length ? Math.max(...times) : null;
  const truncated = first === null || first > t0 + 1 || (last ?? 0) < t1 - 1;

  // Effect intervals from state rows (bugs/gusts) and flicker events.
  const bands: Band[] = [];
  let cur: { kind: string; from: number } | null = null;
  for (const s of states) {
    const k = (s.cairn_event_kind as string) ?? null;
    const t = num(s.est_server_wall_s) ?? 0;
    if (cur && cur.kind !== k) {
      bands.push({ from: cur.from, to: t, label: cur.kind, color: cur.kind === "gust" ? "rgba(120,170,255,.16)" : "rgba(242,201,110,.16)" });
      cur = null;
    }
    if (k && !cur) cur = { kind: k, from: t };
  }
  if (cur) bands.push({ from: cur.from, to: t1, label: cur.kind, color: cur.kind === "gust" ? "rgba(120,170,255,.16)" : "rgba(242,201,110,.16)" });
  let flick: number | null = null;
  for (const e of w.events) {
    if (e.type === "flicker_started") flick = time(e);
    if (e.type === "flicker_ended") {
      bands.push({ from: flick ?? t0, to: time(e), label: "15 Hz flicker", color: "rgba(255,120,160,.18)" });
      flick = null;
    }
  }
  if (flick !== null) bands.push({ from: flick, to: t1, label: "15 Hz flicker", color: "rgba(255,120,160,.18)" });

  // Signal tracks.
  const score: Series = { label: "published score", color: "#8ff1d0", points: w.frames.map((f) => [num(f.emitted_wall_s) ?? 0, num(f.score)]), step: true };
  const target: Series = {
    label: "mapped target",
    color: "#f2c96e",
    dashed: true,
    points: w.windows.filter((x) => x.purpose === "play").map((x) => [num(x.computed_wall_s) ?? 0, num(x.mapped_target)]),
    step: true,
  };
  const alpha: Series = {
    label: "relative alpha (median)",
    color: "#a0c4ff",
    points: w.windows.map((x) => [num(x.computed_wall_s) ?? 0, num(x.relative_alpha)]),
    step: true,
  };
  const wkey = (r: Row) => `${String(r.acquisition_id)}:${String(r.window_id)}`;
  const winTime = new Map(w.windows.map((x) => [wkey(x), num(x.computed_wall_s) ?? 0]));
  const includedBy = new Map<string, number>();
  for (const c of w.channel_metrics) if (c.included) includedBy.set(wkey(c), (includedBy.get(wkey(c)) ?? 0) + 1);
  const included: Series = {
    label: "channels in median",
    color: "#c8a0ff",
    step: true,
    points: [...winTime.entries()].map(([wid, t]) => [t, includedBy.get(wid) ?? 0] as [number, number]).sort((a, b) => a[0] - b[0]),
  };

  // The fall's trigger: frame → window → samples.
  const ev = moment.event;
  const payload = json(ev?.payload_json);
  const trig = (payload.trigger_input as { acquisition_id?: string; sequence?: number } | undefined) ?? {
    sequence: num(ev?.input_sequence) ?? undefined,
  };
  const frame = w.frames.find((f) => f.sequence === trig.sequence && (!trig.acquisition_id || f.acquisition_id === trig.acquisition_id));
  const win = frame ? w.windows.find((x) => x.window_id === frame.window_id && x.acquisition_id === frame.acquisition_id) : undefined;
  const labels = Array.from({ length: 8 }, (_, i) => `Ch${i + 1}${electrodes[i] ? ` ${electrodes[i]}` : ""}`);

  return (
    <div className="rs-inspector">
      <h3>
        {moment.kind === "fall" ? "Fall inspector" : moment.kind === "plant" || game === "garden" ? "Garden inspector" : "Inspector"} ·{" "}
        {clock(t0)}–{clock(t1)}
      </h3>
      {truncated && (
        <p className="notice">
          Partial coverage: data exists from {first ? clock(first) : "—"} to {last ? clock(last) : "—"} (recording start/stop or
          outage inside this window).
        </p>
      )}
      {moment.kind === "fall" && (
        <div className="rs-explain">
          <p>
            <b>{String(payload.explanation ?? ev?.reason)}</b> Stones {fmt(payload.stones, 0)} · tilt {fmt(payload.angle_rad)} rad vs
            topple threshold {fmt(payload.fall_angle_threshold_rad)} rad · sway {fmt(payload.sway_rad)} rad vs drop threshold{" "}
            {fmt(payload.drop_sway_threshold_rad)} rad · gust load {fmt(payload.gust_load, 2)}
            {payload.active_effect ? ` · during a ${(payload.active_effect as { kind: string }).kind}` : ""}.
          </p>
          <p className="rs-note">
            Input at the fall: frame #{trig.sequence ?? "—"}
            {frame
              ? ` (score ${fmt(frame.score)}, ${frame.quality}, emitted ${fmt((num(ev ? time(ev) : null) ?? 0) - (num(frame.emitted_wall_s) ?? 0), 2)} s before the fall${(num(ev ? time(ev) : null) ?? 0) - (num(frame.emitted_wall_s) ?? 0) > 1 ? " — the browser was using an old frame (delivery lag)" : ""}) from window #${frame.window_id ?? "—"}`
              : " (frame not stored: it predates the recording)"}
            {win
              ? ` covering samples ${win.sample_start}–${win.sample_end}, relative alpha ${fmt(win.relative_alpha)}, ${win.channels_included} channels, ${win.accepted ? "accepted" : `rejected: ${win.rejection_reason}`}`
              : ""}
            . These are game mechanics and recorded observations; overlap in time does not show that any channel or
            distraction caused the fall.
          </p>
        </div>
      )}
      {moment.kind === "plant" && <PlantSummary row={ev} />}
      {game === "garden" && moment.kind !== "plant" && ev && (
        <p className="rs-explain">
          <b>{String(ev.type)}</b>
          {ev.reason ? ` · ${String(ev.reason)}` : ""} {String(json(ev.payload_json).explanation ?? "")}
        </p>
      )}
      <TimeChart t0={t0} t1={t1} title="Score" unit="0–1" min={0} max={1} series={[score, target]} bands={bands} marks={marks} />
      <TimeChart t0={t0} t1={t1} title="Relative alpha feature" series={[alpha]} marks={marks} />
      <TimeChart t0={t0} t1={t1} title="Accepted channels" min={0} max={8} height={70} series={[included]} marks={marks} />
      {game === "cairn" && (
        <>
          <TimeChart
            t0={t0}
            t1={t1}
            title="Sway vs thresholds"
            unit="rad"
            min={0}
            series={[
              { label: "sway", color: "#8ff1d0", points: st("cairn_sway_rad") },
              { label: "|tilt|", color: "#a0c4ff", points: st("cairn_angle_rad").map(([t, v]) => [t, v === null ? null : Math.abs(v)]) },
              { label: "topple threshold", color: "#ff8a8a", dashed: true, points: st("cairn_fall_angle_rad"), step: true },
              { label: "drop threshold", color: "#f2c96e", dashed: true, points: st("cairn_drop_sway_rad"), step: true },
            ]}
            bands={bands}
            marks={marks}
            note="Shaded: firefly (yellow), gust (blue), 15 Hz flicker (pink)."
          />
          <TimeChart t0={t0} t1={t1} title="Stones" min={0} height={70} series={[{ label: "stones", color: "#e9f3f1", points: st("cairn_stones"), step: true }]} marks={marks} />
          <TimeChart
            t0={t0}
            t1={t1}
            title="Modeled focus and unrest"
            min={0}
            max={1}
            height={80}
            series={[
              { label: "focus", color: "#8ff1d0", points: st("cairn_focus") },
              { label: "unrest", color: "#ff8a8a", points: st("cairn_unrest") },
            ]}
            marks={marks}
          />
        </>
      )}
      {game === "garden" && (
        <>
          <TimeChart
            t0={t0}
            t1={t1}
            title="Growth, response and drive"
            min={0}
            max={1}
            series={[
              { label: "growth", color: "#8ff1d0", points: st("garden_growth") },
              { label: "response", color: "#a0c4ff", points: st("garden_response") },
              { label: "drive", color: "#f2c96e", points: st("garden_drive"), step: true },
            ]}
            marks={marks}
          />
          <TimeChart
            t0={t0}
            t1={t1}
            title="Stage · breathing guide · sound"
            min={0}
            max={2}
            height={80}
            series={[
              {
                label: "stage (0 sprout, 1 growing, 2 blooming)",
                color: "#e9f3f1",
                step: true,
                points: states.map((s) => [num(s.est_server_wall_s) ?? 0, ({ sprout: 0, growing: 1, blooming: 2 } as Record<string, number>)[String(s.garden_stage)] ?? null]),
              },
              {
                label: "guide phase (in = 1)",
                color: "#c8a0ff",
                step: true,
                points: states.map((s) => [num(s.est_server_wall_s) ?? 0, s.garden_breath_phase === "in" ? 1 : s.garden_breath_phase === "out" ? 0 : null]),
              },
              { label: "sound effective", color: "#f2c96e", step: true, points: st("garden_audio_effective") },
            ]}
            marks={marks}
            note="The breathing guide is a visual pacing cue, not measured respiration."
          />
        </>
      )}
      {w.eeg.length > 1 ? (
        <>
          <label className="rs-check">
            <input type="checkbox" checked={autoscale} onChange={(e) => setAutoscale(e.target.checked)} /> Autoscale channels
          </label>
          <EegStack t0={t0} t1={t1} rows={w.eeg} labels={labels} autoscale={autoscale} marks={marks} />
          <p className="rs-note">
            {w.eeg_samples_in_range.toLocaleString()} samples in range; every {w.eeg_stride}th shown. Time basis: {w.eeg_time_basis}.
          </p>
        </>
      ) : (
        <p className="rs-note">No raw EEG in this window (score-only simulation, or no samples stored here).</p>
      )}
      <details>
        <summary>Events in this window ({w.events.length})</summary>
        <ol className="rs-events">
          {w.events.map((e, i) => (
            <li key={i}>
              <time>{clock(time(e))}</time> <b>{String(e.type)}</b> {e.game ? `· ${e.game}` : ""} {e.reason ? `· ${String(e.reason)}` : ""}
              {num(e.sample_uncertainty_ms) !== null ? ` · ±${fmt(num(e.sample_uncertainty_ms), 0)} ms` : ""}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function PlantSummary({ row }: { row?: Row }) {
  if (!row) return null;
  const s = json(row.summary_json);
  return (
    <dl className="rs-dl rs-explain">
      <dt>Outcome</dt>
      <dd>{String(row.outcome)}</dd>
      <dt>Active time</dt>
      <dd>{fmt(s.active_s, 1)} s</dd>
      <dt>Growth / stage</dt>
      <dd>
        {fmt(s.growth, 3)} · {String(s.stage ?? "—")}
        {s.full_bloom ? " · full bloom" : ""}
      </dd>
      <dt>Stage times (active s)</dt>
      <dd>
        growing {fmt(s.reached_growing_at_active_s, 1)} · blooming {fmt(s.reached_blooming_at_active_s, 1)} · full{" "}
        {fmt(s.reached_full_bloom_at_active_s, 1)}
      </dd>
      <dt>Time above baseline score</dt>
      <dd>{fmt(s.above_baseline_s, 1)} s</dd>
      <dt>Mean used score</dt>
      <dd>{fmt(s.mean_used_score, 3)}</dd>
      <dt>Pace / config changes</dt>
      <dd>
        {fmt(s.pace_s, 0)} s · {fmt(s.configuration_changes, 0)} changes
      </dd>
    </dl>
  );
}
