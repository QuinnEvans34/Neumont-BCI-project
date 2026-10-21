// Trial sequences and the bilateral cue timeline. Deterministic given a seed.

export type Requested = 0 | 1 | 2 | "neutral" | null;
export type BlockKind = "setup" | "evaluation" | "single";
export type Trial = {
  id: string;
  block: BlockKind;
  requested: Requested;
  index: number;
};

export const CARD_LABELS = ["A", "B", "C"] as const;
export const SETUP_PER_TARGET = 5;
export const SETUP_NEUTRAL = 10;
export const EVAL_PER_TARGET = 10;
export const EVAL_NEUTRAL = 10;
export const TRIALS_PER_BREAK = 10;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], seed: number) {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A randomized block (saved seed), split into short runs separated by explicit breaks. */
export function buildBlock(
  block: "setup" | "evaluation",
  seed: number,
  prefix = block[0],
) {
  const per = block === "setup" ? SETUP_PER_TARGET : EVAL_PER_TARGET;
  const neutral = block === "setup" ? SETUP_NEUTRAL : EVAL_NEUTRAL;
  const items: Requested[] = [];
  for (const t of [0, 1, 2] as const)
    for (let k = 0; k < per; k++) items.push(t);
  for (let k = 0; k < neutral; k++) items.push("neutral");
  const order = shuffle(items, seed);
  const trials: Trial[] = order.map((requested, index) => ({
    id: `${prefix}${seed.toString(36)}-${index + 1}`,
    block,
    requested,
    index,
  }));
  const runs: Trial[][] = [];
  for (let i = 0; i < trials.length; i += TRIALS_PER_BREAK)
    runs.push(trials.slice(i, i + TRIALS_PER_BREAK));
  return { block, seed, trials, runs };
}

export const requestedLabel = (r: Requested) =>
  r === null
    ? "Free look (unlabelled)"
    : r === "neutral"
      ? "Neutral — centre dot"
      : `Card ${CARD_LABELS[r]}`;

// ---------------------------------------------------------------- bilateral
export type Phase = "fixation_pre" | "alternating" | "fixation_post";
export const PHASE_LABEL: Record<Phase, string> = {
  fixation_pre: "Central fixation",
  alternating: "Alternating cues",
  fixation_post: "Central fixation",
};

export type BilateralSettings = {
  interval_ms: number;
  fixation_pre_s: number;
  alternating_s: number;
  fixation_post_s: number;
  instruction: "follow" | "fixate";
};

export function phasesOf(s: BilateralSettings) {
  const list: { phase: Phase; start: number; end: number }[] = [];
  let t = 0;
  for (const [phase, d] of [
    ["fixation_pre", s.fixation_pre_s],
    ["alternating", s.alternating_s],
    ["fixation_post", s.fixation_post_s],
  ] as const) {
    list.push({ phase, start: t * 1000, end: (t + d) * 1000 });
    t += d;
  }
  return list;
}

/**
 * Where the run is at elapsed ms. `side` is the highlighted side during the
 * alternating phase; `changeIndex` counts side changes (0 = first left cue).
 * Time between side changes is interval_ms: at 1000 ms, left→right takes 1 s
 * and left→right→left takes 2 s.
 */
export function bilateralAt(s: BilateralSettings, elapsedMs: number) {
  const phases = phasesOf(s);
  const total = phases[phases.length - 1].end;
  if (elapsedMs >= total)
    return {
      done: true,
      phase: null,
      side: null,
      changeIndex: -1,
      phaseIndex: 3,
      total,
    };
  const phaseIndex = phases.findIndex((p) => elapsedMs < p.end);
  const p = phases[phaseIndex];
  if (p.phase !== "alternating")
    return {
      done: false,
      phase: p.phase,
      side: null,
      changeIndex: -1,
      phaseIndex,
      total,
    };
  const changeIndex = Math.floor((elapsedMs - p.start) / s.interval_ms);
  return {
    done: false,
    phase: p.phase,
    side: (changeIndex % 2 === 0 ? "left" : "right") as "left" | "right",
    changeIndex,
    phaseIndex,
    total,
  };
}

export const expectedSideChanges = (s: BilateralSettings) =>
  Math.ceil((s.alternating_s * 1000) / s.interval_ms);
