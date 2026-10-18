import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePreflight,
  framesPerCycle,
  cycleLuminance,
  luminanceAt,
  intervalFails,
  estimateClock,
  TIMING,
} from "../apps/web/src/experiments/timing.ts";
import {
  buildBlock,
  bilateralAt,
  phasesOf,
  expectedSideChanges,
  shuffle,
} from "../apps/web/src/experiments/protocol.ts";

const steady = (hz: number, seconds = 5.2, jitter = 0.05) =>
  Array.from(
    { length: Math.round(seconds * hz) },
    (_, i) => 1000 / hz + jitter * Math.sin(i),
  );

test("preflight accepts steady 60 and 120 Hz and picks the profile", () => {
  const p60 = analyzePreflight(steady(60));
  assert.equal(p60.passed, true, p60.reasons.join());
  assert.equal(p60.profile_hz, 60);
  const p120 = analyzePreflight(steady(120));
  assert.equal(p120.passed, true);
  assert.equal(p120.profile_hz, 120);
});

test("preflight blocks wrong or variable refresh, late frames and short checks", () => {
  for (const hz of [75, 90, 144, 59]) {
    const p = analyzePreflight(steady(hz));
    assert.equal(p.passed, false, `${hz} Hz must fail`);
    assert.equal(p.profile_hz, null);
  }
  const dropped = steady(60);
  for (let i = 0; i < 5; i++) dropped[20 + i * 50] = 33.4; // 5/312 ≈ 1.6% late
  const d = analyzePreflight(dropped);
  assert.equal(d.passed, false);
  assert.match(d.reasons.join(), /late/);
  const spike = steady(60);
  spike[100] = 60;
  assert.match(analyzePreflight(spike).reasons.join(), /3× median/);
  assert.equal(analyzePreflight(steady(60, 2)).passed, false);
  assert.equal(analyzePreflight([]).passed, false);
});

test("60 Hz schedule: 10/12/15 Hz are 6/5/4 frames and produce the intended cycles", () => {
  assert.deepEqual(framesPerCycle(60, [10, 12, 15]), [6, 5, 4]);
  assert.deepEqual(framesPerCycle(120, [10, 12, 15]), [12, 10, 8]);
  assert.equal(framesPerCycle(60, [10, 11, 15]), null);
  const cycles = [6, 5, 4].map((n) => cycleLuminance(n, 0.5, 0.4));
  // Over one second (60 frames) each card completes exactly its frequency in cycles.
  for (const [k, f] of [10, 12, 15].entries()) {
    let peaks = 0;
    for (let frame = 0; frame < 60; frame++)
      if (frame % cycles[k].length === 0) peaks++;
    assert.equal(peaks, f);
  }
  const lum = luminanceAt(cycles, 7);
  assert.deepEqual(lum, [cycles[0][1], cycles[1][2], cycles[2][3]]);
  for (const c of cycles)
    for (const v of c) assert.ok(v >= 0.1 - 1e-9 && v <= 0.9 + 1e-9);
  // A 5-frame sinusoid is not symmetric like a square wave.
  assert.notDeepEqual(
    cycles[1].map((v) => v > 0.5),
    [true, true, false, false, false].reverse(),
  );
  // Mean luminance over a whole cycle equals the configured mean.
  for (const c of cycles)
    assert.ok(Math.abs(c.reduce((a, b) => a + b) / c.length - 0.5) < 1e-9);
});

test("a dropped frame during a trial fails the interval check", () => {
  assert.equal(intervalFails(16.7, 16.67), false);
  assert.equal(intervalFails(24.9, 16.67), false);
  assert.equal(intervalFails(25.1, 16.67), true);
  assert.equal(intervalFails(33.4, 16.67), true);
  assert.equal(TIMING.TRIAL_LONG_FACTOR, 1.5);
});

test("clock offset uses the lowest round-trip sample", () => {
  const c = estimateClock([
    { t0: 0, t1: 30, server: 1015 + 5 },
    { t0: 100, t1: 102, server: 1101 },
    { t0: 200, t1: 260, server: 1240 },
  ])!;
  assert.equal(c.rtt_ms, 2);
  assert.equal(c.offset_ms, 1000);
  assert.equal(estimateClock([]), null);
});

test("blocks: counts, saved seed reproducibility, breaks, and no cross-block leakage", () => {
  const s = buildBlock("setup", 42);
  assert.equal(s.trials.length, 25);
  assert.equal(s.trials.filter((t) => t.requested === "neutral").length, 10);
  for (const k of [0, 1, 2])
    assert.equal(s.trials.filter((t) => t.requested === k).length, 5);
  assert.deepEqual(
    s.runs.map((r) => r.length),
    [10, 10, 5],
  );
  assert.deepEqual(buildBlock("setup", 42).trials, s.trials);
  assert.notDeepEqual(
    buildBlock("setup", 43).trials.map((t) => t.requested),
    s.trials.map((t) => t.requested),
  );
  const e = buildBlock("evaluation", 42);
  assert.equal(e.trials.length, 40);
  assert.equal(e.runs.length, 4);
  const ids = new Set(s.trials.map((t) => t.id));
  assert.ok(e.trials.every((t) => !ids.has(t.id)));
  assert.equal(new Set(shuffle([1, 2, 3, 4, 5], 9)).size, 5);
});

test("bilateral: side-change units, phases and completion", () => {
  const s = {
    interval_ms: 1000,
    fixation_pre_s: 20,
    alternating_s: 30,
    fixation_post_s: 20,
    instruction: "follow" as const,
  };
  assert.deepEqual(
    phasesOf(s).map((p) => [p.start, p.end]),
    [
      [0, 20000],
      [20000, 50000],
      [50000, 70000],
    ],
  );
  assert.equal(bilateralAt(s, 10000).phase, "fixation_pre");
  assert.equal(bilateralAt(s, 10000).side, null);
  // At 1000 ms: left→right takes 1 s; left→right→left takes 2 s.
  assert.equal(bilateralAt(s, 20000).side, "left");
  assert.equal(bilateralAt(s, 20999).side, "left");
  assert.equal(bilateralAt(s, 21000).side, "right");
  assert.equal(bilateralAt(s, 22000).side, "left");
  assert.equal(bilateralAt(s, 22000).changeIndex, 2);
  assert.equal(bilateralAt(s, 50000).phase, "fixation_post");
  assert.equal(bilateralAt(s, 70000).done, true);
  assert.equal(expectedSideChanges(s), 30);
  assert.equal(expectedSideChanges({ ...s, interval_ms: 700 }), 43);
  const fast = { ...s, interval_ms: 500 };
  assert.equal(bilateralAt(fast, 20500).side, "right");
});

test("chooser catalog: four experiences, experiments bypass the alpha baseline", async () => {
  const { GAMES, isExperiment } =
    await import("../apps/web/src/games/catalog.ts");
  assert.deepEqual(
    GAMES.map((g) => g.id),
    ["garden", "balance", "bilateral", "ssvep"],
  );
  for (const g of GAMES) {
    assert.equal(
      g.requires,
      isExperiment(g.id) ? "raw-eeg" : "calibrated-score",
    );
    if (isExperiment(g.id)) assert.equal(g.cta, "Open setup");
  }
});
