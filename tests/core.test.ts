import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, step } from '../apps/web/src/simulation.ts';
import { parseFrame, isUsable } from '../apps/web/src/input.ts';
test('simulation completes exactly one round and keeps the ball contained at input extremes', () => {
  for (const score of [0, 0.5, 1]) {
    let s = initialState();
    for (let i = 0; i < 7300; i++) { s = step(s, 1 / 120, score, 1); assert.ok(Math.abs(s.x) <= 0.95); }
    assert.equal(s.done, true); assert.equal(s.elapsed, 60);
    assert.ok(s.centered >= 0 && s.centered <= 60);
    assert.deepEqual(step(s, 1 / 120, score, 0), s);
  }
});
test('malformed or stale EEG cannot count as usable input', () => {
  const f = {version: 1, sequence: 0, timestamp_ms: 10, source: 'synthetic', score: 0.5, quality: 'good', calibrated: true};
  assert.ok(parseFrame(f));
  for (const score of [-1, 2, NaN]) assert.equal(parseFrame({...f, score}), null);
  assert.equal(parseFrame({...f, source: 'unknown'}), null);
  assert.equal(isUsable(parseFrame(f), 100, 2200), false);
  assert.equal(isUsable(parseFrame({...f, quality:'poor'}), 100, 200), false);
  assert.equal(isUsable(parseFrame({...f, calibrated:false}), 100, 200), false);
  assert.equal(isUsable(parseFrame(f), 100, 200), true);
});
