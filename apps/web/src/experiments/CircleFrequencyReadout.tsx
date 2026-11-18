import { useState } from "react";
import type { CircleMetrics } from "./types";
import { isPosterior } from "./types";

type Props = {
  metrics?: CircleMetrics;
  electrodes: string[];
  state: "live" | "waiting" | "unavailable" | "last";
  observedHz: number | null;
  source?: string;
};

const hz = (value: number | null) => value === null ? "—" : value.toFixed(1);

export default function CircleFrequencyReadout({ metrics, electrodes, state, observedHz, source }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const posterior = electrodes.findIndex(isPosterior);
  const channel = selected ?? Math.max(0, posterior);
  const metric = state === "live" || state === "last" ? metrics?.channels[channel] : undefined;
  const brainHz = metric?.valid && !metrics?.discontinuous && Number.isFinite(metric.dominant_hz)
    ? metric.dominant_hz! : null;
  const flashHz = state === "live" && observedHz !== null && Number.isFinite(observedHz) && observedHz > 0
    ? observedHz : null;
  const difference = brainHz !== null && flashHz !== null ? brainHz - flashHz : null;
  const sourceLabel = source === "replay" ? "Recorded EEG replay" : source === "simulated_eeg" || source === "simulated"
    ? "Simulated EEG" : "EEG";
  const status = state === "last" ? "Last recorded window · not live"
    : state === "unavailable" ? "Fresh EEG unavailable"
    : state === "waiting" ? "Start a trial · waiting for a complete 2 s EEG window"
    : brainHz === null ? `Signal rejected · ${metric?.reason ?? "no valid frequency"}`
    : `${sourceLabel} · updating every 0.5 s`;

  return <section className="circle-comparison" aria-label="Brain and circle frequency comparison">
    <div className="circle-comparison-heading">
      <div><h2>Brain frequency vs. circle</h2><p role="status">{status}</p></div>
      <label>EEG channel
        <select value={channel} onChange={(event) => setSelected(Number(event.target.value))}>
          {electrodes.map((name, i) => <option value={i} key={i}>CH{i + 1} · {name || "Unmapped"}</option>)}
        </select>
      </label>
    </div>
    <div className="circle-frequency-values">
      <div className="circle-brain-value"><small>BRAIN FREQUENCY · EEG PEAK</small>
        <strong>{hz(brainHz)} <span>Hz</span></strong><small>CH{channel + 1} · {electrodes[channel] || "Unmapped"}</small></div>
      <div><small>CIRCLE · OBSERVED FLASH RATE</small>
        <strong>{hz(flashHz)} <span>Hz</span></strong><small>{flashHz === null ? "Waiting for live flash timing" : "Measured from display callbacks"}</small></div>
      <div><small>DIFFERENCE · BRAIN − CIRCLE</small>
        <strong>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference.toFixed(1)}`} <span>Hz</span></strong>
        <small>{difference === null ? "Needs valid EEG and live flash timing" : "Positive = EEG peak is higher"}</small></div>
    </div>
    <p className="meter-note">Strongest frequency in the selected channel, 1–45 Hz; 0.5 Hz resolution.
      Uses the last 2 seconds of EEG, so changes take time to appear. A similar frequency alone does not establish an SSVEP response.</p>
  </section>;
}
