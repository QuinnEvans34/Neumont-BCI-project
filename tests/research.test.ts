import test from "node:test";
import assert from "node:assert/strict";
import { initialCairn, stepCairn, startEvent, type CairnState } from "../apps/web/src/cairnSimulation.ts";
import { initialGarden, stepGarden } from "../apps/web/src/gardenSimulation.ts";
import { CairnTrace, type TraceSink } from "../apps/web/src/research/cairnTrace.ts";
import { GardenTrace } from "../apps/web/src/research/gardenTrace.ts";
import { tickBlocker } from "../apps/web/src/games/lifecycle.ts";
import { research } from "../apps/web/src/research/logger.ts";

type Ev = { type: string; reason: string | null; payload: Record<string, unknown>; round_id: string | null; t: number };

function sink() {
  const events: Ev[] = [];
  const states: Record<string, unknown>[] = [];
  const s: TraceSink & { events: Ev[]; states: typeof states } = {
    active: true,
    input: { acquisition_id: "acq", sequence: 7 },
    events,
    states,
    event(type, f = {}) {
      events.push({ type, reason: f.reason ?? null, payload: f.payload ?? {}, round_id: f.round_id ?? null, t: f.t ?? 0 });
      return String(events.length);
    },
    state(row) {
      states.push(row);
    },
    stateDue() {
      return true;
    },
  };
  return s;
}
const count = (evs: Ev[], type: string) => evs.filter((e) => e.type === type).length;

/** Drive a Cairn round the way CairnStage does: ≤0.05 s chunks, trace after each. */
function play(trace: CairnTrace, s: CairnState, seconds: number, score: (t: number) => number) {
  let t = 0;
  while (t < seconds && !s.fallen) {
    const prev = s;
    s = stepCairn(s, 0.05, score(t));
    t += 0.05;
    trace.step(prev, s, t * 1000);
  }
  return s;
}

test("cairn trace logs every stone, level and effect exactly once", () => {
  const k = sink();
  const trace = new CairnTrace(k);
  let s = initialCairn("calm", 1234);
  trace.newRound(s, { mode: "calm", seed: 1234, flicker: false, reducedMotion: false, timeScale: 1 }, "reset", 0);
  s = play(trace, s, 200, () => 0.95);
  assert.equal(count(k.events, "round_started"), 1);
  assert.equal(count(k.events, "stone_placed"), s.stones);
  assert.equal(count(k.events, "stone_released"), s.stones + (s.fallen && s.cause === "drop" ? 1 : 0));
  assert.equal(count(k.events, "level_changed"), Math.floor(s.stones / 5));
  const started = k.events.filter((e) => e.type.endsWith("_started") && /bug|gust/.test(e.type));
  const ended = k.events.filter((e) => /^(bug|gust)_ended$/.test(e.type));
  assert.equal(started.length, s.events);
  assert.ok(ended.length >= started.length - 1 && ended.length <= started.length);
  for (const e of started) assert.ok(String(e.payload.effect_id).includes(":effect-"));
  // Same round id on every event.
  assert.equal(new Set(k.events.map((e) => e.round_id)).size, 1);
});

test("cairn fall is logged with thresholds and ends the round once", () => {
  const k = sink();
  const trace = new CairnTrace(k);
  let s = initialCairn("go", 99);
  trace.newRound(s, { mode: "go", seed: 99, flicker: false, reducedMotion: false, timeScale: 1 }, "reset", 0);
  s = play(trace, s, 600, () => 0);
  assert.ok(s.fallen, "a zero score topples the cairn");
  const fell = k.events.filter((e) => e.type === "cairn_fell");
  assert.equal(fell.length, 1);
  assert.ok(typeof fell[0].payload.fall_angle_threshold_rad === "number");
  assert.ok(typeof fell[0].payload.drop_sway_threshold_rad === "number");
  assert.deepEqual(fell[0].payload.trigger_input, { acquisition_id: "acq", sequence: 7 });
  const ended = k.events.filter((e) => e.type === "round_ended");
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, s.cause === "sway" ? "fell_sway" : "fell_drop");
  // A later reset does not end it again; the next round gets a new id.
  const old = trace.roundId;
  trace.newRound(initialCairn("go", 5), { mode: "go", seed: 5, flicker: false, reducedMotion: false, timeScale: 1 }, "reset", 1);
  assert.equal(count(k.events, "round_ended"), 1);
  assert.notEqual(trace.roundId, old);
});

test("cairn reset mid-round ends the round and its effect with the reason", () => {
  const k = sink();
  const trace = new CairnTrace(k);
  let s = initialCairn("calm", 7);
  trace.newRound(s, { mode: "calm", seed: 7, flicker: false, reducedMotion: false, timeScale: 1 }, "reset", 0);
  s = play(trace, s, 1, () => 0.9);
  trace.forcedEffect(s.events);
  const prev = s;
  s = startEvent(s, "gust", 0.5, 1, "ground");
  trace.step(prev, s, 2000);
  assert.equal(k.events.at(-1)!.payload.forced, true);
  trace.pause("paused_by_user", 2100);
  trace.pause("paused_by_user", 2200); // idempotent (StrictMode double effect)
  trace.resume(2300);
  trace.newRound(initialCairn("go", 8), { mode: "go", seed: 8, flicker: false, reducedMotion: false, timeScale: 1 }, "mode_change", 3000);
  assert.equal(count(k.events, "round_paused"), 1);
  assert.equal(count(k.events, "round_resumed"), 1);
  assert.equal(k.events.find((e) => e.type === "gust_ended")?.reason, "mode_change");
  assert.equal(k.events.find((e) => e.type === "round_ended")?.reason, "mode_change");
});

test("cairn round already running when recording starts is a partial start", () => {
  const k = sink();
  const trace = new CairnTrace(k);
  let s = initialCairn("calm", 3);
  trace.newRound(s, { mode: "calm", seed: 3, flicker: false, reducedMotion: false, timeScale: 1 }, "reset", 0);
  s = play(trace, s, 2, () => 0.9);
  k.events.length = 0;
  trace.onRecordingBegin();
  assert.equal(k.events[0].type, "round_started");
  assert.equal(k.events[0].payload.partial_start, true);
});

const SETTLE = { seconds: 34, steps: [{ at: 0, title: "a" }, { at: 7, title: "b" }, { at: 14, title: "c" }] };

test("garden: settle-in, plant, stages and full bloom are each logged once", () => {
  const k = sink();
  const g = new GardenTrace(k, SETTLE);
  g.settleStarted(0);
  for (let t = 0; t <= 34; t += 0.5) g.settleProgress(t, t * 1000);
  assert.equal(count(k.events, "settle_phase_changed"), 3);
  g.settleEnded("completed", "completed", 34000);
  g.reset("new_plant", 34000); // the start of the plant clears the model, but keeps this round
  assert.equal(count(k.events, "round_ended"), 0);
  g.observe(initialGarden());
  g.plantStart(34000);
  g.ctx = { ...g.ctx, live: true, score: 1, usable: true, pace: 30 };
  let s = initialGarden();
  for (let i = 0; i < 400; i++) {
    const n = stepGarden(s, 0.1, 1, 30);
    g.step(s, n, i);
    g.gate(i);
    s = n;
  }
  assert.equal(count(k.events, "round_started"), 1);
  assert.equal(count(k.events, "plant_started"), 1);
  assert.equal(count(k.events, "stage_changed"), 2);
  assert.equal(count(k.events, "full_bloom"), 1);
  assert.equal(count(k.events, "growth_started"), 1);
  assert.equal(k.events.find((e) => e.type === "growth_stopped")?.reason, "full_growth");
  g.reset("new_plant", 99);
  assert.equal(count(k.events, "plant_ended"), 1);
  const end = k.events.find((e) => e.type === "round_ended")!;
  assert.equal(end.reason, "new_plant");
  assert.equal((end.payload.summary as { full_bloom: boolean }).full_bloom, true);
  assert.equal(new Set(k.events.map((e) => e.round_id)).size, 1);
});

test("garden: growth stop reasons distinguish baseline, unusable input and pause", () => {
  const k = sink();
  const g = new GardenTrace(k, SETTLE);
  g.plantStart(0);
  g.ctx = { ...g.ctx, live: true, score: 0.8 };
  g.gate(1);
  g.ctx = { ...g.ctx, score: 0.4 };
  g.gate(2);
  g.ctx = { ...g.ctx, score: 0.9 };
  g.gate(3);
  g.ctx = { ...g.ctx, live: false, score: null, blocker: "input_unusable" };
  g.pause("input_unusable", 4);
  const stops = k.events.filter((e) => e.type === "growth_stopped").map((e) => e.reason);
  assert.deepEqual(stops, ["score_at_or_below_baseline", "input_unusable"]);
  assert.equal(count(k.events, "plant_paused"), 1);
});

test("garden: aborted settle-in is recorded as its own round", () => {
  const k = sink();
  const g = new GardenTrace(k, SETTLE);
  g.settleStarted(0);
  g.settleProgress(5, 5000);
  g.settleEnded("interrupted", "left_game", 5000);
  assert.equal(count(k.events, "settle_interrupted"), 1);
  assert.equal(k.events.find((e) => e.type === "round_ended")?.reason, "settle_aborted");
  assert.equal(g.open, false);
});

test("tick blocker names why a game cannot tick", () => {
  const base = { selected: true, onPlayPage: true, running: true, visible: true, usable: true, boundSession: "a", telemetrySession: "a" };
  assert.equal(tickBlocker(base), null);
  assert.equal(tickBlocker({ ...base, running: false }), "paused_by_user");
  assert.equal(tickBlocker({ ...base, usable: false }), "input_unusable");
  assert.equal(tickBlocker({ ...base, visible: false, running: false }), "tab_hidden");
  assert.equal(tickBlocker({ ...base, onPlayPage: false, running: false }), "left_game");
  assert.equal(tickBlocker({ ...base, telemetrySession: "b" }), "session_changed");
  assert.equal(tickBlocker({ ...base, boundSession: null }), "not_started");
});

test("logger keeps items until acknowledged and retries in order", async () => {
  const bodies: { items: { seq: number }[] }[] = [];
  let fail = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (fail) {
      fail = false;
      throw new Error("network down");
    }
    const ack = body.items.at(-1).seq;
    return new Response(JSON.stringify({ ack, state: "recording" }), { status: 200 });
  }) as typeof fetch;
  try {
    research.begin({ id: "r", token: "t" });
    research.event("marker", { reason: "one" });
    research.event("marker", { reason: "two" });
    await research.flush();
    assert.equal(research.status().queued, 2, "failed send keeps items");
    research.event("marker", { reason: "three" });
    await research.flush();
    assert.equal(research.status().queued, 0);
    assert.deepEqual(bodies[1].items.map((i) => i.seq), [1, 2, 3]);
    assert.equal(research.status().acked, 3);
  } finally {
    research.end();
    globalThis.fetch = realFetch;
  }
  assert.equal(research.event("marker"), null, "no-op when not recording");
});

test("cairn flicker stretches pair up and close when the round ends", () => {
  const k = sink();
  const trace = new CairnTrace(k);
  let s = initialCairn("calm", 11);
  trace.newRound(s, { mode: "calm", seed: 11, flicker: true, reducedMotion: false, timeScale: 1 }, "reset", 0);
  s = play(trace, s, 1, () => 0.9);
  const prev = s;
  s = startEvent(s, "bug", 0.4, -1, "air");
  trace.step(prev, s, 1500);
  trace.flickerStarted(1600, s.event!);
  trace.flickerStarted(1650, s.event!); // already blinking: ignored
  trace.flickerEnded(2600, "paused");
  trace.flickerStarted(3000, s.event!);
  trace.end("reset", 4000);
  const fl = k.events.filter((e) => e.type.startsWith("flicker_"));
  assert.deepEqual(fl.map((e) => [e.type, e.reason]), [
    ["flicker_started", null],
    ["flicker_ended", "paused"],
    ["flicker_started", null],
    ["flicker_ended", "round_ended"],
  ]);
  assert.equal(fl[1].payload.duration_ms, 1000);
  assert.equal(fl[0].payload.effect_id, k.events.find((e) => e.type === "bug_started")!.payload.effect_id);
  assert.equal(k.events.find((e) => e.type === "bug_ended")?.reason, "reset");
});

test("garden breath, audio and settings are logged only on change", () => {
  const k = sink();
  const g = new GardenTrace(k, SETTLE);
  g.plantStart(0);
  for (const p of ["in", "in", "out", "out", null, null, "in"] as const) g.breath(p, 1);
  assert.deepEqual(k.events.filter((e) => e.type === "breath_phase_changed").map((e) => e.payload.new_phase), ["in", "out", null, "in"]);
  g.audio(false, "blocked_or_suspended_by_browser", 2);
  g.audio(false, "blocked_or_suspended_by_browser", 3);
  g.audio(true, "playing", 4);
  assert.equal(count(k.events, "audio_effective_changed"), 2);
  g.setting("pace_changed", 90, 60);
  const pace = k.events.find((e) => e.type === "pace_changed")!;
  assert.deepEqual([pace.payload.old_value, pace.payload.new_value], [90, 60]);
  g.reset("new_plant", 5);
  const end = k.events.find((e) => e.type === "round_ended")!;
  assert.equal((end.payload.summary as { configuration_changes: number }).configuration_changes, 1);
});
