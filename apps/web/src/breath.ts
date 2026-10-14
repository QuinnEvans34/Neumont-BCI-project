// One shared breath clock drives the garden's sway, the optional breathing
// guide and the ambient "breath" sound, so all three stay in step.
// 4 s in, 6 s out: about six breaths a minute with a longer exhale, a pace
// commonly used for relaxed breathing. It is a rhythm to follow, not a measurement.

export const BREATH_IN = 4;
export const BREATH_OUT = 6;
export const BREATH_CYCLE = BREATH_IN + BREATH_OUT;

export type Breath = {
  phase: "in" | "out";
  /** Progress through the current phase, 0..1. */
  progress: number;
  /** Lung fullness 0..1, eased so motion starts and ends softly. */
  level: number;
  /** Seconds left in the current phase. */
  remaining: number;
};

export function breathAt(t: number): Breath {
  const c = ((t % BREATH_CYCLE) + BREATH_CYCLE) % BREATH_CYCLE;
  if (c < BREATH_IN) {
    const p = c / BREATH_IN;
    return {
      phase: "in",
      progress: p,
      level: (1 - Math.cos(Math.PI * p)) / 2,
      remaining: BREATH_IN - c,
    };
  }
  const p = (c - BREATH_IN) / BREATH_OUT;
  return {
    phase: "out",
    progress: p,
    level: (1 + Math.cos(Math.PI * p)) / 2,
    remaining: BREATH_CYCLE - c,
  };
}
