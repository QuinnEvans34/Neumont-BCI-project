// Operator-adjustable acceptance gate: the peak-to-peak ceiling each channel's
// 2-second window must stay under (backend/signal.py analyze).

/** Slider stops in µV, denser where gates are usually set. Ends match backend GATE_RANGE_UV. */
export const GATE_STOPS_UV = [
  100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1250, 1500,
  1750, 2000, 2500, 3000, 4000, 5000,
];

/** The flat-signal floor, which is not adjustable. */
export const FLAT_SD_UV = 0.5;

/** Slider stop nearest a gate the backend reports, which may sit between stops. */
export function gateStop(uv: number) {
  let best = 0;
  GATE_STOPS_UV.forEach((s, i) => {
    if (Math.abs(s - uv) < Math.abs(GATE_STOPS_UV[best] - uv)) best = i;
  });
  return best;
}

/** Whether a channel's latest window would be accepted at this gate. */
export function passesGate(
  c: { std_uv: number | null; ptp_uv?: number | null },
  gateUv: number,
) {
  return (
    c.std_uv != null &&
    c.ptp_uv != null &&
    c.std_uv > FLAT_SD_UV &&
    c.ptp_uv < gateUv
  );
}
