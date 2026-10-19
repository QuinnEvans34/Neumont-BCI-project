import { useEffect, useRef, useState } from "react";
import { GATE_STOPS_UV, gateStop, passesGate } from "./gate";
import type { Telemetry } from "./SignalPanel";

/**
 * Peak-to-peak acceptance gate for baseline and live windows. Dragging shows a
 * local draft; the value is sent once the slider rests, and the draft is kept
 * until telemetry reports it so the thumb never snaps back mid-update.
 */
export default function GateSlider({
  telemetry: t,
  disabled,
  onSet,
}: {
  telemetry: Telemetry;
  disabled: boolean;
  onSet: (uv: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const server = t.gate_max_ptp_uv;
  const gate = draft ?? server;
  useEffect(() => {
    if (draft === server) setDraft(null);
  }, [draft, server]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function change(uv: number) {
    setDraft(uv);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!(await onSet(uv))) setDraft((d) => (d === uv ? null : d));
    }, 300);
  }
  const measured = t.channels.some((c) => c.ptp_uv != null);
  const passing = t.channels.filter((c) => passesGate(c, gate)).length;
  const stale =
    t.calibrated &&
    t.baseline_gate_uv != null &&
    t.baseline_gate_uv !== server;
  return (
    <div className="gate">
      <label htmlFor="acceptance-gate">
        <span>Acceptance gate</span>
        <b>{gate.toLocaleString()} µV</b>
      </label>
      <input
        id="acceptance-gate"
        type="range"
        min={0}
        max={GATE_STOPS_UV.length - 1}
        step={1}
        value={gateStop(gate)}
        aria-valuetext={`${gate} microvolts peak-to-peak`}
        aria-describedby="gate-hint"
        disabled={disabled}
        onChange={(e) => change(GATE_STOPS_UV[Number(e.target.value)])}
      />
      <div className="gate-scale">
        <span>Strict</span>
        <span>Lenient</span>
      </div>
      <p id="gate-hint" className="gate-note">
        {t.calibrating
          ? "Fixed while the baseline is collected."
          : "A channel's 2-second window is accepted when its peak-to-peak stays under the gate."}{" "}
        {measured &&
          `${passing} of ${t.channels.length} channels pass at this gate now.`}
      </p>
      {stale && (
        <p className="notice">
          Baseline was collected at {t.baseline_gate_uv!.toLocaleString()} µV.
          Recalibrate to rebuild it at this gate.
        </p>
      )}
    </div>
  );
}
