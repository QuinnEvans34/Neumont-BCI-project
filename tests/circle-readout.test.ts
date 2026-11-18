import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CircleFrequencyReadout from "../apps/web/src/experiments/CircleFrequencyReadout.tsx";
import type { CircleMetrics } from "../apps/web/src/experiments/types.ts";

const electrodes = ["Fp1", "Fp2", "C3", "C4", "P3", "O1", "Oz", "O2"];
const metrics: CircleMetrics = {
  window: [0, 500], discontinuous: false, total_alpha_uv2: 10, valid_channels: 8,
  channels: electrodes.map((name, i) => ({ name, valid: true, reason: null, dominant_hz: i === 5 ? 12.5 : 6 })),
};
const render = (props: Partial<Parameters<typeof CircleFrequencyReadout>[0]> = {}) =>
  renderToStaticMarkup(createElement(CircleFrequencyReadout, {
    electrodes, metrics, state: "live", observedHz: 10, source: "live", ...props,
  }));

test("brain comparison uses the posterior channel's EEG peak and measured flash timing", () => {
  const html = render();
  assert.match(html, /CH6 · O1/);
  assert.match(html, /12.5 <span>Hz/);
  assert.match(html, /10.0 <span>Hz/);
  assert.match(html, /\+2.5 <span>Hz/);
  assert.match(html, /updating every 0.5 s/);
  assert.equal((html.match(/<option /g) ?? []).length, 8);
  assert.match(render({ observedHz: 15 }), /-2.5 <span>Hz/);
  assert.match(render({ observedHz: 12.5 }), /<strong>0.0 <span>Hz/);
});

test("rejected and discontinuous EEG cannot produce a frequency difference", () => {
  for (const invalid of [
    { ...metrics, channels: metrics.channels.map(c => ({ ...c, valid: false, reason: "Flat signal" })) },
    { ...metrics, discontinuous: true },
    { ...metrics, channels: metrics.channels.map(c => ({ ...c, dominant_hz: NaN })) },
  ]) {
    const html = render({ metrics: invalid });
    assert.doesNotMatch(html, /12.5 <span>Hz|\+2.5 <span>Hz|NaN/);
    assert.match(html, /Signal rejected/);
    assert.match(html, /Needs valid EEG and live flash timing/);
  }
});

test("waiting and unavailable readings hide old numbers; stopped readings are explicitly historical", () => {
  for (const state of ["waiting", "unavailable"] as const) {
    const html = render({ state });
    assert.doesNotMatch(html, /12.5 <span>Hz|10.0 <span>Hz|\+2.5 <span>Hz/);
    assert.match(html, state === "waiting" ? /waiting for a complete 2 s/ : /Fresh EEG unavailable/);
  }
  const ended = render({ state: "last" });
  assert.match(ended, /Last recorded window · not live/);
  assert.match(ended, /12.5 <span>Hz/);
  assert.doesNotMatch(ended, /10.0 <span>Hz|\+2.5 <span>Hz/);
});

test("missing flash timing never falls back to the requested frequency; source mode stays clear", () => {
  for (const observedHz of [null, NaN, Infinity, 0]) {
    const html = render({ observedHz });
    assert.match(html, /12.5 <span>Hz/);
    assert.match(html, /Waiting for live flash timing/);
    assert.doesNotMatch(html, /\+2.5 <span>Hz|NaN|Infinity/);
  }
  assert.match(render({ source: "simulated" }), /Simulated EEG · updating/);
  assert.match(render({ source: "replay" }), /Recorded EEG replay · updating/);
  assert.match(render({ electrodes: Array(8).fill("") }), /CH1 · Unmapped/);
});
