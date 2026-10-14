// Pure, time-based Glowing Garden model. No DOM, no timers: the render loop
// feeds it bounded time steps and the published score from the shared stream.
// Formulas follow docs/garden/spec.md ("Immediate response" and "Lasting growth").

export type GardenState = {
  /** Lasting growth in [0,1]. Never decreases except via explicit reset. */
  growth: number;
  /** Display response in [0,1]; reversible, follows the score with extra smoothing. */
  response: number;
  /** Seconds this garden has actually run with usable input. */
  active: number;
  /** Running totals for the facilitator tuning panel and session log. */
  stats: GardenStats;
};

export type GardenStats = {
  /** Active seconds with the score above the 0.5 baseline score. */
  above: number;
  /** ∫ score dt over active time (mean = scoreSum / active). */
  scoreSum: number;
  /** ∫ drive dt over active time; growth = driveSum / bloomSeconds. */
  driveSum: number;
  /** Active time when Growing, Blooming and full bloom were first reached. */
  reached: [number | null, number | null, number | null];
};

export const RESPONSE_TAU = 0.8; // seconds
export const BLOOM_SECONDS = 90; // default pace: seconds at score 1 (180 s at score 0.75)
export const PACE_MIN = 30;
export const PACE_MAX = 600;
export const MAX_DT = 0.1; // seconds; guards against background-tab catch-up
export const MILESTONES = [0.33, 0.67, 1] as const;

export const initialGarden = (): GardenState => ({
  growth: 0,
  response: 0.5,
  active: 0,
  stats: { above: 0, scoreSum: 0, driveSum: 0, reached: [null, null, null] },
});

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Growth drive from the published score. Zero at or below the 0.5 baseline score. */
export const drive = (score: number) => clamp01((score - 0.5) / 0.5);

/**
 * Advance one running tick. Callers only invoke this when every gate passes
 * (selected, started, visible, fresh, usable, same session). Invalid inputs
 * return the state unchanged rather than poisoning it.
 */
export function stepGarden(
  s: GardenState,
  dt: number,
  score: number,
  bloomSeconds: number = BLOOM_SECONDS,
): GardenState {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(score)) return s;
  const pace = Number.isFinite(bloomSeconds)
    ? Math.max(PACE_MIN, Math.min(PACE_MAX, bloomSeconds))
    : BLOOM_SECONDS;
  const h = Math.min(dt, MAX_DT);
  const sc = clamp01(score);
  const d = drive(sc);
  const response =
    s.response + (sc - s.response) * (1 - Math.exp(-h / RESPONSE_TAU));
  const growth = Math.min(1, s.growth + (h * d) / pace);
  const active = s.active + h;
  const reached = s.stats.reached.map((t, i) =>
    t === null && growth >= MILESTONES[i] ? active : t,
  ) as GardenStats["reached"];
  return {
    growth,
    response,
    active,
    stats: {
      above: s.stats.above + (sc > 0.5 ? h : 0),
      scoreSum: s.stats.scoreSum + sc * h,
      driveSum: s.stats.driveSum + d * h,
      reached,
    },
  };
}

/**
 * Pace tuning from observed play. `driveRate` is the average growth drive per
 * active second (0 when always at/below baseline, 1 when always at score 1).
 */
export function paceInsight(
  samples: { active: number; driveSum: number }[],
  pace: number,
  targetMinutes: number,
) {
  const active = samples.reduce((a, s) => a + s.active, 0);
  const driveSum = samples.reduce((a, s) => a + s.driveSum, 0);
  if (active < 30) return null;
  const driveRate = driveSum / active;
  const bloomMinutes = driveRate > 0 ? pace / driveRate / 60 : Infinity;
  const suggested = Math.round(
    Math.max(PACE_MIN, Math.min(PACE_MAX, targetMinutes * 60 * driveRate)),
  );
  return { active, driveRate, bloomMinutes, suggested };
}

/** Visual parameters derived from the reversible response. */
export function visuals(response: number) {
  const v = clamp01(response);
  return {
    glowOpacity: 0.1 + 0.65 * v,
    leafScale: 0.85 + 0.3 * v,
    leafOpenDegrees: 12 + 28 * v,
  };
}

export type Stage = "sprout" | "growing" | "blooming";

export function stageOf(growth: number): Stage {
  return growth < MILESTONES[0]
    ? "sprout"
    : growth < MILESTONES[1]
      ? "growing"
      : "blooming";
}

export const STAGE_LABEL: Record<Stage, string> = {
  sprout: "Sprout",
  growing: "Growing",
  blooming: "Blooming",
};

/** Progress inside the current stage interval toward its next milestone. */
export function milestone(growth: number) {
  const g = clamp01(growth);
  const stage = stageOf(g);
  if (g >= 1) return { stage, full: true, progress: 1, label: "Fully bloomed" };
  const i = MILESTONES.findIndex((m) => g < m);
  const start = i === 0 ? 0 : MILESTONES[i - 1];
  const end = MILESTONES[i];
  const label = ["Next: new leaves", "Next: a flower bud", "Next: full bloom"][
    i
  ];
  return { stage, full: false, progress: (g - start) / (end - start), label };
}

export type Relation = "below" | "near" | "above";

/** Current relative alpha against the fixed calibration baseline (center ± 0.25 × scale). */
export function baselineRelation(
  relativeAlpha: number | null | undefined,
  center: number | null | undefined,
  scale: number | null | undefined,
): Relation | null {
  if (
    relativeAlpha == null ||
    center == null ||
    scale == null ||
    !Number.isFinite(relativeAlpha) ||
    !Number.isFinite(center) ||
    !Number.isFinite(scale)
  )
    return null;
  const band = 0.25 * Math.abs(scale);
  return relativeAlpha < center - band
    ? "below"
    : relativeAlpha > center + band
      ? "above"
      : "near";
}

export type HistoryPoint = { t: number; score: number | null };
export const HISTORY_SECONDS = 60;
export const HISTORY_LIMIT = 260;

/**
 * Append a sample (or a gap marker when score is null) and keep only the last
 * 60 s of wall time, bounded in length. Consecutive gap markers collapse.
 */
export function pushHistory(
  history: HistoryPoint[],
  t: number,
  score: number | null,
): HistoryPoint[] {
  const last = history[history.length - 1];
  if (score === null && (!last || last.score === null))
    return prune(history, t);
  return prune([...history, { t, score }], t);
}

function prune(history: HistoryPoint[], t: number) {
  const cutoff = t - HISTORY_SECONDS * 1000;
  let first = 0;
  while (first < history.length && history[first].t < cutoff) first++;
  const kept = first ? history.slice(first) : history;
  return kept.length > HISTORY_LIMIT
    ? kept.slice(kept.length - HISTORY_LIMIT)
    : kept;
}
