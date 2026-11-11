import { useEffect, useState } from "react";
import type { Telemetry } from "./SignalPanel";

export default function ScoringChannels({ t, api, onSaved }: {
  t: Telemetry; api: string; onSaved: (t: Telemetry) => void;
}) {
  const saved = JSON.stringify(t.scoring_channels ?? []);
  const [selected, setSelected] = useState<number[]>(t.scoring_channels ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setSelected(JSON.parse(saved)); }, [saved]);
  async function save() {
    setBusy(true); setError("");
    try {
      const r = await fetch(`${api}/api/scoring-channels`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: selected }), signal: AbortSignal.timeout(5000),
      });
      const data = await r.json();
      if (!r.ok) throw Error(typeof data.detail === "string" ? data.detail : "Could not save channels");
      onSaved(data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={busy || t.calibrating}>
    <legend>Channels used for the calm score</legend>
    <p>Choose the back and side sensors after checking the headset wiring. Channel numbers do not identify electrode locations. All eight channels are still recorded.</p>
    <div className="counts">
      {Array.from({ length: 8 }, (_, i) => i + 1).map(ch => <label key={ch}>
        <input type="checkbox" checked={selected.includes(ch)} onChange={e => setSelected(old =>
          e.target.checked ? [...old, ch].sort((a,b) => a-b) : old.filter(v => v !== ch))} /> CH{ch}
      </label>)}
    </div>
    <button className="secondary" disabled={!selected.length || JSON.stringify(selected) === saved} onClick={() => void save()}>
      Apply scoring channels
    </button>
    <p className="chart-caption">{t.scoring_channels?.length ? `Applied: ${t.scoring_channels.map(c => `CH${c}`).join(", ")}.` : "No confirmed selection. Live baseline is blocked until you apply channels; diagnostics currently preview all channels."} Changing this selection clears the baseline.</p>
    {error && <p role="alert" className="notice">{error}</p>}
  </fieldset>;
}
