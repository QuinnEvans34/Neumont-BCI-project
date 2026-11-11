import test from "node:test";
import assert from "node:assert/strict";
import { circleOn, observedFrequency } from "../apps/web/src/experiments/circle.ts";

test("circle alternates full on/off cycles at every slider frequency on 60/120 Hz displays", () => {
  for (const refresh of [60, 120]) {
    for (let hz = 1; hz <= 30; hz += 0.5) {
      const states = Array.from({ length: refresh * 2 }, (_, i) => circleOn(i, hz, refresh));
      const rises = states.filter((on, i) => on && (i === 0 || !states[i - 1])).length;
      assert.equal(rises, hz * 2, `${hz} Hz at ${refresh} Hz refresh`);
      assert.ok(states.some((s) => !s), "The off part must be present");
      // Sampling fractional periods can shift duty cycle by up to one frame per cycle.
      assert.ok(Math.abs(states.filter(Boolean).length / states.length - 0.5) <= hz / refresh / 2 + 1e-9);
    }
    const states = Array.from({ length: refresh }, (_, i) => circleOn(i, 10, refresh));
    assert.equal(states.filter(Boolean).length, refresh / 2);
  }
});

test("observed rate uses actual callback timestamps and needs two onsets", () => {
  assert.equal(observedFrequency([]), null);
  assert.equal(observedFrequency([100]), null);
  assert.equal(observedFrequency([100, 200, 300, 400]), 10);
  assert.equal(observedFrequency([0, 100, 220]), 1000 / 110);
});
