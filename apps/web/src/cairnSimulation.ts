// Pure Cairn model. No DOM, no timers: the renderer feeds bounded time steps
// and the published score. A plank balances on a pointed rock; a hand stacks
// stones on it. Signal above baseline stiffens and damps the tower; distraction
// weakens it and lets the wind sway it. Every stone makes it taller and harder,
// every fifth stone lowers the tilt it can survive, and seeded events (a bug
// crossing the scene, a gust against the tower) grow commoner and stronger.

export type CairnMode = "calm" | "go";
export type HandPhase = "wait" | "approach" | "release" | "cheer" | "exit";
export type FallCause = "sway" | "drop";
export type EventKind = "bug" | "gust";

export type CairnEvent = {
  kind: EventKind;
  /** Event number this round; seeds its randomness. */
  index: number;
  /** Seconds since it began, and how long it lasts. */
  time: number;
  duration: number;
  /** 0 (small, brief) to 1 (big, long, strong). Grows with the stone count. */
  strength: number;
  /** Which way the gust blows or the bug travels: +1 is rightward. */
  direction: 1 | -1;
  /** Bugs: scurry along the boulder or fly through the air. */
  path: "ground" | "air";
};

export type CairnState = {
  mode: CairnMode;
  /** Seconds this round has actually run with usable input. */
  elapsed: number;
  /** Plank tilt (rad, positive = clockwise on screen) and its rate. */
  angle: number;
  velocity: number;
  /** Smoothed steadiness drive from the score, 0..1. */
  focus: number;
  /** Envelope of the swing, rad. Small means the tower is still. */
  sway: number;
  /** 0..1: gusts that build while the signal stays below baseline. */
  unrest: number;
  stones: number;
  phase: HandPhase;
  phaseTime: number;
  /** Hand descent, 0 (off-page) to 1 (stone touching the tower). */
  approach: number;
  fallen: boolean;
  cause: FallCause | null;
  /** Active seconds spent steady, for the round summary. */
  steadyTime: number;
  /** The bug or gust under way, if any. */
  event: CairnEvent | null;
  /** Round time at which the next event begins, and events so far. */
  nextEvent: number;
  events: number;
  seed: number;
};

export const CALM_INTERVAL = 3; // s per stone at full steadiness
export const GO_INTERVAL = 6; // s per stone, unconditional
export const RELEASE_SECONDS = 0.35;
export const EXIT_SECONDS = 0.75;
/** After every TIER_STONES-th stone the hand gives a thumbs up before leaving. */
export const CHEER_SECONDS = 1.2;
export const CALM_APPROACH = CALM_INTERVAL - RELEASE_SECONDS - EXIT_SECONDS;
export const GO_APPROACH = 2.5;
export const GO_WAIT = GO_INTERVAL - GO_APPROACH - RELEASE_SECONDS - EXIT_SECONDS;
/** Tilt at which stones slide off a new cairn (~17°). */
export const FALL_ANGLE = 0.3;
/** Swing below this counts as steady: the calm-mode hand only moves then. */
export const STEADY_SWAY = 0.045;
/** Go mode: a stone set down on a new cairn swinging above this knocks it over. */
export const UNSTEADY_SWAY = 0.075;
/** Every TIER_STONES stones, both topple limits shrink by TIER_FACTOR. */
export const TIER_STONES = 5;
export const TIER_FACTOR = 0.7;
/** A full-strength gust at its peak lowers the topple limits by this fraction. */
export const GUST_THRESHOLD = 0.35;
/** Peak push (rad/s²) of a full-strength gust on a short tower. */
export const GUST_PUSH = 0.12;
export const EASE_IN = 4; // s before full wind
export const MAX_DT = 0.1;
/** No event before this much play; then gaps shrink from EASY to HARD as stones rise. */
export const EVENT_FIRST = 14;
const EVENT_GAP_EASY = 24;
const EVENT_GAP_HARD = 7;
/** Stones at which events reach full frequency and strength. */
export const EVENT_FULL_STONES = 25;
const SUBSTEP = 1 / 120;
const FOCUS_TAU = 0.6;
const SWAY_DECAY = 0.5;
const UNREST_RISE = 12; // s to full unrest at zero focus
const UNREST_SETTLE = 6; // s to settle from full unrest
/** Kick (rad/s) from setting a stone down off-centre. */
const PLACE_KICK = 0.03;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const tierOf = (stones: number) => Math.floor(stones / TIER_STONES);
/** Tilt that topples the cairn with `stones` placed, under a gust load of 0..1. */
export const fallAngle = (stones: number, gust = 0) =>
  FALL_ANGLE * TIER_FACTOR ** tierOf(stones) * (1 - GUST_THRESHOLD * gust);
/** Go mode: sway above which a landing stone knocks the cairn over. */
export const dropSway = (stones: number, gust = 0) =>
  UNSTEADY_SWAY * TIER_FACTOR ** tierOf(stones) * (1 - GUST_THRESHOLD * gust);

/** A gust's current effect, 0..1: quick to arrive, a short hold, then easing off. */
export function gustLoad(s: Pick<CairnState, "event">) {
  const e = s.event;
  if (!e || e.kind !== "gust") return 0;
  const x = e.time / e.duration;
  return e.strength * smoothstep(0, 0.25, x) * (1 - smoothstep(0.6, 1, x));
}

/** Steadiness drive from the published score: 0 at 0.35, 1 at 0.8 (0.5 is the baseline). */
export const focusOf = (score: number) => clamp01((score - 0.35) / 0.45);
/** Focus at the 0.5 baseline score; below it unrest builds, above it settles. */
const BASELINE_FOCUS = focusOf(0.5);

export const initialCairn = (mode: CairnMode = "calm", seed = 1): CairnState => ({
  mode,
  elapsed: 0,
  angle: 0,
  velocity: 0,
  focus: 0.5,
  sway: 0,
  unrest: 0,
  stones: 0,
  phase: mode === "go" ? "wait" : "approach",
  phaseTime: 0,
  approach: 0,
  fallen: false,
  cause: null,
  steadyTime: 0,
  event: null,
  nextEvent: EVENT_FIRST + 8 * stoneRandom(seed, 0, 19),
  events: 0,
  seed,
});

/** Restoring stiffness net of the height's toppling torque. Negative is unstable. */
export const stiffness = (focus: number, stones: number) =>
  0.6 + 12 * focus - 0.3 * stones;
export const damping = (focus: number) => 0.4 + 2.4 * focus;

/** Deterministic gusts: a few incommensurate swells, stronger with distraction, unrest and height. */
export function wind(t: number, focus: number, stones: number, unrest = 0) {
  const swell =
    0.55 * Math.sin(1.9 * t) +
    0.3 * Math.sin(3.1 * t + 1) +
    0.25 * Math.sin(0.7 * t + 2);
  return (
    0.3 *
    (0.08 + 1.3 * (1 - focus) ** 3) *
    (1 + 0.05 * stones) *
    (1 + 3 * unrest) *
    swell
  );
}

export const isSteady = (s: CairnState) => s.sway < STEADY_SWAY;

/** Stable per-stone pseudo-random numbers in [0, 1), from the round seed. */
export function stoneRandom(seed: number, index: number, salt = 0) {
  let a = (seed * 0x9e3779b1 + index * 0x85ebca6b + salt * 0xc2b2ae35) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Where the next stone lands across the top, -1..1 of a small jitter range. */
export const stoneOffset = (seed: number, index: number) =>
  stoneRandom(seed, index, 1) * 2 - 1;

function physics(s: CairnState, h: number, score: number): CairnState {
  const focus =
    s.focus + (focusOf(score) - s.focus) * (1 - Math.exp(-h / FOCUS_TAU));
  const unrest = clamp01(
    focus < BASELINE_FOCUS
      ? s.unrest + ((BASELINE_FOCUS - focus) / BASELINE_FOCUS) * (h / UNREST_RISE)
      : s.unrest - h / UNREST_SETTLE,
  );
  const k = stiffness(focus, s.stones);
  const ease = Math.min(1, s.elapsed / EASE_IN);
  // A gust leans on the tower from one side, fluttering a little; taller towers catch more.
  const gust = s.event?.kind === "gust"
    ? s.event.direction * GUST_PUSH * gustLoad(s) * (1 + 0.04 * s.stones) *
      (1 + 0.25 * Math.sin(7.3 * s.event.time))
    : 0;
  const accel =
    -k * s.angle -
    damping(focus) * s.velocity +
    ease * wind(s.elapsed, focus, s.stones, unrest) +
    gust;
  const velocity = s.velocity + accel * h;
  const angle = s.angle + velocity * h;
  const omega = Math.sqrt(Math.max(k, 1));
  const raw = Math.hypot(angle, velocity / omega);
  const sway =
    raw > s.sway ? raw : s.sway + (raw - s.sway) * (1 - Math.exp(-h / SWAY_DECAY));
  return { ...s, focus, unrest, angle, velocity, sway, elapsed: s.elapsed + h };
}

function place(s: CairnState): CairnState {
  if (s.mode === "go" && s.sway > dropSway(s.stones, gustLoad(s)))
    return { ...s, fallen: true, cause: "drop", phase: "release", phaseTime: 0 };
  const kick = PLACE_KICK * stoneOffset(s.seed, s.stones);
  return {
    ...s,
    stones: s.stones + 1,
    velocity: s.velocity + kick,
    phase: "release",
    phaseTime: 0,
  };
}

function hand(s: CairnState, h: number): CairnState {
  const t = s.phaseTime + h;
  switch (s.phase) {
    case "wait":
      return t >= GO_WAIT
        ? { ...s, phase: "approach", phaseTime: 0, approach: 0 }
        : { ...s, phaseTime: t };
    case "approach": {
      const rate = s.mode === "go" ? 1 / GO_APPROACH : isSteady(s) ? 1 / CALM_APPROACH : 0;
      const approach = Math.min(1, s.approach + rate * h);
      const next = { ...s, approach, phaseTime: t };
      return approach >= 1 ? place(next) : next;
    }
    case "release":
      return t >= RELEASE_SECONDS
        ? { ...s, phase: cheers(s) ? "cheer" : "exit", phaseTime: 0 }
        : { ...s, phaseTime: t };
    case "cheer":
      return t >= CHEER_SECONDS
        ? { ...s, phase: "exit", phaseTime: 0 }
        : { ...s, phaseTime: t };
    case "exit":
      return t >= EXIT_SECONDS
        ? {
            ...s,
            phase: s.mode === "go" ? "wait" : "approach",
            // Go mode keeps its fixed schedule: the thumbs up comes out of the wait.
            phaseTime: s.mode === "go" && cheers(s) ? CHEER_SECONDS : 0,
            approach: 0,
          }
        : { ...s, phaseTime: t };
  }
}

/** The stone just placed completes a tier of five: the hand gives a thumbs up. */
const cheers = (s: CairnState) => s.stones > 0 && s.stones % TIER_STONES === 0;

/** How far events have ramped up, 0..1, from the stone count. */
export const eventIntensity = (stones: number) => clamp01(stones / EVENT_FULL_STONES);

/** Start, run and finish bugs and gusts on a seeded schedule that tightens with height. */
function events(s: CairnState, h: number): CairnState {
  if (s.event) {
    const time = s.event.time + h;
    if (time < s.event.duration) return { ...s, event: { ...s.event, time } };
    const intensity = eventIntensity(s.stones);
    const gap =
      (EVENT_GAP_EASY + (EVENT_GAP_HARD - EVENT_GAP_EASY) * intensity) *
      (0.6 + 0.8 * stoneRandom(s.seed, s.events, 25));
    return { ...s, event: null, nextEvent: s.elapsed + gap };
  }
  if (s.elapsed < s.nextEvent) return s;
  const r = (k: number) => stoneRandom(s.seed, s.events, 20 + k);
  const intensity = eventIntensity(s.stones);
  const strength = clamp01(0.08 + 0.92 * intensity * (0.75 + 0.5 * r(1)));
  return startEvent(
    s,
    r(2) < 0.5 ? "bug" : "gust",
    strength,
    r(3) < 0.5 ? 1 : -1,
    r(4) < 0.15 + 0.6 * strength ? "air" : "ground",
  );
}

/** Begin an event now. Small bugs dash past; big ones linger. Big gusts blow longer. */
export function startEvent(
  s: CairnState,
  kind: EventKind,
  strength: number,
  direction: 1 | -1 = 1,
  path: CairnEvent["path"] = "ground",
): CairnState {
  const k = clamp01(strength);
  return {
    ...s,
    events: s.events + 1,
    event: {
      kind,
      index: s.events,
      time: 0,
      duration: kind === "bug" ? 2.6 + 4.4 * k : 1.8 + 3.2 * k,
      strength: k,
      direction,
      path,
    },
  };
}

/**
 * Advance one running tick. Callers only invoke this when every gate passes
 * (selected, started, visible, fresh, usable, same session). A fallen cairn
 * and invalid inputs return the state unchanged.
 */
export function stepCairn(s: CairnState, dt: number, score: number): CairnState {
  if (s.fallen || !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(score)) return s;
  let left = Math.min(dt, MAX_DT);
  // A new round starts from the current signal rather than a neutral guess.
  let next = s.elapsed === 0 ? { ...s, focus: focusOf(clamp01(score)) } : s;
  while (left > 1e-9 && !next.fallen) {
    const h = Math.min(SUBSTEP, left);
    left -= h;
    next = physics(next, h, clamp01(score));
    if (isSteady(next)) next = { ...next, steadyTime: next.steadyTime + h };
    if (Math.abs(next.angle) >= fallAngle(next.stones, gustLoad(next)))
      return { ...next, fallen: true, cause: "sway" };
    next = events(hand(next, h), h);
  }
  return next;
}
