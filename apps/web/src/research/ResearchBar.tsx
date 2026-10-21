// Persistent research recording bar and setup panel. Mounted above the page
// switch so navigating between pages never unmounts an active recording.

import { useEffect, useState } from "react";
import type { Telemetry } from "../SignalPanel";
import { sourceName } from "../SignalPanel";
import { API } from "./logger";
import {
  api,
  useLoggerStatus,
  type Destination,
  type ResearchStatus,
  type useResearch,
} from "./useResearch";
import Diagnostics from "./Diagnostics";
import Review from "./Review";

type R = ReturnType<typeof useResearch>;

const PARTICIPANT_RE = /^[A-Za-z0-9][A-Za-z0-9_.]{0,31}$/;
const CONDITION_RE = /^[A-Za-z0-9 _.()/-]{0,60}$/;
const LAST_PARTICIPANT = "bci-research:last-participant";

const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};
const n = (v: number | undefined | null) => (v ?? 0).toLocaleString();

export function stateLabel(s: ResearchStatus | null | undefined, owner: boolean) {
  if (!s) return "Not recording";
  switch (s.state) {
    case "recording":
      return s.receiving_eeg ? "Recording" : "Recording · waiting for EEG";
    case "finalizing":
      return "Saving…";
    case "saved":
      return "Saved";
    case "incomplete":
    case "recovered_incomplete":
      return "Incomplete";
    case "failed":
      return "Failed";
    default:
      return owner ? s.state : s.state;
  }
}

export default function ResearchBar({
  r,
  t,
  usable,
  frameAgeMs,
  frameSeq,
  modeOn,
  setModeOn,
}: {
  r: R;
  t: Telemetry | null;
  usable: boolean;
  frameAgeMs: number | null;
  frameSeq: number | null;
  modeOn: boolean;
  setModeOn: (on: boolean) => void;
}) {
  const s = t?.research ?? null;
  const owner = r.owned !== null;
  const recordingHere = owner && s?.id === r.owned?.id;
  const active = s?.state === "recording" || s?.state === "finalizing";
  const log = useLoggerStatus();
  const [setup, setSetup] = useState(false);
  const [diag, setDiag] = useState(false);
  const [review, setReview] = useState(false);
  const [markerText, setMarkerText] = useState("");
  const [flash, setFlash] = useState("");

  // Operator marker shortcut: Alt+M (⌥M), never while typing in a field.
  useEffect(() => {
    if (!owner) return;
    const on = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== "KeyM") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      r.marker("shortcut");
      setFlash("Marker added");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [owner, r.marker]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(""), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  if (!modeOn && !active && !owner) return null;

  const eegOk = Boolean(t?.receiving_samples) && t?.source !== "synthetic";
  const healthy =
    !!s && s.state === "recording" && !s.writer_error && s.losses === 0 && log.failures < 3 && !log.failed;
  const finalId = !active && s && ["saved", "incomplete", "failed", "recovered_incomplete"].includes(s.state) ? s.id : null;
  const exportable = !!finalId;

  return (
    <section className={`rs-bar ${active ? "on" : ""}`} aria-label="Research recording">
      <div className="rs-row">
        <span className={`rs-dot ${s?.state ?? "idle"}`} aria-hidden="true" />
        <b className="rs-state">{stateLabel(s, owner)}</b>
        {s && (
          <span className="rs-meta">
            {s.participant_id} · <code>{s.id.slice(0, 8)}</code> · {s.storage_format.toUpperCase()} → {s.destination_id} ·{" "}
            {fmtDuration(s.duration_s)} · {t?.measured_rate_hz ?? "—"} Hz · {n(s.samples_written)} samples written (
            {n(s.samples_flushed)} on disk) · {n(s.backlog + log.queued)} unsaved · {n(s.browser_ack)}
            {recordingHere ? `/${n(log.sent)}` : ""} browser items acknowledged
            {s.counts?.markers ? ` · ${s.counts.markers} markers` : ""}
          </span>
        )}
        {!recordingHere && active && <span className="rs-readonly">Owned by another tab · read-only here</span>}
      </div>
      <div className="rs-row">
        <span className={`rs-badge ${eegOk ? "ok" : "bad"}`}>
          {t?.source === "synthetic" ? "No raw EEG (score-only simulation)" : eegOk ? "EEG receiving" : "EEG not receiving"}
        </span>
        <span className={`rs-badge ${usable ? "ok" : "bad"}`}>{usable ? "Signal usable" : "Signal not usable"}</span>
        <span className={`rs-badge ${!s || !active ? "idle" : healthy ? "ok" : "bad"}`}>
          {!s || !active
            ? "Not recording"
            : healthy
              ? "Recording healthy"
              : s.writer_error
                ? `Storage error: ${s.writer_error}`
                : log.failed || log.failures >= 3
                  ? `Browser delivery failing: ${log.lastError ?? ""}`
                  : s.losses
                    ? `${s.losses} loss(es) logged`
                    : "Check recording"}
        </span>
        <div className="rs-actions">
          {!active && !owner && (
            <button className="secondary" onClick={() => setSetup((v) => !v)} aria-expanded={setup}>
              {setup ? "Close setup" : "Start…"}
            </button>
          )}
          {recordingHere && (
            <>
              <input
                className="rs-marker"
                placeholder="Marker note (optional)"
                value={markerText}
                maxLength={120}
                onChange={(e) => setMarkerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    r.marker(markerText.trim());
                    setMarkerText("");
                    setFlash("Marker added");
                  }
                }}
              />
              <button
                className="secondary"
                onClick={() => {
                  r.marker(markerText.trim());
                  setMarkerText("");
                  setFlash("Marker added");
                }}
                title="Shortcut: Alt+M (⌥M) when not typing"
              >
                Add marker
              </button>
              <button className="danger" disabled={r.busy} onClick={() => void r.stop()}>
                {r.busy ? "Saving…" : "Stop & save"}
              </button>
            </>
          )}
          <button className="secondary" onClick={() => setDiag((v) => !v)} aria-expanded={diag}>
            {diag ? "Hide diagnostics" : "Diagnostics"}
          </button>
          <button className="secondary" onClick={() => setReview(true)}>
            Review
          </button>
          {exportable && finalId && (
            <a
              className="rs-download"
              href={`${API}/api/research/recordings/${finalId}/export.zip`}
              download
              title={`CSV ZIP for participant ${s?.participant_id ?? ""}: pseudonymous EEG, game data, metadata, dictionary and manifest. No local paths.`}
            >
              Download ZIP
            </a>
          )}
          {!active && !owner && (
            <button className="secondary rs-off" onClick={() => setModeOn(false)} title="Hide Research / Dev Mode">
              Hide
            </button>
          )}
        </div>
      </div>
      {flash && <p className="rs-flash" role="status">{flash}</p>}
      {(r.error || r.lost) && (
        <p role="alert" className="notice error">
          {r.lost ? `Recording ended: ${r.lost}. Data up to that point is kept and marked incomplete.` : r.error}
        </p>
      )}
      {s && !active && s.reason && s.state !== "saved" && (
        <p className="notice">Last recording: {stateLabel(s, owner)} — {s.reason}</p>
      )}
      {setup && !active && !owner && (
        <Setup
          r={r}
          t={t}
          onStarted={() => {
            setSetup(false);
          }}
        />
      )}
      {diag && <Diagnostics t={t} frameAgeMs={frameAgeMs} frameSeq={frameSeq} usable={usable} />}
      {review && <Review onClose={() => setReview(false)} activeId={active ? s?.id ?? null : null} />}
    </section>
  );
}

function Setup({ r, t, onStarted }: { r: R; t: Telemetry | null; onStarted: () => void }) {
  const [participant, setParticipant] = useState("");
  const [last] = useState(() => {
    try {
      return localStorage.getItem(LAST_PARTICIPANT) ?? "";
    } catch {
      return "";
    }
  });
  const [confirmed, setConfirmed] = useState(false);
  const [dests, setDests] = useState<Destination[]>([]);
  const [root, setRoot] = useState("");
  const [probe, setProbe] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [destError, setDestError] = useState("");
  const c = r.config;

  async function loadDests() {
    try {
      const d = await api<{ destinations: Destination[]; default_root: string }>("/api/research/destinations");
      setDests(d.destinations);
      setRoot(d.default_root);
    } catch (e) {
      setDestError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void loadDests();
  }, []);
  async function runProbe(id: string) {
    setProbe(null);
    try {
      const p = await api<{ free_bytes: number | null }>(`/api/research/destinations/${id}/probe`, {});
      setProbe({
        id,
        ok: true,
        text: `Writable${p.free_bytes ? ` · ${(p.free_bytes / 1e9).toFixed(1)} GB free` : ""}`,
      });
      return true;
    } catch (e) {
      setProbe({ id, ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
  useEffect(() => {
    if (dests.length) void runProbe(c.destination_id);
  }, [c.destination_id, dests.length]);

  const validParticipant = PARTICIPANT_RE.test(participant);
  const validCondition = CONDITION_RE.test(c.condition);
  const dest = dests.find((d) => d.id === c.destination_id);
  const destOk = probe?.id === c.destination_id && probe.ok;
  const sourceKnown = !!t?.session_id;
  const canStart = validParticipant && confirmed && validCondition && destOk && !r.busy;

  return (
    <div className="rs-setup">
      <div className="rs-grid">
        <label>
          Participant pseudonym (required, confirm for every recording)
          <input
            value={participant}
            placeholder="e.g. P012"
            maxLength={32}
            autoComplete="off"
            onChange={(e) => {
              setParticipant(e.target.value.trim());
              setConfirmed(false);
            }}
          />
          {last && !participant && (
            <button type="button" className="linkish" onClick={() => setParticipant(last)}>
              Use previous: {last}
            </button>
          )}
          {participant && !validParticipant && (
            <small className="notice">Letters, numbers, _ and . only (no names or emails), up to 32.</small>
          )}
        </label>
        <label className="rs-check">
          <input type="checkbox" checked={confirmed} disabled={!validParticipant} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            This recording is participant <b>{participant || "—"}</b>
          </span>
        </label>
        <label>
          Condition label (optional)
          <input
            value={c.condition}
            maxLength={60}
            placeholder="e.g. eyes open, session 2"
            onChange={(e) => r.setConfig({ condition: e.target.value })}
          />
          {!validCondition && <small className="notice">Letters, numbers, spaces and _ . ( ) / - only.</small>}
        </label>
        <fieldset>
          <legend>Storage format</legend>
          {(
            [
              ["csv", "CSV (default)"],
              ["sqlite", "SQLite"],
              ["both", "Both"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="rs-radio">
              <input type="radio" name="rs-format" checked={c.storage_format === v} onChange={() => r.setConfig({ storage_format: v })} />
              {l}
            </label>
          ))}
          <small>Every format downloads as the same CSV ZIP for sharing.</small>
        </fieldset>
      </div>
      <fieldset className="rs-electrodes">
        <legend>Electrode map (blank = unknown)</legend>
        {c.electrodes.map((e, i) => (
          <label key={i}>
            Ch {i + 1}
            <input
              value={e}
              maxLength={24}
              placeholder="unknown"
              onChange={(ev) => {
                const next = [...c.electrodes];
                next[i] = ev.target.value;
                r.setConfig({ electrodes: next });
              }}
            />
          </label>
        ))}
        <label>
          Reference
          <input value={c.reference} maxLength={24} placeholder="unknown" onChange={(e) => r.setConfig({ reference: e.target.value })} />
        </label>
      </fieldset>
      <div className="rs-grid">
        <label>
          Save on this computer to
          <select value={c.destination_id} onChange={(e) => r.setConfig({ destination_id: e.target.value })}>
            {dests.map((d) => (
              <option key={d.id} value={d.id} disabled={!d.available}>
                {d.name}
                {d.available ? "" : " (unavailable)"}
              </option>
            ))}
          </select>
          <small>
            {dest?.path ?? root}
            {probe?.id === c.destination_id && (
              <span className={probe.ok ? "ok" : "notice"}> · {probe.text}</span>
            )}
          </small>
        </label>
        <div>
          <button type="button" className="secondary" onClick={() => void runProbe(c.destination_id)}>
            Check folder
          </button>
          <button type="button" className="secondary" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add destination"}
          </button>
        </div>
      </div>
      {adding && (
        <div className="rs-grid">
          <label>
            Name
            <input value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Lab drive" />
          </label>
          <label>
            Existing absolute folder path on the backend computer
            <input value={newPath} maxLength={1024} onChange={(e) => setNewPath(e.target.value)} placeholder="/Users/you/Research" />
          </label>
          <button
            type="button"
            onClick={async () => {
              setDestError("");
              try {
                const d = await api<Destination>("/api/research/destinations", { name: newName, path: newPath });
                await loadDests();
                r.setConfig({ destination_id: d.id });
                setAdding(false);
                setNewName("");
                setNewPath("");
              } catch (e) {
                setDestError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Register folder
          </button>
        </div>
      )}
      {destError && <p className="notice">{destError}</p>}
      <p className="rs-note">
        The backend writes the recording into that folder. <b>Download ZIP</b> (after Stop & save) is a separate copy your
        browser saves, usually to Downloads, for sharing in Teams. Opening this panel does not start recording, change the
        source or start any flicker.
      </p>
      <p className="rs-note">
        Source: <b>{sourceName(t?.source)}</b> ·{" "}
        {!sourceKnown
          ? "no input connected yet (you can connect after starting; it becomes a new acquisition segment)"
          : t?.source === "synthetic"
            ? "no raw EEG: only scores and game data are recorded"
            : "raw EEG is recorded at full rate"}
      </p>
      <button
        disabled={!canStart}
        onClick={async () => {
          if (await r.start(participant)) {
            try {
              localStorage.setItem(LAST_PARTICIPANT, participant);
            } catch {
              /* convenience only */
            }
            onStarted();
          }
        }}
      >
        {r.busy ? "Starting…" : "Start recording"}
      </button>
    </div>
  );
}
