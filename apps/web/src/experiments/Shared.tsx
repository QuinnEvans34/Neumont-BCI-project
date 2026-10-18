import { useEffect, useState, type ReactNode } from "react";
import type { Telemetry } from "../SignalPanel";
import { duration } from "../SignalPanel";
import {
  ELECTRODE_SUGGESTIONS,
  MODE_LABEL,
  isPosterior,
  type ExperimentTelemetry,
} from "./types";
import { exportUrl } from "./session";

// ---------------------------------------------------------------- per-browser setup memory
const SETUP_KEY = "bci-experiments:setup:v1";
export type SetupMemory = {
  participant: string;
  electrodes: string[];
  reference: string;
};
const DEFAULT_SETUP: SetupMemory = {
  participant: "",
  electrodes: ["", "", "", "", "", "", "", ""],
  reference: "",
};

export function useSetupMemory(): [
  SetupMemory,
  (p: Partial<SetupMemory>) => void,
] {
  const [value, setValue] = useState<SetupMemory>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "null");
      if (raw && Array.isArray(raw.electrodes) && raw.electrodes.length === 8)
        return {
          participant: String(raw.participant ?? "").slice(0, 32),
          electrodes: raw.electrodes.map((e: unknown) =>
            String(e ?? "").slice(0, 12),
          ),
          reference: String(raw.reference ?? "").slice(0, 24),
        };
    } catch {
      /* storage unavailable */
    }
    return DEFAULT_SETUP;
  });
  const update = (p: Partial<SetupMemory>) =>
    setValue((v) => {
      const next = { ...v, ...p };
      try {
        localStorage.setItem(SETUP_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  return [value, update];
}

export const cleanName = (s: string) =>
  s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
export const cleanParticipant = (s: string) =>
  s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

// ---------------------------------------------------------------- components
export function ExperimentHeader({
  title,
  lead,
  onExit,
}: {
  title: string;
  lead: string;
  onExit: () => void;
}) {
  return (
    <div className="exp-title">
      <div>
        <span className="exp-badge">Experiment</span>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <button className="secondary change-game" onClick={onExit}>
        Change experience
      </button>
    </div>
  );
}

export function SourceBanner({ telemetry }: { telemetry: Telemetry | null }) {
  const source = telemetry?.state === "disconnected" ? null : telemetry?.source;
  const label = source ? (MODE_LABEL[source] ?? source) : "No input connected";
  const tone =
    source === "live"
      ? "live"
      : source === "simulated_eeg"
        ? "sim"
        : source
          ? "warn"
          : "warn";
  return (
    <div className={`exp-source ${tone}`} role="status">
      <b>{label}</b>
      {source === "simulated_eeg" && (
        <span>
          {" "}
          Generated signals for pipeline testing. Not evidence about any person.
        </span>
      )}
      {source === "replay" && (
        <span> Useful to exercise recording and analysis only.</span>
      )}
    </div>
  );
}

export function Prerequisites({
  items,
}: {
  items: { ok: boolean; label: string; detail?: string }[];
}) {
  return (
    <ul className="prereqs">
      {items.map((i) => (
        <li key={i.label} className={i.ok ? "ok" : "no"}>
          <span aria-hidden="true">{i.ok ? "✓" : "•"}</span>
          <div>
            {i.label}
            {i.detail && <small>{i.detail}</small>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ElectrodeMap({
  electrodes,
  reference,
  disabled,
  onChange,
  onReference,
  selected,
  onToggle,
  requirePosterior,
}: {
  electrodes: string[];
  reference: string;
  disabled?: boolean;
  onChange: (e: string[]) => void;
  onReference: (r: string) => void;
  selected?: number[];
  onToggle?: (i: number) => void;
  requirePosterior?: boolean;
}) {
  return (
    <fieldset className="electrode-map" disabled={disabled}>
      <legend>Electrode map</legend>
      <p className="meter-note">
        Type where each Cyton channel is actually placed. Channel numbers do not
        imply positions.
        {requirePosterior &&
          " Tick the occipital/parieto-occipital (O, PO) channels the decoder should use."}
      </p>
      <datalist id="electrode-names">
        {ELECTRODE_SUGGESTIONS.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="electrode-grid">
        {electrodes.map((name, i) => {
          const posterior = isPosterior(name);
          return (
            <label
              key={i}
              className={`electrode ${posterior ? "posterior" : ""}`}
            >
              <span>CH{i + 1}</span>
              <input
                list="electrode-names"
                value={name}
                placeholder="unused"
                maxLength={12}
                onChange={(e) => {
                  const next = [...electrodes];
                  next[i] = cleanName(e.target.value);
                  onChange(next);
                }}
              />
              {onToggle && (
                <input
                  type="checkbox"
                  aria-label={`Use CH${i + 1} for decoding`}
                  checked={selected?.includes(i) ?? false}
                  disabled={!posterior}
                  onChange={() => onToggle(i)}
                />
              )}
            </label>
          );
        })}
      </div>
      <label className="reference">
        <span>Reference</span>
        <input
          value={reference}
          maxLength={24}
          placeholder="e.g. SRB to left earlobe"
          onChange={(e) => onReference(e.target.value.slice(0, 24))}
        />
      </label>
    </fieldset>
  );
}

export function SignalStatus({
  telemetry,
  fresh,
  channel,
  onChannel,
  electrodes,
}: {
  telemetry: Telemetry | null;
  fresh: boolean;
  channel: number;
  onChannel: (c: number) => void;
  electrodes: string[];
}) {
  const values = telemetry?.waveform?.[channel] ?? [];
  const finite = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  const mean = finite.length
    ? finite.reduce((a, b) => a + b, 0) / finite.length
    : 0;
  let d = "";
  let down = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      down = false;
      return;
    }
    const x = (i / Math.max(1, values.length - 1)) * 1000;
    const y = 50 - Math.max(-200, Math.min(200, v - mean)) / 4;
    d += `${down ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    down = true;
  });
  return (
    <section className="exp-panel signal-mini">
      <div className="chart-heading">
        <h3>Raw EEG</h3>
        <label className="channel-select">
          Channel
          <select
            value={channel}
            onChange={(e) => onChannel(Number(e.target.value))}
          >
            {electrodes.map((n, i) => (
              <option key={i} value={i}>
                CH{i + 1}
                {n ? ` · ${n}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <svg
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="trace"
        role="img"
        aria-label={`Recent raw EEG on CH${channel + 1}, display only`}
      >
        <line x1="0" x2="1000" y1="50" y2="50" stroke="#28434a" />
        <path
          d={d}
          stroke="#8ff1d0"
          strokeWidth="1.6"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="chart-caption">
        ±200 µV, mean removed, every fifth sample for display only. Analysis and
        recording use every sample.
      </p>
      <dl className="exp-facts">
        <dt>Samples delivered</dt>
        <dd>{telemetry?.samples_received?.toLocaleString() ?? "—"}</dd>
        <dt>Packet age</dt>
        <dd>
          {fresh && telemetry?.packet_age_ms != null
            ? `${telemetry.packet_age_ms} ms`
            : "—"}
        </dd>
        <dt>Measured rate</dt>
        <dd>
          {telemetry?.measured_rate_hz != null
            ? `${telemetry.measured_rate_hz} Hz`
            : "—"}
        </dd>
        <dt>Packet gaps / duplicates</dt>
        <dd>
          {telemetry?.counter_gaps ?? 0} / {telemetry?.counter_duplicates ?? 0}
        </dd>
      </dl>
    </section>
  );
}

export function RecordingPanel({
  experiment,
  mine,
}: {
  experiment: ExperimentTelemetry | null;
  mine: boolean;
}) {
  if (!experiment) return null;
  const r = experiment.recording;
  const running = experiment.state === "running";
  return (
    <section className={`exp-panel recording ${r.state}`}>
      <div className="chart-heading">
        <h3>Recording</h3>
        <span className={`rec-state ${r.state}`}>
          {running
            ? "● Recording"
            : r.state === "saved"
              ? "Saved"
              : r.state === "failed"
                ? "Failed"
                : "Saving…"}
        </span>
      </div>
      {!mine && running && (
        <p className="notice">Started from another window.</p>
      )}
      {experiment.state !== "running" && (
        <p
          className={experiment.state === "completed" ? "meter-note" : "notice"}
        >
          {experiment.state === "completed"
            ? "Completed"
            : experiment.state === "failed"
              ? "Failed"
              : "Interrupted"}
          {experiment.reason ? `: ${experiment.reason}` : ""}
        </p>
      )}
      <dl className="exp-facts">
        <dt>EEG samples saved</dt>
        <dd>{r.samples.toLocaleString()}</dd>
        <dt>Events</dt>
        <dd>{r.events}</dd>
        {experiment.kind === "ssvep" && (
          <>
            <dt>Frames logged</dt>
            <dd>{r.frames.toLocaleString()}</dd>
          </>
        )}
        <dt>Size</dt>
        <dd>{(r.bytes / 1e6).toFixed(2)} MB</dd>
        <dt>Started</dt>
        <dd>{new Date(experiment.started_at).toLocaleTimeString()}</dd>
      </dl>
      <p className="path" title={r.path}>
        {r.state === "saved" ? "Saved to " : "Writing to "}
        <code>{r.path}</code>
      </p>
      {r.error && (
        <p role="alert" className="notice error">
          {r.error}
        </p>
      )}
      {r.state === "saved" && (
        <a className="button-link" href={exportUrl(experiment.id)} download>
          Export recording (.zip)
        </a>
      )}
    </section>
  );
}

export function SessionNotice({
  flicker,
  children,
}: {
  flicker: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="session-notice" role="note">
      <h3>Before you start</h3>
      {flicker ? (
        <p>
          This session shows cards that <b>flicker</b> at 10–15 Hz. Do not
          continue if the participant or anyone who can see the screen has
          photosensitive epilepsy or a history of seizures, migraines triggered
          by light, or feels any discomfort. Flicker can affect people without a
          diagnosis; smaller or dimmer targets do not guarantee safety. Keep the
          screen out of spectators' view.
        </p>
      ) : (
        <p>
          This session alternates a soft highlight between two circles (no
          flashing). It is an observation exercise, not a therapy, and involves
          no recalling of memories.
        </p>
      )}
      <p>
        Stop at any time with <b>Stop</b> or the <kbd>Esc</kbd> key, and stop
        immediately on any discomfort. A non-stimulating alternative is to sit
        quietly with eyes on the centre mark while the signal is recorded.
      </p>
      {children}
    </div>
  );
}

/** Escape always stops; registered only while a session is running. */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, onEscape]);
}

export const fmt = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);

export { duration };
