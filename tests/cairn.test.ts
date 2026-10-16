import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initialCairn,
  stepCairn,
  startEvent,
  focusOf,
  fallAngle,
  dropSway,
  gustLoad,
  CALM_INTERVAL,
  CHEER_SECONDS,
  GO_INTERVAL,
  GO_WAIT,
  GO_APPROACH,
  FALL_ANGLE,
  STEADY_SWAY,
  UNSTEADY_SWAY,
  TIER_FACTOR,
  GUST_THRESHOLD,
  EVENT_FIRST,
  MAX_DT,
  type CairnMode,
  type CairnState,
} from "../apps/web/src/cairnSimulation.ts";
import {
  Stack,
  stoneKind,
  STONE_KINDS,
  JITTER,
  type CairnManifest,
} from "../apps/web/src/cairnGeometry.ts";
import {
  addRound,
  addStimulus,
  sanitizeRecord,
  stimulusCsv,
  emptyRecord,
  bestKey,
  ROUND_LIMIT,
  STIMULUS_LIMIT,
  type CairnRound,
  type CairnStimulus,
} from "../apps/web/src/cairnScores.ts";

const manifest = JSON.parse(
  readFileSync(new URL("../apps/web/src/assets/cairn/manifest.json", import.meta.url), "utf8"),
) as CairnManifest;
const trace = JSON.parse(
  readFileSync(new URL("./fixtures/cairn/openbci-meditation.json", import.meta.url), "utf8"),
) as { rate_hz: number; score: number[]; usable: number[]; calibration: { accepted: number } };

const HZ = 60;
function run(s: CairnState, seconds: number, score: number | ((t: number) => number)) {
  const at = typeof score === "number" ? () => score : score;
  for (let i = 0; i < Math.round(seconds * HZ) && !s.fallen; i++)
    s = stepCairn(s, 1 / HZ, at(s.elapsed));
  return s;
}

test("score maps to focus around the 0.5 baseline", () => {
  assert.equal(focusOf(0.35), 0);
  assert.equal(focusOf(0.8), 1);
  assert.ok(focusOf(0.5) > 0.3 && focusOf(0.5) < 0.4);
  assert.equal(focusOf(-1), 0);
  assert.equal(focusOf(2), 1);
});

test("invalid steps and a fallen cairn leave the state unchanged", () => {
  const s = initialCairn("calm");
  assert.equal(stepCairn(s, NaN, 0.6), s);
  assert.equal(stepCairn(s, -1, 0.6), s);
  assert.equal(stepCairn(s, 0.1, NaN), s);
  const fallen = { ...s, fallen: true };
  assert.equal(stepCairn(fallen, 0.1, 0.9), fallen);
});

test("a long gap cannot fast-forward the round", () => {
  const s = stepCairn(initialCairn("calm"), 30, 0.7);
  assert.ok(Math.abs(s.elapsed - MAX_DT) < 1e-9);
});

test("every five stones the cairn topples at a smaller tilt", () => {
  assert.equal(fallAngle(0), FALL_ANGLE);
  assert.equal(fallAngle(4), FALL_ANGLE);
  assert.ok(Math.abs(fallAngle(5) - FALL_ANGLE * TIER_FACTOR) < 1e-12);
  assert.ok(Math.abs(fallAngle(14) - FALL_ANGLE * TIER_FACTOR ** 2) < 1e-12);
  assert.ok(Math.abs(dropSway(10) - UNSTEADY_SWAY * TIER_FACTOR ** 2) < 1e-12);
  // A tilt a new cairn survives topples a tall one.
  const leaning = (stones: number): CairnState => ({
    ...initialCairn("calm"),
    elapsed: 10,
    stones,
    phase: "exit",
    angle: 0.25,
  });
  assert.equal(stepCairn(leaning(3), 0.01, 0.8).fallen, false);
  const tall = stepCairn(leaning(5), 0.01, 0.8);
  assert.equal(tall.fallen, true);
  assert.equal(tall.cause, "sway");
});

test("calm mode: a focused player gets a stone about every 3 seconds", () => {
  const s = run(initialCairn("calm"), 30, 0.75);
  assert.equal(s.fallen, false);
  const expected = Math.floor(30 / CALM_INTERVAL);
  assert.ok(Math.abs(s.stones - expected) <= 1, `${s.stones} stones, expected ~${expected}`);
});

test("calm mode: the hand holds still while the tower sways", () => {
  const swaying: CairnState = {
    ...initialCairn("calm"),
    elapsed: 10,
    approach: 0.5,
    sway: STEADY_SWAY * 3,
    angle: STEADY_SWAY * 3,
  };
  const next = stepCairn(swaying, 0.05, 0.3);
  assert.equal(next.approach, swaying.approach);
  assert.equal(next.stones, 0);
});

test("go mode: stones arrive every 6 seconds regardless of steadiness", () => {
  const s = run(initialCairn("go"), 30, 0.75);
  assert.equal(s.fallen, false);
  // First landing at GO_WAIT + GO_APPROACH, then one per interval.
  const expected = 1 + Math.floor((30 - GO_WAIT - GO_APPROACH) / GO_INTERVAL);
  assert.equal(s.stones, expected);
});

test("every fifth stone the hand gives a thumbs up before leaving", () => {
  const phases = (stones: number) => {
    let s: CairnState = { ...initialCairn("calm"), elapsed: 10, stones, approach: 0.999 };
    const seen: string[] = [];
    for (let i = 0; i < 120 * 4; i++) {
      s = stepCairn(s, 1 / 120, 0.8);
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
      if (s.phase === "approach") break;
    }
    return seen;
  };
  assert.deepEqual(phases(4), ["release", "cheer", "exit", "approach"]);
  assert.deepEqual(phases(5), ["release", "exit", "approach"]);
});

test("go mode keeps its 6 second schedule through a thumbs up", () => {
  const s = run(initialCairn("go", 4), 64, 0.8);
  assert.equal(s.fallen, false);
  // Stones land at GO_WAIT + GO_APPROACH, then every GO_INTERVAL, cheers or not.
  assert.equal(s.stones, 1 + Math.floor((64 - GO_WAIT - GO_APPROACH) / GO_INTERVAL));
  assert.ok(CHEER_SECONDS < GO_WAIT, "the thumbs up fits inside the wait");
});

test("go mode: a stone set on a swaying tower knocks the cairn over", () => {
  const swaying: CairnState = {
    ...initialCairn("go"),
    elapsed: 10,
    stones: 4,
    phase: "approach",
    approach: 0.999,
    sway: UNSTEADY_SWAY * 2,
  };
  const next = stepCairn(swaying, 0.05, 0.3);
  assert.equal(next.fallen, true);
  assert.equal(next.cause, "drop");
  assert.equal(next.stones, 4, "the toppling stone does not score");
});

test("go mode: a stone set on a steady tower scores", () => {
  const steady: CairnState = {
    ...initialCairn("go"),
    elapsed: 10,
    stones: 4,
    phase: "approach",
    approach: 0.999,
  };
  const next = stepCairn(steady, 0.05, 0.8);
  assert.equal(next.fallen, false);
  assert.equal(next.stones, 5);
  assert.equal(next.phase, "release");
});

test("distraction topples the cairn in both modes", () => {
  for (const mode of ["calm", "go"] as CairnMode[]) {
    const s = run(initialCairn(mode), 20, 0.3);
    assert.equal(s.fallen, true, `${mode} should fall`);
  }
  // Calm mode: a tilt past the limit, not a drop.
  const calm = run(initialCairn("calm"), 20, 0.3);
  assert.equal(calm.cause, "sway");
  assert.ok(Math.abs(calm.angle) >= FALL_ANGLE);
});

test("unrest builds below baseline and settles above it", () => {
  const low = run(initialCairn("calm"), 3, 0.42);
  assert.ok(low.unrest > 0);
  const settled = run({ ...low, fallen: false }, 10, 0.75);
  assert.ok(settled.unrest < low.unrest);
});

test("more focus builds taller cairns", () => {
  const stones = (score: number) => run(initialCairn("calm", 3), 300, score).stones;
  const base = stones(0.5);
  const focused = stones(0.65);
  const very = stones(0.8);
  assert.ok(base > 3, `baseline should make slow progress (${base})`);
  assert.ok(focused > base && very > focused, `${base} < ${focused} < ${very}`);
});

test("the model is deterministic", () => {
  const a = run(initialCairn("go", 9), 60, (t) => 0.55 + 0.2 * Math.sin(t));
  const b = run(initialCairn("go", 9), 60, (t) => 0.55 + 0.2 * Math.sin(t));
  assert.deepEqual(a, b);
});

test("bugs and gusts start rare and small, then come often and big", () => {
  let s = initialCairn("calm", 3);
  const seen: { at: number; stones: number; strength: number }[] = [];
  while (!s.fallen && s.elapsed < 300) {
    const prev = s.event;
    s = stepCairn(s, 1 / 30, 0.8);
    if (s.event && s.event.index !== prev?.index)
      seen.push({ at: s.elapsed, stones: s.stones, strength: s.event.strength });
  }
  assert.ok(seen.length >= 4, `${seen.length} events`);
  assert.ok(seen[0].at >= EVENT_FIRST, "nothing happens in the first seconds");
  const early = seen.filter((e) => e.stones < 10);
  const late = seen.filter((e) => e.stones >= 20);
  assert.ok(early.length > 0 && late.length > 0);
  assert.ok(early.every((e) => e.strength < 0.5), "early events are small");
  assert.ok(late.every((e) => e.strength > 0.6), "late events are big");
  const gap = (list: typeof seen) => (list[list.length - 1].at - list[0].at) / Math.max(1, list.length - 1);
  assert.ok(gap(late) < gap(seen.slice(0, 3)), "and come more often");
});

test("a gust pushes the tower and briefly lowers the topple limit", () => {
  const calm: CairnState = { ...initialCairn("go", 2), elapsed: 30, stones: 6, phase: "wait" };
  const gusty = startEvent(calm, "gust", 1, 1);
  let a = calm;
  let b = gusty;
  let peak = 0;
  let lowest = Infinity;
  for (let i = 0; i < 30 * 6; i++) {
    a = stepCairn(a, 1 / 30, 0.8);
    b = stepCairn(b, 1 / 30, 0.8);
    peak = Math.max(peak, b.angle - a.angle);
    lowest = Math.min(lowest, fallAngle(b.stones, gustLoad(b)));
  }
  assert.ok(peak > 0.01, `the gust leans the tower downwind (${peak})`);
  assert.ok(Math.abs(lowest - fallAngle(6) * (1 - GUST_THRESHOLD)) < 0.002, "the limit dips at the peak");
  assert.equal(b.event, null, "then it passes");
  assert.equal(fallAngle(b.stones, gustLoad(b)), fallAngle(6));
  assert.equal(b.fallen, false, "a focused player rides it out");
});

test("a passing bug changes nothing in the physics", () => {
  const s: CairnState = { ...initialCairn("calm", 2), elapsed: 30, stones: 8, nextEvent: 1e9 };
  const a = run(s, 5, (t) => 0.55 + 0.1 * Math.sin(t));
  const b = run(startEvent(s, "bug", 1, -1, "air"), 5, (t) => 0.55 + 0.1 * Math.sin(t));
  assert.equal(b.angle, a.angle);
  assert.equal(b.stones, a.stones);
});

test("recorded EEG: the OpenBCI meditation session builds real cairns", () => {
  assert.equal(trace.calibration.accepted, 30);
  const scoreAt = (t: number) =>
    trace.score[Math.min(trace.score.length - 1, Math.floor(t * trace.rate_hz))];
  for (const mode of ["calm", "go"] as CairnMode[]) {
    const s = run(initialCairn(mode, 1), trace.score.length / trace.rate_hz, scoreAt);
    // Meditation raises relative alpha above the first minute's baseline.
    assert.ok(s.stones >= 10, `${mode}: ${s.stones} stones`);
    assert.ok(s.steadyTime / s.elapsed > 0.5, `${mode} mostly steady`);
  }
});

test("stone sequence varies and never repeats back to back", () => {
  const kinds = Array.from({ length: 200 }, (_, i) => stoneKind(42, i));
  assert.ok(kinds.every((k) => k >= 1 && k <= STONE_KINDS));
  assert.ok(kinds.every((k, i) => i === 0 || k !== kinds[i - 1]));
  assert.equal(new Set(kinds).size, STONE_KINDS);
});

test("stones stack upward on the plank and stay near the pivot", () => {
  const stack = new Stack(manifest, 5);
  let top = stack.top;
  assert.ok(top < 0, "the plank's top is above the pivot");
  for (let i = 0; i < 30; i++) {
    const landing = stack.landing(i);
    const placed = stack.place(i);
    assert.deepEqual(placed, landing, "landing preview matches placement");
    assert.ok(placed.top < top, "each stone raises the tower");
    assert.ok(Math.abs(placed.x) <= 2 * JITTER, "stones stay over the pivot");
    top = stack.top;
  }
  assert.ok(top < -1000, `30 stones stand tall (${top})`);
});

test("a smaller plank lowers the first stone by its scale", () => {
  const full = new Stack(manifest, 5).top;
  const small = new Stack(manifest, 5, 0.85).top;
  assert.ok(Math.abs(small - full * 0.85) < 1e-9, `${small} vs ${full}`);
});

const round = (over: Partial<CairnRound> = {}): CairnRound => ({
  at: "2026-10-14T12:00:00.000Z",
  mode: "calm",
  source: "replay",
  stones: 7,
  seconds: 40,
  steady: 0.8,
  ending: "sway",
  ...over,
});

test("best scores rise per source and mode, never across them", () => {
  let r = addRound(emptyRecord(), round());
  r = addRound(r, round({ stones: 4 }));
  r = addRound(r, round({ source: "live", stones: 3 }));
  r = addRound(r, round({ mode: "go", stones: 9 }));
  assert.equal(r.best[bestKey("replay", "calm")], 7);
  assert.equal(r.best[bestKey("live", "calm")], 3);
  assert.equal(r.best[bestKey("replay", "go")], 9);
  assert.equal(r.rounds.length, 4);
  assert.equal(addRound(r, round({ stones: 0 })), r, "empty rounds are not logged");
});

test("stored records are sanitized and bounded", () => {
  assert.deepEqual(sanitizeRecord(null), emptyRecord());
  assert.deepEqual(sanitizeRecord("junk"), emptyRecord());
  const messy = sanitizeRecord({
    mode: "go",
    best: { "live:calm": 5, "live:go": -2, x: "7" },
    rounds: [round(), { ...round(), stones: "many" }, { ...round(), ending: "boom" }, 4],
  });
  assert.equal(messy.mode, "go");
  assert.deepEqual(messy.best, { "live:calm": 5 });
  assert.equal(messy.rounds.length, 1);
  let r = emptyRecord();
  for (let i = 0; i < ROUND_LIMIT + 10; i++) r = addRound(r, round({ stones: i + 1 }));
  assert.equal(sanitizeRecord(JSON.parse(JSON.stringify(r))).rounds.length, ROUND_LIMIT);
});

const stim = (over: Partial<CairnStimulus> = {}): CairnStimulus => ({
  start: 1_760_000_000_000,
  end: 1_760_000_004_500,
  hz: 15,
  strength: 0.4,
  path: "ground",
  mode: "calm",
  source: "live",
  ...over,
});

test("flicker is opt-in and its stimuli are logged, sanitized and bounded", () => {
  assert.equal(emptyRecord().flicker, false);
  assert.equal(sanitizeRecord({ flicker: "yes" }).flicker, false);
  assert.equal(sanitizeRecord({ flicker: true }).flicker, true);
  const messy = sanitizeRecord({
    stimuli: [stim(), { ...stim(), end: 1 }, { ...stim(), path: "sea" }, { ...stim(), hz: "15" }, null],
  });
  assert.deepEqual(messy.stimuli, [stim()]);
  let r = emptyRecord();
  for (let i = 0; i < STIMULUS_LIMIT + 5; i++) r = addStimulus(r, stim({ start: i, end: i + 1 }));
  assert.equal(r.stimuli.length, STIMULUS_LIMIT);
  assert.equal(r.stimuli[0].start, 5, "the oldest are dropped");
});

test("the flicker log exports as CSV in Unix seconds", () => {
  const [header, row, end] = stimulusCsv([stim()]).split("\n");
  assert.equal(header, "onset_unix_s,offset_unix_s,duration_s,hz,strength,path,mode,source,onset_iso");
  assert.equal(row, "1760000000.000,1760000004.500,4.500,15,0.4,ground,calm,live,2025-10-09T08:53:20.000Z");
  assert.equal(end, "");
});
