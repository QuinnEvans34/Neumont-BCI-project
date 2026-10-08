import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, step } from '../apps/web/src/simulation.ts';
import { parseFrame, isUsable } from '../apps/web/src/input.ts';
test('strong assistance completes a round, while weak assistance can lose', () => {
  let strong = initialState(); let weak = initialState();
  for (let i = 0; i < 7300; i++) {
    strong = step(strong, 1 / 120, 1);
    weak = step(weak, 1 / 120, 0);
  }
  assert.equal(strong.done, true); assert.equal(strong.fell, false);
  assert.equal(strong.elapsed, 60);
  assert.equal(weak.fell, true); assert.ok(weak.elapsed < 60);
  assert.ok(weak.centered >= 0 && weak.centered <= weak.elapsed);
  assert.deepEqual(step(weak, 1 / 120, 1), weak);
});
test('ball leaves either edge without bouncing and restarting clears the loss', () => {
  for (const direction of [-1, 1]) {
    const nearEdge = {...initialState(), x: direction * .999, velocity: direction * 1};
    const lost = step(nearEdge, 1 / 120, 0);
    assert.equal(lost.done, true); assert.equal(lost.fell, true);
    assert.ok(Math.abs(lost.x) > 1);
    assert.equal(Math.sign(lost.velocity), direction);
    assert.deepEqual(step(lost, 1 / 120, 1), lost);
  }
  assert.equal(initialState().fell, false);
  assert.equal(initialState().elapsed, 0);
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
