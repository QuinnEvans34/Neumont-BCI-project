import type { Telemetry } from "./SignalPanel";

export const DEFAULT_HUM_ADVISORY_UV = 10;
export type ContactStatus = {
  tone: "waiting" | "check" | "bad" | "usable";
  label: string;
  hint: string;
};
type Channel = Telemetry["channels"][number];
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Advisory signal checks, independent of whether the channel is selected for scoring.
 * Neither a passing amplitude check nor low mains noise establishes electrode impedance.
 */
export function contactQuality(c: Channel | undefined, receiving: boolean, gate: number,
  humAdvisory = DEFAULT_HUM_ADVISORY_UV, continuityProblem?: string | null): ContactStatus {
  if (!receiving) return { tone: "waiting", label: "No current signal", hint: "Connect the board and check that samples are arriving." };
  if (continuityProblem) return { tone: "waiting", label: "Sample gap", hint: "Wait for a continuous window of EEG. Check the radio link if gaps continue." };
  if (!c || c.reason.startsWith("Waiting")) return { tone: "waiting", label: "Collecting samples", hint: "Waiting for a complete two-second window." };
  if (!finite(c.std_uv) || !finite(c.ptp_uv) || c.reason.includes("Non-finite"))
    return { tone: "bad", label: "Invalid signal", hint: "Check the electrode lead and board connection." };
  if (c.reason.includes("rail")) return { tone: "bad", label: "Signal saturated", hint: "Check contact, the lead, and reference/bias connections." };
  if (c.std_uv <= .5) return { tone: "bad", label: "Flat signal", hint: "Check the lead and electrode contact. Quiet does not always mean connected." };
  if (c.ptp_uv >= gate) return { tone: "check", label: "Large fluctuations", hint: "Sit still, relax the jaw, then gently reseat this electrode if the signal stays noisy." };
  if (!finite(c.hum_rms_uv)) return { tone: "waiting", label: "Hum unavailable", hint: "Refresh the app and make sure the updated backend is running." };
  if (c.hum_rms_uv >= humAdvisory) return { tone: "check", label: "Mains interference", hint: "Check this contact and lead. If several channels show this, check reference/bias too." };
  return { tone: "usable", label: "Within signal limits", hint: "Watch for a steady reading while sitting still. Contact is not independently verified." };
}
