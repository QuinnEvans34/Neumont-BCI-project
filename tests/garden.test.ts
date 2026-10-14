import test from "node:test";
import assert from "node:assert/strict";
import {
  initialGarden,
  stepGarden,
  milestone,
  stageOf,
  visuals,
  baselineRelation,
  pushHistory,
  MAX_DT,
  paceInsight,
  type GardenState,
} from "../apps/web/src/gardenSimulation.ts";
import { breathAt, BREATH_CYCLE } from "../apps/web/src/breath.ts";
import {
  observeReference,
  initialWatch,
  canTick,
} from "../apps/web/src/games/lifecycle.ts";

function run(s: GardenState, seconds: number, score: number, hz = 60) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) s = stepGarden(s, 1 / hz, score);
  return s;
}

/** Seconds of constant input until growth reaches 1, at 60 Hz. */
function secondsToBloom(score: number) {
  let s = initialGarden();
  let t = 0;
  while (s.growth < 1 && t < 1000) {
    s = stepGarden(s, 1 / 60, score);
    t += 1 / 60;
  }
  return t;
}

test("no growth at or below the baseline score", () => {
  for (const score of [0, 0.25, 0.5]) {
    const s = run(initialGarden(), 300, score);
    assert.equal(s.growth, 0);
    assert.ok(Math.abs(s.active - 300) < 1e-6);
  }
});

test("score 1 blooms in about 90 s and 0.75 in about 180 s", () => {
  assert.ok(Math.abs(secondsToBloom(1) - 90) < 0.1);
  assert.ok(Math.abs(secondsToBloom(0.75) - 180) < 0.1);
});

test("earned growth is kept when the score drops and stays within [0,1]", () => {
  let s = run(initialGarden(), 40, 1);
  const earned = s.growth;
  assert.ok(earned > 0.4 && earned < 0.5);
  s = run(s, 120, 0);
  assert.equal(s.growth, earned);
  assert.ok(s.response < 0.01, "display response settles with low score");
  s = run(s, 500, 1);
  assert.equal(s.growth, 1);
  s = run(s, 10, 0.2);
  assert.equal(s.growth, 1);
});

test("display response is visibly different within two seconds of a 0.25 → 0.75 change", () => {
  let s = run(initialGarden(), 10, 0.25);
  const low = visuals(s.response);
  s = run(s, 2, 0.75);
  const high = visuals(s.response);
  assert.ok(high.glowOpacity - low.glowOpacity > 0.25);
  assert.ok(high.leafOpenDegrees - low.leafOpenDegrees > 10);
});

test("growth is time-based: 30/60/120 Hz agree for the same duration", () => {
  const results = [30, 60, 120].map((hz) => run(initialGarden(), 45, 0.8, hz));
  for (const r of results) {
    assert.ok(Math.abs(r.growth - results[1].growth) < 1e-6);
    assert.ok(Math.abs(r.response - results[1].response) < 1e-3);
    assert.ok(Math.abs(r.active - 45) < 1e-6);
  }
});

test("invalid input and paused ticks never change state; long gaps cannot catch up", () => {
  const s = run(initialGarden(), 20, 0.9);
  for (const [dt, score] of [
    [0, 1],
    [-1, 1],
    [NaN, 1],
    [1 / 60, NaN],
    [Infinity, 1],
  ])
    assert.deepEqual(stepGarden(s, dt, score), s);
  // A browser returning after an hour in the background delivers one huge delta.
  const after = stepGarden(s, 3600, 1);
  assert.ok(after.active - s.active <= MAX_DT + 1e-9);
  assert.ok(after.growth - s.growth <= MAX_DT / 90 + 1e-9);
  // Reset restores initial state exactly.
  assert.deepEqual(initialGarden(), {
    growth: 0,
    response: 0.5,
    active: 0,
    stats: { above: 0, scoreSum: 0, driveSum: 0, reached: [null, null, null] },
  });
});

test("stage thresholds and next-stage progress", () => {
  assert.equal(stageOf(0), "sprout");
  assert.equal(stageOf(0.329), "sprout");
  assert.equal(stageOf(0.33), "growing");
  assert.equal(stageOf(0.67), "blooming");
  assert.ok(Math.abs(milestone(0.165).progress - 0.5) < 1e-9);
  assert.ok(Math.abs(milestone(0.5).progress - 0.5) < 1e-9);
  assert.equal(milestone(0.5).label, "Next: a flower bud");
  assert.ok(Math.abs(milestone(0.835).progress - 0.5) < 1e-9);
  const full = milestone(1);
  assert.equal(full.full, true);
  assert.equal(full.label, "Fully bloomed");
});

test("baseline relation uses center ± 0.25 × scale and rejects missing values", () => {
  assert.equal(baselineRelation(0.3, 0.3, 0.04), "near");
  assert.equal(baselineRelation(0.311, 0.3, 0.04), "above");
  assert.equal(baselineRelation(0.289, 0.3, 0.04), "below");
  assert.equal(baselineRelation(null, 0.3, 0.04), null);
  assert.equal(baselineRelation(0.3, null, 0.04), null);
  assert.equal(baselineRelation(NaN, 0.3, 0.04), null);
});

test("history keeps 60 s of wall time, bounded, with collapsed gaps", () => {
  let h = pushHistory([], 0, 0.5);
  h = pushHistory(h, 250, null);
  h = pushHistory(h, 500, null);
  assert.equal(h.length, 2, "consecutive gaps collapse");
  for (let i = 0; i < 1000; i++) h = pushHistory(h, 1000 + i * 250, 0.6);
  assert.ok(h.length <= 260);
  const last = h[h.length - 1].t;
  assert.ok(h.every((p) => p.t >= last - 60_000));
});

test("session and recalibration changes invalidate; outages do not", () => {
  let w = initialWatch();
  let r = observeReference(w, { session_id: "a", calibrating: false });
  assert.equal(r.invalidate, false);
  w = r.watch;
  // Transient missing telemetry is not a new session.
  r = observeReference(w, null);
  assert.equal(r.invalidate, false);
  r = observeReference(w, { session_id: null, calibrating: false });
  assert.equal(r.invalidate, false);
  // Same session, recalibration starts (local or another viewer).
  r = observeReference(w, { session_id: "a", calibrating: true });
  assert.equal(r.invalidate, true);
  w = r.watch;
  r = observeReference(w, { session_id: "a", calibrating: true });
  assert.equal(r.invalidate, false, "only the transition counts");
  w = observeReference(r.watch, { session_id: "a", calibrating: false }).watch;
  // Another viewer switches source: new session ID.
  r = observeReference(w, { session_id: "b", calibrating: false });
  assert.equal(r.invalidate, true);
});

test("ticks require every gate", () => {
  const ok = {
    selected: true,
    onPlayPage: true,
    running: true,
    visible: true,
    usable: true,
    boundSession: "a",
    telemetrySession: "a",
  };
  assert.equal(canTick(ok), true);
  for (const key of [
    "selected",
    "onPlayPage",
    "running",
    "visible",
    "usable",
  ] as const)
    assert.equal(canTick({ ...ok, [key]: false }), false, key);
  assert.equal(canTick({ ...ok, telemetrySession: "b" }), false);
  assert.equal(canTick({ ...ok, telemetrySession: null }), false);
  assert.equal(
    canTick({ ...ok, boundSession: null, telemetrySession: null }),
    false,
  );
});

test("growth pace is tunable and clamped; stats record what happened", () => {
  const time = (pace: number) => {
    let s = initialGarden();
    let t = 0;
    while (s.growth < 1 && t < 2000) {
      s = stepGarden(s, 1 / 60, 1, pace);
      t += 1 / 60;
    }
    return { t, s };
  };
  assert.ok(Math.abs(time(45).t - 45) < 0.1);
  assert.ok(Math.abs(time(180).t - 180) < 0.1);
  assert.ok(
    Math.abs(time(5).t - 30) < 0.1,
    "pace below the minimum clamps to 30 s",
  );
  assert.ok(
    Math.abs(time(NaN).t - 90) < 0.1,
    "invalid pace falls back to default",
  );
  const { s } = time(90);
  const [growing, blooming, full] = s.stats.reached;
  assert.ok(Math.abs(growing! - 0.33 * 90) < 0.1);
  assert.ok(Math.abs(blooming! - 0.67 * 90) < 0.1);
  assert.ok(Math.abs(full! - 90) < 0.1);
  assert.ok(Math.abs(s.stats.above - s.active) < 1e-6);
  assert.ok(Math.abs(s.stats.driveSum - 90) < 0.1);
  // Below baseline: time is counted, nothing above, no drive.
  const low = run(initialGarden(), 20, 0.3);
  assert.equal(low.stats.above, 0);
  assert.equal(low.stats.driveSum, 0);
  assert.ok(Math.abs(low.stats.scoreSum / low.active - 0.3) < 1e-6);
});

test("pace insight projects bloom time and suggests a pace for a target length", () => {
  assert.equal(
    paceInsight([{ active: 10, driveSum: 5 }], 90, 5),
    null,
    "needs data",
  );
  // Typical player: average drive 0.25 per active second.
  const i = paceInsight(
    [
      { active: 200, driveSum: 50 },
      { active: 200, driveSum: 50 },
    ],
    90,
    5,
  )!;
  assert.ok(Math.abs(i.driveRate - 0.25) < 1e-9);
  assert.ok(Math.abs(i.bloomMinutes - 6) < 1e-9, "90 s / 0.25 = 360 s");
  assert.equal(i.suggested, 75, "5 min × 60 × 0.25");
  const never = paceInsight([{ active: 120, driveSum: 0 }], 90, 5)!;
  assert.equal(never.bloomMinutes, Infinity);
  assert.equal(never.suggested, 30, "clamped to the minimum pace");
});

test("breath clock: 4 s in, 6 s out, smooth and periodic", () => {
  assert.equal(BREATH_CYCLE, 10);
  assert.equal(breathAt(0).phase, "in");
  assert.ok(breathAt(0).level < 1e-9);
  assert.ok(Math.abs(breathAt(4).level - 1) < 1e-9);
  assert.equal(breathAt(4).phase, "out");
  assert.ok(Math.abs(breathAt(2).level - 0.5) < 1e-9);
  assert.ok(Math.abs(breathAt(7).level - 0.5) < 1e-9);
  assert.ok(Math.abs(breathAt(3).remaining - 1) < 1e-9);
  assert.deepEqual(breathAt(23.5), breathAt(3.5));
  assert.deepEqual(breathAt(-6.5), breathAt(3.5));
  for (let t = 0; t < 10; t += 0.01)
    assert.ok(
      Math.abs(breathAt(t + 0.01).level - breathAt(t).level) < 0.01,
      "no jumps",
    );
});

test("stored preferences are validated and the log exports as CSV", async () => {
  const { sanitizePrefs, DEFAULT_PREFS, logToCsv } =
    await import("../apps/web/src/gardenPrefs.ts");
  assert.deepEqual(sanitizePrefs(null), DEFAULT_PREFS);
  const p = sanitizePrefs({
    sound: "yes",
    volume: 7,
    pace: 5,
    guide: false,
    targetMinutes: NaN,
  });
  assert.equal(p.sound, false);
  assert.equal(p.volume, 1);
  assert.equal(p.pace, 30);
  assert.equal(p.guide, false);
  assert.equal(p.targetMinutes, DEFAULT_PREFS.targetMinutes);
  const csv = logToCsv([
    {
      id: "a",
      startedAt: "2026-10-14T18:00:00.000Z",
      source: "replay",
      pace: 90,
      active: 200,
      above: 50,
      scoreSum: 110,
      driveSum: 40,
      growth: 0.444,
      reached: [70, null, null],
      note: 'P3, "eyes open"',
    },
  ]);
  const [header, row] = csv.trim().split("\n");
  assert.ok(header.startsWith("plant,started_at,source,pace_s"));
  assert.ok(row.includes(",replay,90,200.0,25.0,0.550,0.200,44.4,70.0,,,"));
  assert.ok(row.endsWith('"P3, ""eyes open"""'));
});
