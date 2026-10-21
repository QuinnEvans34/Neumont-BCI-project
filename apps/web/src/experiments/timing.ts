// Display-timing preflight, frame-based flicker schedules and clock-offset
// estimation. Pure functions (no DOM) so they can be tested deterministically.
//
// Browser callback times are software timing. They never prove when light left
// the screen; optical timing stays "unverified" unless a photodiode was used.

/** Named engineering gates, logged with every session (not safety guarantees). */
export const TIMING = {
  PREFLIGHT_SECONDS: 5,
  /** Median refresh must be within 1% of a supported profile. */
  MAX_MEDIAN_ERROR: 0.01,
  /** Fewer than 1% of intervals may exceed 1.5× the median in preflight. */
  LONG_FACTOR: 1.5,
  MAX_LONG_FRACTION: 0.01,
  /** No preflight interval may exceed 3× the median. */
  HARD_FACTOR: 3,
  /** During a trial any interval above 1.5× the established median interrupts it. */
  TRIAL_LONG_FACTOR: 1.5,
  PROFILES: [60, 120] as const,
};

export type Profile = (typeof TIMING.PROFILES)[number];

export type Preflight = {
  passed: boolean;
  profile_hz: Profile | null;
  measured_hz: number;
  median_interval_ms: number;
  long_interval_fraction: number;
  max_interval_ms: number;
  preflight_seconds: number;
  frames: number;
  reasons: string[];
  criteria: typeof TIMING;
};

export function median(values: number[]) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Analyse frame-callback intervals (ms) recorded without any flicker. */
export function analyzePreflight(intervals: number[]): Preflight {
  const reasons: string[] = [];
  const clean = intervals.filter((v) => Number.isFinite(v) && v > 0);
  const med = median(clean);
  const seconds = clean.reduce((a, b) => a + b, 0) / 1000;
  const hz = 1000 / med;
  const long = clean.filter((v) => v > TIMING.LONG_FACTOR * med).length;
  const max = clean.length ? Math.max(...clean) : NaN;
  const longFraction = clean.length ? long / clean.length : 1;
  const profile =
    (TIMING.PROFILES.find(
      (p) => Math.abs(hz - p) / p <= TIMING.MAX_MEDIAN_ERROR,
    ) as Profile | undefined) ?? null;
  if (seconds < TIMING.PREFLIGHT_SECONDS - 0.05)
    reasons.push(
      `Only ${seconds.toFixed(1)} s measured; need ${TIMING.PREFLIGHT_SECONDS} s.`,
    );
  if (!Number.isFinite(hz)) reasons.push("No frame timing was measured.");
  else if (!profile)
    reasons.push(
      `Measured ${hz.toFixed(2)} Hz is not within 1% of 60 or 120 Hz. Set the display to 60 Hz (or 120 Hz) and turn off variable refresh, then re-check.`,
    );
  if (longFraction >= TIMING.MAX_LONG_FRACTION)
    reasons.push(
      `${(longFraction * 100).toFixed(1)}% of frames were late (>1.5× median); limit is 1%. Close other apps and keep this tab in front.`,
    );
  if (max > TIMING.HARD_FACTOR * med)
    reasons.push(
      `A frame took ${max.toFixed(1)} ms (>3× median). Close other apps, plug in power and re-check.`,
    );
  return {
    passed: reasons.length === 0,
    profile_hz: profile,
    measured_hz: Number.isFinite(hz) ? Math.round(hz * 1000) / 1000 : 0,
    median_interval_ms: Number.isFinite(med)
      ? Math.round(med * 1000) / 1000
      : 0,
    long_interval_fraction: longFraction,
    max_interval_ms: Number.isFinite(max) ? Math.round(max * 100) / 100 : 0,
    preflight_seconds: Math.round(seconds * 100) / 100,
    frames: clean.length,
    reasons,
    criteria: TIMING,
  };
}

/** Whole frames per cycle for each frequency, or null if one does not divide the profile. */
export function framesPerCycle(profileHz: number, freqs: number[]) {
  const out = freqs.map((f) => profileHz / f);
  return out.every((n) => Number.isInteger(n) && n >= 2) ? out : null;
}

/** Sampled-sinusoid luminance for one cycle (index = frameIndex mod framesPerCycle). */
export function cycleLuminance(fpc: number, mean: number, amplitude: number) {
  return Array.from({ length: fpc }, (_, i) =>
    Math.min(
      1,
      Math.max(0, mean + amplitude * Math.sin((2 * Math.PI * i) / fpc)),
    ),
  );
}

export function luminanceAt(cycles: number[][], frameIndex: number) {
  return cycles.map((c) => c[frameIndex % c.length]);
}

/** Does this callback interval interrupt a running trial? */
export function intervalFails(intervalMs: number, medianMs: number) {
  return intervalMs > TIMING.TRIAL_LONG_FACTOR * medianMs;
}

export type ClockSample = { t0: number; t1: number; server: number };

/** Clock offset (server − browser, ms) from the lowest-round-trip ping/pong sample. */
export function estimateClock(samples: ClockSample[]) {
  const ok = samples.filter((s) => s.t1 >= s.t0 && Number.isFinite(s.server));
  if (!ok.length) return null;
  const best = ok.reduce((a, b) => (b.t1 - b.t0 < a.t1 - a.t0 ? b : a));
  const rtt = best.t1 - best.t0;
  const offsets = ok.map((s) => s.server - (s.t0 + s.t1) / 2);
  return {
    offset_ms:
      Math.round((best.server - (best.t0 + best.t1) / 2) * 1000) / 1000,
    rtt_ms: Math.round(rtt * 1000) / 1000,
    samples: ok.length,
    spread_ms:
      Math.round((Math.max(...offsets) - Math.min(...offsets)) * 1000) / 1000,
  };
}

/** Browser time in ms on the epoch scale (performance clock, not Date). */
export const browserNow = () => performance.timeOrigin + performance.now();
