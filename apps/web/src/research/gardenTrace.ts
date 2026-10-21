// Research instrumentation for Glowing Garden. One round per plant. Growth
// transitions are taken from the model step itself (the actual drive and
// running gates), never from leaf animation. This module only observes.

import {
  drive,
  stageOf,
  MILESTONES,
  PACE_MIN,
  PACE_MAX,
  RESPONSE_TAU,
  type GardenState,
  type Relation,
} from "../gardenSimulation";
import { browserNow, uuid } from "./logger";
import type { TraceSink } from "./cairnTrace";

export type GardenContext = {
  source: string;
  score: number | null;
  usable: boolean;
  live: boolean;
  blocker: string | null;
  relation: Relation | null;
  pace: number;
  guide: boolean;
  sound: boolean;
  volume: number;
  reducedMotion: boolean;
  settleIn: boolean;
};

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export class GardenTrace {
  roundId: string | null = null;
  /** A round is open (settle-in under way or a plant exists). */
  open = false;
  plantStarted = false;
  settling = false;
  settleDone = false;
  settleElapsed = 0;
  paused = false;
  growing = false;
  breathPhase: string | null = null;
  audioEffective: boolean | null = null;
  audioReason: string | null = null;
  last: GardenState | null = null;
  ctx: GardenContext = {
    source: "unknown",
    score: null,
    usable: false,
    live: false,
    blocker: null,
    relation: null,
    pace: 90,
    guide: true,
    sound: false,
    volume: 0.6,
    reducedMotion: false,
    settleIn: true,
  };
  private settleStep = -1;
  private settleStartedAt = 0;
  private changes = 0;

  constructor(
    private sink: TraceSink,
    /** Settle-in script: total seconds and the start of each step (read from the runtime). */
    private settle: { seconds: number; steps: { at: number; title: string }[] },
  ) {}

  private emit(type: string, reason: string | null, payload: Record<string, unknown>, t = browserNow()) {
    return this.sink.event(type, {
      game: "garden",
      round_id: this.roundId,
      active_s: this.last ? r6(this.last.active) : null,
      reason,
      payload,
      t,
    });
  }

  private config() {
    const c = this.ctx;
    return {
      pace_s: c.pace,
      pace_bounds_s: [PACE_MIN, PACE_MAX],
      milestones: MILESTONES,
      response_tau_s: RESPONSE_TAU,
      settle_in: c.settleIn,
      settle_seconds: this.settle.seconds,
      breathing_guide: c.guide,
      sound: c.sound,
      volume: c.volume,
      reduced_motion: c.reducedMotion,
    };
  }

  /** Open a round for a new plant (with or without settle-in). */
  openRound(settleIn: boolean, t = browserNow(), partial = false) {
    if (!partial) {
      if (this.open) return;
      this.roundId = uuid();
      this.open = true;
      this.plantStarted = false;
      this.settling = false;
      this.settleDone = false;
      this.paused = false;
      this.growing = false;
      this.changes = 0;
      this.last = null;
    }
    this.emit("round_started", partial ? "recording_started_mid_round" : null, {
      mode: "garden",
      partial_start: partial,
      settle_in: settleIn,
      config: this.config(),
      growth_at_start: this.last ? r6(this.last.growth) : 0,
    }, t);
  }

  settleStarted(t = browserNow(), partial = false) {
    if (!this.open) this.openRound(true, t);
    this.settling = true;
    this.settleDone = false;
    this.settleStep = -1;
    this.settleStartedAt = t;
    if (!partial) this.settleElapsed = 0;
    this.emit("settle_started", partial ? "recording_started_mid_settle" : null, {
      seconds: this.settle.seconds,
      steps: this.settle.steps,
      partial_start: partial,
      elapsed_s: r6(this.settleElapsed),
    }, t);
  }

  /** Called each frame of the settle-in with its elapsed seconds. */
  settleProgress(elapsed: number, t = browserNow()) {
    if (!this.settling) return;
    this.settleElapsed = elapsed;
    let i = -1;
    this.settle.steps.forEach((s, k) => {
      if (elapsed >= s.at) i = k;
    });
    if (i !== this.settleStep) {
      const old = this.settleStep;
      this.settleStep = i;
      if (i >= 0)
        this.emit("settle_phase_changed", null, {
          old_step: old,
          new_step: i,
          title: this.settle.steps[i]?.title,
          elapsed_s: r6(elapsed),
        }, t);
    }
  }

  /** Settle-in left the screen: completed/skipped (plant follows) or interrupted. */
  settleEnded(how: "completed" | "skipped" | "interrupted", reason: string, t = browserNow()) {
    if (!this.settling) return;
    this.settling = false;
    if (how === "completed") {
      this.settleDone = true;
      this.emit("settle_completed", "completed", { elapsed_s: r6(this.settleElapsed) }, t);
    } else {
      this.emit("settle_interrupted", reason, { elapsed_s: r6(this.settleElapsed), skipped: how === "skipped" }, t);
      if (how === "skipped") this.settleDone = true;
      else this.closeRound("settle_aborted", t);
    }
  }

  plantStart(t = browserNow(), partial = false) {
    if (!this.open) this.openRound(false, t);
    this.plantStarted = true;
    this.emit("plant_started", partial ? "recording_started_mid_plant" : null, {
      partial_start: partial,
      settle_in_done: this.settleDone,
      config: this.config(),
      growth: this.last ? r6(this.last.growth) : 0,
    }, t);
  }

  /** The plant was cleared. A settle-in that just finished keeps its round for the new plant. */
  reset(reason: string, t = browserNow()) {
    if (!this.open) return;
    if (this.settling) {
      this.settleEnded("interrupted", reason, t);
      return;
    }
    if (!this.plantStarted && this.settleDone) return;
    this.closeRound(reason, t);
  }

  private summary() {
    const s = this.last;
    if (!s)
      return {
        growth: 0,
        active_s: 0,
        pace_s: this.ctx.pace,
        configuration_changes: this.changes,
        settle_in_done: this.settleDone,
      };
    const [growing, blooming, full] = s.stats.reached;
    return {
      growth: r6(s.growth),
      stage: stageOf(s.growth),
      full_bloom: s.growth >= 1,
      active_s: r6(s.active),
      above_baseline_s: r6(s.stats.above),
      mean_used_score: s.active > 0 ? r6(s.stats.scoreSum / s.active) : null,
      drive_integral_s: r6(s.stats.driveSum),
      reached_growing_at_active_s: growing,
      reached_blooming_at_active_s: blooming,
      reached_full_bloom_at_active_s: full,
      pace_s: this.ctx.pace,
      configuration_changes: this.changes,
      settle_in_done: this.settleDone,
    };
  }

  private closeRound(reason: string, t: number) {
    if (!this.open) return;
    if (this.growing) this.growthStopped(reason, t);
    if (this.plantStarted) this.emit("plant_ended", reason, { summary: this.summary() }, t);
    this.emit("round_ended", reason, { summary: this.summary() }, t);
    this.open = false;
    this.plantStarted = false;
    this.settleDone = false;
    this.paused = false;
  }

  pause(reason: string, t = browserNow()) {
    if (!this.plantStarted || this.paused) return;
    this.paused = true;
    if (this.growing) this.growthStopped(reason, t);
    this.emit("plant_paused", reason, { growth: this.last ? r6(this.last.growth) : 0 }, t);
    this.progress(t);
    if (this.last) this.snapshot(this.last, "transition");
  }

  resume(t = browserNow()) {
    if (!this.plantStarted || !this.paused) return;
    this.paused = false;
    this.emit("plant_resumed", null, {}, t);
  }

  private growthStopped(reason: string, t: number) {
    this.growing = false;
    this.emit("growth_stopped", reason, {
      growth: this.last ? r6(this.last.growth) : 0,
      score: this.ctx.score,
      explanation:
        reason === "score_at_or_below_baseline"
          ? "No growth: the published score was at or below the 0.5 baseline score."
          : reason === "full_growth"
            ? "Growth complete."
            : reason === "input_unusable"
              ? "Growth paused because the input was unusable."
              : reason === "paused_by_user"
                ? "Paused by the operator or player."
                : "Growth paused: the game could not tick.",
    }, t);
  }

  /** Evaluate the actual growth gate every frame (live, usable score, drive > 0, not full). */
  gate(t = browserNow()) {
    if (!this.plantStarted) return;
    const c = this.ctx;
    const s = this.last;
    const full = !!s && s.growth >= 1;
    const d = c.score === null ? 0 : drive(c.score);
    const now = c.live && c.score !== null && d > 0 && !full;
    if (now === this.growing) return;
    if (now) {
      this.growing = true;
      this.emit("growth_started", "score_above_baseline", { growth: s ? r6(s.growth) : 0, score: c.score, drive: r6(d) }, t);
    } else {
      this.growthStopped(
        !c.live ? (c.blocker ?? "paused") : full ? "full_growth" : "score_at_or_below_baseline",
        t,
      );
    }
  }

  /** One model step (only called while live). */
  step(prev: GardenState, next: GardenState, t = browserNow()) {
    this.last = next;
    if (!this.plantStarted) return;
    const a = stageOf(prev.growth);
    const b = stageOf(next.growth);
    if (a !== b) {
      this.emit("stage_changed", null, {
        old_stage: a,
        new_stage: b,
        growth: r6(next.growth),
        milestone: MILESTONES.find((m) => prev.growth < m && next.growth >= m) ?? null,
      }, t);
      this.progress(t);
    }
    if (prev.growth < 1 && next.growth >= 1) {
      this.emit("full_bloom", null, { growth: 1, active_s: r6(next.active), note: "Milestone only; play and recording continue." }, t);
      this.progress(t);
    }
  }

  /** Remember the latest model state (e.g. after reset) without logging. */
  observe(s: GardenState) {
    this.last = s;
  }

  progress(t = browserNow()) {
    if (this.open) this.emit("round_progress", null, this.summary(), t);
  }

  /** Breathing guide visual phase (only while the guide is on screen). */
  breath(phase: "in" | "out" | null, t = browserNow()) {
    if (phase === this.breathPhase) return;
    const old = this.breathPhase;
    this.breathPhase = phase;
    if (!this.open) return;
    this.emit("breath_phase_changed", phase === null ? "guide_hidden" : null, {
      old_phase: old,
      new_phase: phase,
      note: "Visual pacing guide; not measured respiration.",
    }, t);
  }

  audio(effective: boolean, reason: string, t = browserNow()) {
    if (effective === this.audioEffective && reason === this.audioReason) return;
    const old = this.audioEffective;
    this.audioEffective = effective;
    this.audioReason = reason;
    this.emit("audio_effective_changed", reason, { old_effective: old, new_effective: effective, requested: this.ctx.sound }, t);
  }

  setting(type: string, old: unknown, value: unknown, reason = "operator_change") {
    this.changes += 1;
    this.emit(type, reason, { old_value: old, new_value: value });
  }

  relation(old: Relation | null, value: Relation | null, detail: Record<string, unknown>) {
    this.emit("relation_changed", null, {
      old_relation: old,
      new_relation: value,
      ...detail,
      note: "Computed relation of relative alpha to the calibration baseline; not an emotional state.",
    });
  }

  snapshot(s: GardenState, kind: "snapshot" | "transition" | "start" | "stop" = "snapshot") {
    if (!this.sink.active || !this.roundId || !this.open) return;
    const c = this.ctx;
    this.sink.state(
      {
        game: "garden",
        round_id: this.roundId,
        active_s: r6(s.active),
        mode: "garden",
        running: c.live,
        visible: typeof document === "undefined" || document.visibilityState === "visible",
        source: c.source,
        score: c.score,
        usable: c.usable,
        reason: c.blocker,
        garden_growth: r6(s.growth),
        garden_response: r6(s.response),
        garden_drive: c.score === null || !c.live ? 0 : r6(drive(c.score)),
        garden_stage: stageOf(s.growth),
        garden_above_s: r6(s.stats.above),
        garden_relation: c.relation,
        garden_pace_s: c.pace,
        garden_settle_state: this.settling ? "settling" : this.settleDone ? "done" : this.plantStarted ? "skipped_or_off" : "none",
        garden_settle_progress_s: this.settling ? r6(this.settleElapsed) : null,
        garden_guide_enabled: c.guide,
        garden_breath_phase: this.breathPhase,
        garden_audio_requested: c.sound,
        garden_audio_effective: this.audioEffective ?? false,
        garden_volume: c.volume,
        garden_reduced_motion: c.reducedMotion,
      },
      kind,
    );
  }

  /** Recording opened in this tab: describe the plant/settle-in already under way. */
  onRecordingBegin() {
    if (!this.open) return;
    const t = browserNow();
    this.openRound(this.settling || this.settleDone, t, true);
    if (this.settling) this.settleStarted(t, true);
    if (this.plantStarted) {
      this.plantStart(t, true);
      if (this.paused) this.emit("plant_paused", this.ctx.blocker ?? "paused", { partial_start: true }, t);
      if (this.growing) this.emit("growth_started", "recording_started_mid_growth", { partial_start: true }, t);
    }
    if (this.breathPhase) this.emit("breath_phase_changed", "recording_started", { old_phase: null, new_phase: this.breathPhase, note: "Visual pacing guide; not measured respiration." }, t);
    if (this.audioEffective !== null) this.emit("audio_effective_changed", this.audioReason, { old_effective: null, new_effective: this.audioEffective, requested: this.ctx.sound }, t);
  }
}
