// Research instrumentation for Cairn. Called from inside the Phaser update loop
// with the model state before and after each bounded step, so every transition
// (a step may hold several 120 Hz substeps) is logged once, at the step that
// produced it. This module only observes: it never changes physics or scoring.

import {
  dropSway,
  fallAngle,
  gustLoad,
  tierOf,
  STEADY_SWAY,
  UNSTEADY_SWAY,
  FALL_ANGLE,
  TIER_STONES,
  TIER_FACTOR,
  GUST_THRESHOLD,
  CALM_INTERVAL,
  GO_INTERVAL,
  EVENT_FIRST,
  EVENT_FULL_STONES,
  type CairnEvent,
  type CairnState,
} from "../cairnSimulation";
import { browserNow, uuid, type InputRef } from "./logger";

/** The part of the research logger the traces use (a fake in tests). */
export interface TraceSink {
  readonly active: boolean;
  input: InputRef;
  event(
    type: string,
    f?: {
      game?: string;
      round_id?: string | null;
      active_s?: number | null;
      reason?: string | null;
      payload?: Record<string, unknown>;
      t?: number;
    },
  ): string | null;
  state(row: Record<string, unknown>, kind?: "snapshot" | "transition" | "start" | "stop"): void;
  stateDue(game: string, now?: number): boolean;
}

export type CairnContext = {
  source: string;
  score: number | null;
  usable: boolean;
  running: boolean;
  blocker: string | null;
  flickerRequested: boolean;
  flickerEffective: boolean;
};

export type CairnConfig = {
  mode: CairnState["mode"];
  seed: number;
  flicker: boolean;
  reducedMotion: boolean;
  timeScale: number;
};

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Model constants written with every round so a later reader knows the rules in force. */
export const CAIRN_RULES = {
  fall_angle_rad: FALL_ANGLE,
  steady_sway_rad: STEADY_SWAY,
  unsteady_sway_rad: UNSTEADY_SWAY,
  tier_stones: TIER_STONES,
  tier_factor: TIER_FACTOR,
  gust_threshold: GUST_THRESHOLD,
  calm_interval_s: CALM_INTERVAL,
  go_interval_s: GO_INTERVAL,
  event_first_s: EVENT_FIRST,
  event_full_stones: EVENT_FULL_STONES,
  substep_hz: 120,
};

export class CairnTrace {
  roundId: string | null = null;
  /** The controls.reset value this round was created for. */
  resetId: number | null = null;
  started = false;
  ended = false;
  paused = false;
  config: CairnConfig | null = null;
  last: CairnState | null = null;
  ctx: CairnContext = {
    source: "unknown",
    score: null,
    usable: false,
    running: false,
    blocker: null,
    flickerRequested: false,
    flickerEffective: false,
  };
  private effects = new Map<number, string>();
  private forced = new Set<number>();
  private flicker: { id: string; start: number; effect: string | null } | null = null;
  private placedAt = 0;

  constructor(private sink: TraceSink) {}

  private emit(type: string, t: number, reason: string | null, payload: Record<string, unknown>, s = this.last) {
    return this.sink.event(type, {
      game: "cairn",
      round_id: this.roundId,
      active_s: s ? r6(s.elapsed) : null,
      reason,
      payload,
      t,
    });
  }

  effectId(e: CairnEvent) {
    let id = this.effects.get(e.index);
    if (!id) {
      id = `${this.roundId ?? "round"}:effect-${e.index}`;
      this.effects.set(e.index, id);
    }
    return id;
  }

  /** A fresh cairn replaces the old one; an unfinished started round ends with `reason`. */
  newRound(sim: CairnState, config: CairnConfig, reason: string, t = browserNow(), resetId: number | null = null) {
    if (this.started && !this.ended) this.end(reason, t);
    this.resetId = resetId;
    this.roundId = uuid();
    this.started = false;
    this.ended = false;
    this.paused = false;
    this.config = config;
    this.last = sim;
    this.effects.clear();
    this.forced.clear();
    this.placedAt = 0;
  }

  /** The first running step of a round, or a recording opening mid-round (partial). */
  begin(t = browserNow(), partial = false) {
    if (!this.roundId || !this.last || (this.started && !partial)) return;
    this.started = true;
    const s = this.last;
    this.emit("round_started", t, partial ? "recording_started_mid_round" : null, {
      mode: s.mode,
      seed: s.seed,
      partial_start: partial,
      stones_at_start: s.stones,
      flicker_requested: this.config?.flicker ?? false,
      reduced_motion: this.config?.reducedMotion ?? false,
      time_scale: this.config?.timeScale ?? 1,
      next_event_at_s: r6(s.nextEvent),
      rules: CAIRN_RULES,
      note: "Decorative randomness (particles, bug wobble) is not seeded; pixel-exact replay is not promised.",
    });
    if (partial) {
      if (s.event) this.effectStarted(s.event, t, true);
      if (this.paused) this.emit("round_paused", t, this.ctx.blocker, { partial_start: true });
    }
    this.snapshot(s, "start");
  }

  /** An externally forced (preview/debug) effect; logged with its parameters. */
  forcedEffect(index: number) {
    this.forced.add(index);
  }

  private effectStarted(e: CairnEvent, t: number, partial = false) {
    this.emit(`${e.kind}_started`, t, null, {
      effect_id: this.effectId(e),
      index: e.index,
      kind: e.kind,
      strength: r6(e.strength),
      direction: e.direction,
      path: e.kind === "bug" ? e.path : null,
      duration_s: r6(e.duration),
      elapsed_in_effect_s: r6(e.time),
      forced: this.forced.has(e.index),
      partial_start: partial,
      flashing: e.kind === "bug" ? this.ctx.flickerEffective : false,
    });
  }

  private effectEnded(e: CairnEvent, t: number, reason: string) {
    this.emit(`${e.kind}_ended`, t, reason, {
      effect_id: this.effectId(e),
      index: e.index,
      kind: e.kind,
      strength: r6(e.strength),
      direction: e.direction,
      path: e.kind === "bug" ? e.path : null,
      planned_duration_s: r6(e.duration),
      ran_s: r6(e.time),
      completed: reason === "completed",
    });
  }

  /** Compare one bounded model step. `t` is the browser time that step represents. */
  step(prev: CairnState, next: CairnState, t: number) {
    this.last = next;
    if (!this.started) this.begin(t);
    const pe = prev.event;
    const ne = next.event;
    if (pe && (!ne || ne.index !== pe.index)) this.effectEnded(pe, t, "completed");
    if (ne && (!pe || ne.index !== pe.index)) this.effectStarted(ne, t);
    if (prev.phase !== "release" && next.phase === "release") {
      const gust = gustLoad(next);
      this.emit("stone_released", t, null, {
        stone_index: prev.stones,
        mode: next.mode,
        sway_rad: r6(next.sway),
        drop_sway_threshold_rad: r6(dropSway(prev.stones, gust)),
        steady_sway_rad: STEADY_SWAY,
        gust_load: r6(gust),
      });
    }
    if (next.stones > prev.stones) {
      this.placedAt = next.elapsed;
      this.emit("stone_placed", t, null, {
        stones: next.stones,
        stone_index: next.stones - 1,
        angle_rad: r6(next.angle),
        sway_rad: r6(next.sway),
        fall_angle_rad: r6(fallAngle(next.stones, gustLoad(next))),
      });
      if (tierOf(next.stones) !== tierOf(prev.stones))
        this.emit("level_changed", t, null, {
          old_tier: tierOf(prev.stones),
          new_tier: tierOf(next.stones),
          stones: next.stones,
          fall_angle_rad: r6(fallAngle(next.stones)),
          drop_sway_rad: r6(dropSway(next.stones)),
        });
    }
    if (next.fallen && !prev.fallen) this.fell(next, t);
  }

  private fell(s: CairnState, t: number) {
    const gust = gustLoad(s);
    const sway = s.cause === "sway";
    if (s.event) this.effectEnded(s.event, t, "cairn_fell");
    this.emit("cairn_fell", t, sway ? "sway_exceeded_threshold" : "stone_landed_while_sway_exceeded_drop_threshold", {
      cause: s.cause,
      explanation: sway
        ? "Tilt exceeded the topple threshold."
        : "A stone landed while sway exceeded the drop threshold.",
      stones: s.stones,
      tier: tierOf(s.stones),
      angle_rad: r6(s.angle),
      velocity_rad_s: r6(s.velocity),
      sway_rad: r6(s.sway),
      fall_angle_threshold_rad: r6(fallAngle(s.stones, gust)),
      drop_sway_threshold_rad: r6(dropSway(s.stones, gust)),
      gust_load: r6(gust),
      focus: r6(s.focus),
      unrest: r6(s.unrest),
      active_effect: s.event ? { effect_id: this.effectId(s.event), kind: s.event.kind } : null,
      seconds_since_last_stone: r6(s.elapsed - this.placedAt),
      trigger_input: { ...this.sink.input },
      note: "Game mechanics only. Temporal overlap with signal changes is not evidence of a cause.",
    }, s);
    this.snapshot(s, "transition");
    this.end(sway ? "fell_sway" : "fell_drop", t);
  }

  /** End the round once (fall, reset, mode change, session change...). */
  end(outcome: string, t = browserNow()) {
    if (!this.started || this.ended || !this.roundId) return;
    const s = this.last;
    if (s?.event && !s.fallen) this.effectEnded(s.event, t, outcome);
    if (this.flicker) this.flickerEnded(t, "round_ended");
    this.ended = true;
    this.emit("round_ended", t, outcome, {
      summary: s
        ? {
            mode: s.mode,
            seed: s.seed,
            stones: s.stones,
            tier: tierOf(s.stones),
            active_s: r6(s.elapsed),
            steady_s: r6(s.steadyTime),
            effects: s.events,
            fallen: s.fallen,
            cause: s.cause,
          }
        : {},
    });
  }

  pause(reason: string | null, t = browserNow()) {
    if (!this.started || this.ended || this.paused) return;
    this.paused = true;
    this.emit("round_paused", t, reason ?? "paused", {});
    if (this.last) this.snapshot(this.last, "transition");
  }

  resume(t = browserNow()) {
    if (!this.started || this.ended || !this.paused) return;
    this.paused = false;
    this.emit("round_resumed", t, null, {});
  }

  flickerStarted(t: number, e: CairnEvent) {
    if (this.flicker) return;
    const id = uuid();
    this.flicker = { id, start: t, effect: this.roundId ? this.effectId(e) : null };
    this.emit("flicker_started", t, null, {
      flicker_id: id,
      effect_id: this.flicker.effect,
      hz: 15,
      strength: r6(e.strength),
      path: e.path,
      note: "Software frame timing; optical onset not verified.",
    });
  }

  flickerEnded(t: number, reason: string) {
    const f = this.flicker;
    if (!f) return;
    this.flicker = null;
    this.emit("flicker_ended", t, reason, {
      flicker_id: f.id,
      effect_id: f.effect,
      duration_ms: Math.round((t - f.start) * 1000) / 1000,
    });
  }

  /** ≈20 Hz state row (or a forced transition row). */
  snapshot(s: CairnState, kind: "snapshot" | "transition" | "start" | "stop" = "snapshot") {
    if (!this.sink.active || !this.roundId) return;
    const gust = gustLoad(s);
    const e = s.event;
    const c = this.ctx;
    this.sink.state(
      {
        game: "cairn",
        round_id: this.roundId,
        active_s: r6(s.elapsed),
        mode: s.mode,
        running: c.running,
        visible: typeof document === "undefined" || document.visibilityState === "visible",
        source: c.source,
        score: c.score,
        usable: c.usable,
        reason: c.blocker,
        cairn_seed: s.seed,
        cairn_stones: s.stones,
        cairn_tier: tierOf(s.stones),
        cairn_angle_rad: r6(s.angle),
        cairn_velocity_rad_s: r6(s.velocity),
        cairn_sway_rad: r6(s.sway),
        cairn_fall_angle_rad: r6(fallAngle(s.stones, gust)),
        cairn_drop_sway_rad: r6(dropSway(s.stones, gust)),
        cairn_focus: r6(s.focus),
        cairn_unrest: r6(s.unrest),
        cairn_hand_phase: s.phase,
        cairn_hand_progress: r6(s.approach),
        cairn_event_id: e ? this.effectId(e) : null,
        cairn_event_kind: e?.kind ?? null,
        cairn_event_strength: e ? r6(e.strength) : null,
        cairn_event_direction: e?.direction ?? null,
        cairn_event_path: e?.kind === "bug" ? e.path : null,
        cairn_event_progress: e ? r6(e.time / e.duration) : null,
        cairn_gust_load: r6(gust),
        cairn_flicker_requested: c.flickerRequested,
        cairn_flicker_effective: c.flickerEffective,
        cairn_fallen: s.fallen,
        cairn_cause: s.cause,
      },
      kind,
    );
  }

  /** Recording opened in this tab: describe a round already under way. */
  onRecordingBegin() {
    if (this.started && !this.ended) this.begin(browserNow(), true);
  }
}
