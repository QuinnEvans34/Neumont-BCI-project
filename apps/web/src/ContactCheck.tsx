import { useState } from "react";
import type { Telemetry } from "./SignalPanel";
import { contactQuality, DEFAULT_HUM_ADVISORY_UV } from "./contactQuality";

const number = (v: number | null | undefined) => v != null && Number.isFinite(v) ? v.toFixed(1) : "—";

export default function ContactCheck({ t }: { t: Telemetry | null }) {
  const [humLimit, setHumLimit] = useState(DEFAULT_HUM_ADVISORY_UV);
  if (t?.source === "synthetic") return null;
  const current = !!t?.receiving_samples && t.packet_age_ms != null && t.packet_age_ms <= 2000;
  const gate = t?.gate_max_ptp_uv ?? 150;
  const rows = Array.from({ length: 8 }, (_, i) => {
    const c = t?.channels.find(c => c.channel === i + 1);
    return { ch: i + 1, c, status: contactQuality(c, current, gate, humLimit, t?.signal_chain?.problem) };
  });
  const issues = rows.filter(r => r.status.tone === "bad" || r.status.tone === "check");
  const usable = rows.filter(r => r.status.tone === "usable").length;
  const demo = t?.source === "replay" || t?.source === "simulated_eeg";
  return <section className="panel contact-check" aria-labelledby="contact-heading">
    <div className="contact-heading">
      <div>
        <p className="eyebrow">01 / CHECK ELECTRODES</p>
        <h2 id="contact-heading">Get a steady signal first.</h2>
        <p>Check each electrode before collecting your baseline. Adjust one contact at a time, keep pressure comfortable, then sit still for a few seconds.</p>
      </div>
      <div className={`contact-summary ${!current ? "waiting" : issues.length ? "check" : "usable"}`}>
        <strong>{usable}<span> / 8</span></strong>
        <span>within signal limits</span>
        <small>{!current ? "Waiting for current EEG" : issues.length ? `Inspect ${issues.map(r => `CH${r.ch}`).join(", ")}` : usable === 8 ? "Watch for steady readings" : "Collecting measurements"}</small>
      </div>
    </div>
    {demo && <p className="notice">{t?.source === "replay" ? "Recorded EEG" : "Simulated EEG"} — these readings do not verify the headset currently on your head.</p>}
    <div className="contact-grid">
      {rows.map(({ ch, c, status }) => <article key={ch} className={`contact-card ${status.tone}`}>
        <div className="contact-card-title">
          <h3>CH{ch} <small>{t?.research?.electrodes[ch - 1] || "Position unconfirmed"}</small></h3>
          <span className="contact-dot" aria-hidden="true" />
        </div>
        <strong className="contact-status">{status.label}</strong>
        <div className="contact-values">
          <div><span>Filtered amplitude</span><b>{current ? number(c?.ptp_uv) : "—"} <small>µV p-p</small></b></div>
          <div><span>Raw 60 Hz hum</span><b>{current ? number(c?.hum_rms_uv) : "—"} <small>µV RMS</small></b></div>
        </div>
        <p>{status.hint}</p>
        <small className="contact-role">{t?.scoring_channels == null ? "Scoring selection not confirmed" : t.scoring_channels.includes(ch) ? "Selected for scoring" : "Monitoring only · excluded from score"}</small>
      </article>)}
    </div>
    <details className="contact-help">
      <summary>What the checks mean & how to troubleshoot</summary>
      <p><b>Filtering and contact checks serve different purposes.</b> The score uses a 60 Hz notch and 1–40 Hz band-pass. Hum is measured on the raw signal, before those filters, so interference remains visible here.</p>
      <label>Hum advisory level (µV RMS)
        <select value={humLimit} onChange={e => setHumLimit(Number(e.target.value))}>
          {[5, 10, 20, 50].map(v => <option key={v} value={v}>{v} µV RMS</option>)}
        </select>
      </label>
      <p>The {humLimit} µV hum advisory is a provisional display threshold, not a validated contact test. It does not change the score or reject data. The filtered amplitude limit is {gate} µV peak-to-peak; adjust it separately below.</p>
      <ol>
        <li>For a single noisy channel, check its lead, move hair out of the contact area, and gently reseat the electrode.</li>
        <li>If many channels are noisy together, check reference/bias and shared connections before adjusting every electrode.</li>
        <li>Flat or saturated signals need attention even if the hum reading is small.</li>
        <li>For an actual impedance measurement, use the OpenBCI GUI. Stop its impedance check and close its board session before reconnecting here.</li>
      </ol>
    </details>
    <p className="chart-caption">Latest two-second window · Signal screening, not a measured contact resistance. Channel numbers are not electrode positions. Confirm wiring before selecting back/side sensors below.</p>
  </section>;
}
