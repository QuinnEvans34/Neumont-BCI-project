import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Telemetry } from "../SignalPanel";
import {
  ElectrodeMap,
  ExperimentHeader,
  Prerequisites,
  RecordingPanel,
  SessionNotice,
  SignalStatus,
  SourceBanner,
  cleanParticipant,
  fmt,
  useEscape,
  useSetupMemory,
} from "./Shared";
import { setSimulatedGaze, useExperimentSession } from "./session";
import {
  TIMING,
  analyzePreflight,
  cycleLuminance,
  framesPerCycle,
  intervalFails,
  type Preflight,
} from "./timing";
import {
  CARD_LABELS,
  buildBlock,
  requestedLabel,
  type Requested,
  type Trial,
} from "./protocol";
import {
  isPosterior,
  type Counts,
  type ExperimentTelemetry,
  type SetupReport,
} from "./types";

type Props = {
  telemetry: Telemetry | null;
  fresh: boolean;
  connected: boolean;
  onExit: () => void;
};

const FREQS = [10, 12, 15];
type Phase =
  | "idle"
  | "preflight"
  | "cue"
  | "stim"
  | "rest"
  | "break"
  | "interrupted"
  | "done";
type Plan = {
  block: "setup" | "evaluation" | "single";
  seed: number;
  runs: Trial[][];
};
type SimGaze = "none" | "0" | "1" | "2" | "follow";

export default function SsvepExperiment({
  telemetry,
  fresh,
  connected,
  onExit,
}: Props) {
  const [memory, setMemory] = useSetupMemory();
  const [channels, setChannels] = useState<number[]>(() =>
    memory.electrodes
      .map((e, i) => (isPosterior(e) ? i : -1))
      .filter((i) => i >= 0),
  );
  const [stimS, setStimS] = useState(4);
  const [lumMean, setLumMean] = useState(0.5);
  const [lumAmp, setLumAmp] = useState(0.4);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<
    "setup" | "starting" | "session" | "ended"
  >("setup");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [position, setPosition] = useState({ run: 0, trial: 0 });
  const [current, setCurrent] = useState<Trial | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [singleTarget, setSingleTarget] = useState<Requested>(0);
  const [simGaze, setSimGaze] = useState<SimGaze>("follow");
  const [worstInterval, setWorstInterval] = useState(0);
  const [timingFailures, setTimingFailures] = useState(0);
  const [setupDone, setSetupDone] = useState(false);
  const [thresholdBusy, setThresholdBusy] = useState(false);
  const [channel, setChannel] = useState(6);
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));

  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const statusRef = useRef(status);
  statusRef.current = status;

  const exp = (telemetry?.experiment ?? null) as ExperimentTelemetry | null;
  const mine = Boolean(exp && sessionId && exp.id === sessionId);
  const other = Boolean(exp && exp.state === "running" && !mine);
  const simulated = telemetry?.source === "simulated_eeg";
  const analysis = mine ? exp!.analysis : null;

  const fpc = preflight?.profile_hz
    ? framesPerCycle(preflight.profile_hz, FREQS)
    : null;
  const cycles = useMemo(
    () => (fpc ? fpc.map((n) => cycleLuminance(n, lumMean, lumAmp)) : null),
    [fpc?.join(), lumMean, lumAmp],
  );

  // ---------------------------------------------------------------- drawing
  const draw = useCallback(
    (lums: number[] | null, cue: Requested | undefined, dim = false) => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const w = c.width;
      const h = c.height;
      ctx.fillStyle = "#070f12";
      ctx.fillRect(0, 0, w, h);
      const size = Math.min(w / 4.2, h * 0.62);
      const gap = (w - 3 * size) / 4;
      const top = (h - size) / 2 - h * 0.04;
      for (let k = 0; k < 3; k++) {
        const x = gap + k * (size + gap);
        const v = Math.round(
          255 * (lums ? lums[k] : lumMean) * (dim ? 0.55 : 1),
        );
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, top, size, size);
        if (cue === k) {
          ctx.strokeStyle = "#f2c96e";
          ctx.lineWidth = Math.max(3, size * 0.025);
          ctx.strokeRect(
            x - size * 0.06,
            top - size * 0.06,
            size * 1.12,
            size * 1.12,
          );
        }
        ctx.fillStyle = "#9fb5b8";
        ctx.font = `600 ${Math.round(size * 0.14)}px Manrope, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(CARD_LABELS[k], x + size / 2, top + size + size * 0.22);
      }
      // Static centre fixation dot (emphasised for neutral trials).
      ctx.fillStyle = cue === "neutral" ? "#f2c96e" : "#5d7478";
      ctx.beginPath();
      ctx.arc(
        w / 2,
        top - size * 0.16,
        Math.max(4, size * (cue === "neutral" ? 0.045 : 0.03)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    },
    [lumMean],
  );

  // Size the canvas to its box (never during a trial).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      if (["stim", "cue", "rest", "preflight"].includes(phaseRef.current))
        return;
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      draw(null, undefined, statusRef.current !== "session");
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ---------------------------------------------------------------- display preflight (no flicker)
  function runPreflight() {
    cancelAnimationFrame(raf.current);
    setPhase("preflight");
    setPreflight(null);
    const intervals: number[] = [];
    let last = -1;
    let first = -1;
    const loop = (now: number) => {
      if (phaseRef.current !== "preflight") return;
      if (first < 0) first = now;
      if (last >= 0) intervals.push(now - last);
      last = now;
      draw(null, undefined);
      if (document.visibilityState === "hidden") {
        setPhase("idle");
        setPreflight({
          ...analyzePreflight([]),
          reasons: ["Tab was hidden during the check. Keep it in front."],
        });
        return;
      }
      if (now - first < TIMING.PREFLIGHT_SECONDS * 1000 + 200)
        raf.current = requestAnimationFrame(loop);
      else {
        setPreflight(analyzePreflight(intervals));
        setPhase("idle");
      }
    };
    raf.current = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- session
  const neutral = useCallback(() => {
    cancelAnimationFrame(raf.current);
    draw(null, undefined, true);
    if (simulated) void setSimulatedGaze(null);
  }, [draw, simulated]);

  const session = useExperimentSession((reason) => {
    if (statusRef.current !== "session") return;
    neutral();
    setPhase("done");
    setStatus("ended");
    setMessage(`Session ended: ${reason}`);
  });

  const valid = channels.filter((i) => isPosterior(memory.electrodes[i] ?? ""));
  const rawOk = Boolean(
    fresh && telemetry?.receiving_samples && telemetry.source !== "synthetic",
  );
  const ready = Boolean(
    rawOk &&
    !other &&
    preflight?.passed &&
    fpc &&
    valid.length >= 2 &&
    acknowledged,
  );

  async function startSession() {
    if (!preflight?.passed || !fpc) return;
    setStatus("starting");
    setMessage("");
    try {
      const { owned } = await session.start({
        kind: "ssvep",
        participant: memory.participant,
        electrodes: memory.electrodes,
        reference: memory.reference,
        ssvep: {
          frequencies_hz: FREQS,
          frames_per_cycle: fpc,
          channels: valid,
          stimulation_s: stimS,
          cue_s: 1,
          rest_s: 2,
          luminance_mean: lumMean,
          luminance_amplitude: lumAmp,
          seed,
          display: {
            passed: preflight.passed,
            profile_hz: preflight.profile_hz,
            measured_hz: preflight.measured_hz,
            median_interval_ms: preflight.median_interval_ms,
            long_interval_fraction: preflight.long_interval_fraction,
            max_interval_ms: preflight.max_interval_ms,
            preflight_seconds: preflight.preflight_seconds,
            frames: preflight.frames,
            criteria: {
              ...preflight.criteria,
              optical_timing: "unverified (no photodiode)",
            },
          },
        },
      });
      setSessionId(owned.id);
      setStatus("session");
      canvas.current?.closest("section")?.scrollIntoView({ block: "start" });
      setPhase("idle");
      setSetupDone(false);
      setTimingFailures(0);
      session.log({ type: "notice_accepted" });
      draw(null, undefined);
    } catch (e) {
      setStatus("setup");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  function endSession(reason: string) {
    if (statusRef.current !== "session") return;
    const p = phaseRef.current;
    if (current && (p === "cue" || p === "stim" || p === "rest"))
      session.log(
        { type: "trial_interrupted", trial_id: current.id, reason },
        { urgent: true },
      );
    neutral();
    void session.stop(reason, false);
    setPhase("done");
    setStatus("ended");
    setMessage(`Session stopped: ${reason}. The recording is kept.`);
  }

  // ---------------------------------------------------------------- trial runner
  const runner = useRef<{
    plan: Plan;
    run: number;
    index: number;
    frames: number[][];
  } | null>(null);

  function beginPlan(p: Plan) {
    setPlan(p);
    runner.current = { plan: p, run: 0, index: 0, frames: [] };
    session.log(
      {
        type: "block_start",
        block: p.block,
        seed: p.seed,
        trials: p.runs.flat().length,
        runs: p.runs.length,
      },
      { urgent: true },
    );
    runTrial();
  }

  function interruptTrial(reason: string) {
    const p = phaseRef.current;
    if (!(p === "cue" || p === "stim" || p === "rest")) return;
    cancelAnimationFrame(raf.current);
    const r = runner.current;
    const trial = r?.plan.runs[r.run][r.index];
    if (trial) {
      session.log(
        { type: "trial_interrupted", trial_id: trial.id, reason },
        { urgent: true },
      );
      if (r && r.frames.length)
        void session.sendFrames(
          trial.id,
          preflight!.profile_hz!,
          r.frames.splice(0),
        );
      if (r) advance(r, false);
    }
    if (reason.startsWith("Frame interval")) setTimingFailures((n) => n + 1);
    neutral();
    setPhase("interrupted");
    setMessage(
      `Trial interrupted: ${reason}. It will not resume; continue with the next trial when ready.`,
    );
  }

  function advance(r: NonNullable<typeof runner.current>, _completed: boolean) {
    r.index += 1;
    if (r.index >= r.plan.runs[r.run].length) {
      r.run += 1;
      r.index = 0;
    }
  }

  function runTrial() {
    const r = runner.current;
    if (!r || !cycles || !preflight?.profile_hz) return;
    if (r.run >= r.plan.runs.length) {
      session.log({ type: "block_end", block: r.plan.block }, { urgent: true });
      setPhase("done");
      setCurrent(null);
      if (r.plan.block === "setup") setSetupDone(true);
      setMessage(
        `${r.plan.block === "setup" ? "Threshold setup" : r.plan.block === "evaluation" ? "Evaluation" : "Trial"} block finished.`,
      );
      return;
    }
    const trial = r.plan.runs[r.run][r.index];
    setCurrent(trial);
    setPosition({ run: r.run, trial: r.index });
    setMessage("");
    const median = preflight.median_interval_ms;
    const profile = preflight.profile_hz;
    const cueFrames = Math.round(1 * profile);
    const stimFrames = Math.round(stimS * profile);
    const restFrames = Math.round(2 * profile);
    const gazeHz =
      simGaze === "follow"
        ? typeof trial.requested === "number"
          ? FREQS[trial.requested]
          : null
        : simGaze === "none"
          ? null
          : FREQS[Number(simGaze)];
    let stage: "cue" | "stim" | "rest" = "cue";
    let n = 0;
    let last = -1;
    let worst = 0;
    setPhase("cue");
    session.log(
      {
        type: "trial_cue",
        trial_id: trial.id,
        block: trial.block,
        requested: trial.requested,
      },
      { urgent: true },
    );
    const loop = (now: number) => {
      const at = performance.timeOrigin + now;
      if (stage === "stim" && last >= 0) {
        const dt = now - last;
        worst = Math.max(worst, dt);
        if (intervalFails(dt, median)) {
          setWorstInterval(worst);
          interruptTrial(
            `Frame interval ${dt.toFixed(1)} ms exceeded 1.5× the ${median.toFixed(2)} ms median`,
          );
          return;
        }
      }
      last = now;
      if (stage === "cue") {
        draw(null, trial.requested ?? undefined);
        if (++n >= cueFrames) {
          stage = "stim";
          n = 0;
          last = now;
          if (simulated) {
            void setSimulatedGaze(gazeHz);
            session.log({
              type: "sim_gaze",
              trial_id: trial.id,
              gaze_hz: gazeHz,
              mode: simGaze,
            });
          }
        }
      }
      if (stage === "stim") {
        if (n === 0) {
          session.log(
            { type: "stim_onset", trial_id: trial.id, frame: 0 },
            { at, urgent: true },
          );
          setPhase("stim");
        }
        if (n < stimFrames) {
          const lums = cycles.map((c) => c[n % c.length]);
          draw(lums, trial.requested ?? undefined);
          r.frames.push([
            n,
            Math.round(at * 1000) / 1000,
            ...lums.map((v) => Math.round(v * 10000) / 10000),
          ]);
          n += 1;
        } else {
          draw(null, undefined);
          session.log(
            { type: "stim_offset", trial_id: trial.id, frame: n },
            { at, urgent: true },
          );
          if (simulated) void setSimulatedGaze(null);
          void session.sendFrames(trial.id, profile, r.frames.splice(0));
          setWorstInterval(worst);
          stage = "rest";
          n = 0;
          setPhase("rest");
          session.log({ type: "trial_rest", trial_id: trial.id });
        }
      } else if (stage === "rest") {
        if (++n >= restFrames) {
          advance(r, true);
          const atBreak =
            r.index === 0 && r.run > 0 && r.run < r.plan.runs.length;
          if (atBreak) {
            session.log(
              { type: "break_start", after_run: r.run },
              { urgent: true },
            );
            setPhase("break");
            return;
          }
          runTrial();
          return;
        }
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }

  function continueAfterPause() {
    if (phaseRef.current === "break")
      session.log({ type: "break_end" }, { urgent: true });
    runTrial();
  }

  async function freeze() {
    setThresholdBusy(true);
    try {
      const report: SetupReport = await session.freezeThresholds();
      setMessage(
        report.ready
          ? `Thresholds frozen from setup: correlation ≥ ${fmt(report.correlation, 3)}, margin ≥ ${fmt(report.margin, 3)}.`
          : `Setup inconclusive (${report.reason}). The decoder stays diagnostic-only and will abstain.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setThresholdBusy(false);
    }
  }

  // ---------------------------------------------------------------- interruption sources
  const inTrial = phase === "cue" || phase === "stim" || phase === "rest";
  useEffect(() => {
    if (status !== "session") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") interruptTrial("Tab hidden");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  });
  useEffect(() => {
    if (status !== "session") return;
    if (mine && exp && exp.state !== "running") {
      neutral();
      setPhase("done");
      setStatus("ended");
      setMessage(`Session ended by the server: ${exp.reason ?? exp.state}`);
      return;
    }
    if (!inTrial) return;
    if (!connected) interruptTrial("Connection to the backend lost");
    else if (!fresh || exp?.stale)
      interruptTrial("EEG samples stopped arriving");
  });
  useEscape(status === "session", () => endSession("Escape pressed"));

  // ---------------------------------------------------------------- view
  const latest =
    analysis?.latest && current && analysis.latest.trial_id === current.id
      ? analysis.latest
      : null;
  const decision =
    analysis?.last_decision &&
    current &&
    analysis.last_decision.trial_id === current.id
      ? analysis.last_decision
      : null;
  const corr = latest?.valid
    ? latest.correlations
    : decision?.valid
      ? (decision.correlations ?? null)
      : null;
  const thresholds = analysis?.thresholds ?? null;
  const counts = analysis?.counts;
  const r = runner.current;
  const totalTrials = plan ? plan.runs.flat().length : 0;
  const doneTrials =
    plan && r
      ? Math.min(totalTrials, plan.runs.slice(0, r.run).flat().length + r.index)
      : 0;

  return (
    <div className="exp-page">
      <ExperimentHeader
        title="SSVEP Cards"
        lead="Three fixed cards change brightness at known frequencies. A CCA decoder compares raw posterior EEG with each frequency and either reports a selection or abstains."
        onExit={onExit}
      />
      <SourceBanner telemetry={telemetry} />
      {message && (
        <p className="notice exp-message" role="status">
          {message}
        </p>
      )}

      <section
        className={`ssvep-stage ${status === "session" ? "active" : ""}`}
        aria-label="Stimulus cards"
      >
        <div className="stage-meta">
          <span>
            {phase === "preflight"
              ? "Display check · no flicker"
              : phase === "cue" && current
                ? `Requested target: ${requestedLabel(current.requested)}`
                : phase === "stim"
                  ? "Stimulating"
                  : phase === "rest"
                    ? "Rest"
                    : phase === "break"
                      ? "Break"
                      : status === "session"
                        ? "Static · not flickering"
                        : "Static preview · no flicker"}
          </span>
          <span>
            {plan && status === "session"
              ? `${plan.block} · trial ${Math.min(doneTrials + 1, totalTrials)} / ${totalTrials}`
              : ""}
          </span>
        </div>
        <canvas ref={canvas} className="ssvep-canvas" aria-hidden="true" />
        {(phase === "break" || phase === "interrupted") && (
          <div className="stage-pause">
            <p>
              {phase === "break"
                ? "Break. Rest your eyes; continue when ready."
                : "Trial interrupted. The next trial starts fresh."}
            </p>
            <button onClick={continueAfterPause}>
              {phase === "break" ? "Continue" : "Start next trial"}
            </button>
          </div>
        )}
        {phase === "rest" && current && (
          <div className="stage-result" aria-live="polite">
            <span className="tag-req">
              Requested: {requestedLabel(current.requested)}
            </span>
            <span className="tag-dec">
              Decoded from EEG:{" "}
              {!decision
                ? "pending…"
                : !decision.valid
                  ? `invalid (${decision.reason ?? "no valid window"})`
                  : decision.decision == null
                    ? thresholds?.ready
                      ? "abstained"
                      : `no selection (diagnostic-only; candidate ${CARD_LABELS[decision.best ?? 0]})`
                    : `Card ${CARD_LABELS[decision.decision]}`}
            </span>
          </div>
        )}
        {status === "session" && (
          <button
            className="stop-button"
            onClick={() => endSession("Stopped by operator")}
          >
            Stop (Esc)
          </button>
        )}
      </section>

      <div className="exp-grid">
        {status !== "session" && (
          <section className="exp-panel">
            <h3>1 · Setup</h3>
            <fieldset disabled={status === "starting"}>
              <label className="field">
                <span>Participant pseudonym</span>
                <input
                  value={memory.participant}
                  placeholder="e.g. P03 (no names)"
                  maxLength={32}
                  onChange={(e) =>
                    setMemory({ participant: cleanParticipant(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>
                  Stimulation per trial: <b>{stimS} s</b>
                </span>
                <input
                  type="range"
                  min={3}
                  max={6}
                  step={0.5}
                  value={stimS}
                  onChange={(e) => setStimS(Number(e.target.value))}
                />
                <small>
                  1 s cue, {stimS} s flicker, 2 s rest. The first 0.5 s is
                  excluded, then a full 2 s window is needed
                  {stimS < 3.5
                    ? "; with under 3.5 s the 0.75 s stability interval cannot be met, so trials abstain"
                    : ""}
                  .
                </small>
              </label>
              <div className="phase-inputs">
                <label className="field">
                  <span>Mean luminance</span>
                  <input
                    type="number"
                    min={0.2}
                    max={0.8}
                    step={0.05}
                    value={lumMean}
                    onChange={(e) =>
                      setLumMean(
                        Math.max(
                          0.2,
                          Math.min(0.8, Number(e.target.value) || 0.5),
                        ),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Amplitude</span>
                  <input
                    type="number"
                    min={0.05}
                    max={0.45}
                    step={0.05}
                    value={lumAmp}
                    onChange={(e) =>
                      setLumAmp(
                        Math.max(
                          0.05,
                          Math.min(
                            0.45,
                            Math.min(
                              Number(e.target.value) || 0.4,
                              lumMean,
                              1 - lumMean,
                            ),
                          ),
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <p className="meter-note">
                Cards A/B/C: nominal {FREQS.join(" / ")} Hz, sampled sinusoids
                {fpc
                  ? ` of ${fpc.join(" / ")} frames per cycle at ${preflight?.profile_hz} Hz`
                  : ""}
                . Engineering choices, not safety recommendations.
              </p>
            </fieldset>
            <ElectrodeMap
              electrodes={memory.electrodes}
              reference={memory.reference}
              disabled={status === "starting"}
              onChange={(electrodes) => {
                setMemory({ electrodes });
                setChannels((c) => {
                  const keep = c.filter((i) =>
                    isPosterior(electrodes[i] ?? ""),
                  );
                  const added = electrodes
                    .map((e, i) =>
                      isPosterior(e) && !memory.electrodes[i]?.match(/^(O|PO)/i)
                        ? i
                        : -1,
                    )
                    .filter((i) => i >= 0 && !keep.includes(i));
                  return [...keep, ...added].sort();
                });
              }}
              onReference={(reference) => setMemory({ reference })}
              selected={channels}
              onToggle={(i) =>
                setChannels((c) =>
                  c.includes(i) ? c.filter((x) => x !== i) : [...c, i].sort(),
                )
              }
              requirePosterior
            />
          </section>
        )}

        {status !== "session" && (
          <section className="exp-panel">
            <h3>2 · Display check</h3>
            <p className="meter-note">
              Measures {TIMING.PREFLIGHT_SECONDS} s of frame timing without any
              flicker. Supported: a steady 60 or 120 Hz display. Keep this tab
              in front, close other apps, and use mains power.
            </p>
            <button
              className="secondary"
              disabled={phase === "preflight" || status === "starting"}
              onClick={runPreflight}
            >
              {phase === "preflight"
                ? "Measuring…"
                : preflight
                  ? "Re-run display check"
                  : "Run display check"}
            </button>
            {preflight && <PreflightResult p={preflight} fpc={fpc} />}
          </section>
        )}

        {status !== "session" && (
          <section className="exp-panel">
            <h3>3 · Start session</h3>
            <Prerequisites
              items={[
                {
                  ok: rawOk,
                  label: "Fresh raw EEG",
                  detail: rawOk
                    ? undefined
                    : telemetry?.source === "synthetic"
                      ? "Score-only simulation has no raw EEG. Connect Simulated EEG, a recording or the headset."
                      : "Connect an input on step 1.",
                },
                {
                  ok: valid.length >= 2,
                  label: "At least two posterior (O/PO) decoder channels",
                  detail: valid.length
                    ? `Using ${valid.map((i) => `CH${i + 1} ${memory.electrodes[i]}`).join(", ")}`
                    : "Map electrodes and tick them.",
                },
                {
                  ok: Boolean(preflight?.passed),
                  label: "Display timing check passed",
                  detail:
                    preflight && !preflight.passed
                      ? "See the display check."
                      : undefined,
                },
                { ok: !other, label: "No other experiment running" },
                {
                  ok: true,
                  label: "Separate from the alpha baseline",
                  detail:
                    "Decoder thresholds come from this page's setup block.",
                },
              ]}
            />
            <SessionNotice flicker>
              <label className="check">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  The participant has read this notice and agrees to start. I
                  will stop for any discomfort.
                </span>
              </label>
            </SessionNotice>
            <button
              disabled={!ready || status === "starting"}
              onClick={() => void startSession()}
            >
              {status === "starting"
                ? "Starting…"
                : status === "ended"
                  ? "Start a new session"
                  : "Start session"}
            </button>
          </section>
        )}

        {status === "session" && (
          <section className="exp-panel">
            <h3>Trials</h3>
            <div className="trial-buttons">
              <button
                disabled={inTrial || phase === "break"}
                onClick={() => beginPlan(buildBlock("setup", seed))}
              >
                Threshold setup · 25 trials
              </button>
              <button
                className={thresholds?.ready ? "" : "secondary"}
                disabled={
                  inTrial ||
                  phase === "break" ||
                  thresholdBusy ||
                  Boolean(thresholds) ||
                  !setupDone
                }
                onClick={() => void freeze()}
              >
                {thresholds
                  ? "Thresholds frozen"
                  : "Freeze thresholds from setup"}
              </button>
              <button
                disabled={inTrial || phase === "break"}
                className={thresholds?.ready ? "" : "secondary"}
                onClick={() => beginPlan(buildBlock("evaluation", seed + 1))}
              >
                Evaluation · 40 trials
                {thresholds?.ready ? "" : " (will abstain)"}
              </button>
            </div>
            <div className="single-trial">
              <label className="field">
                <span>Single facilitator trial</span>
                <select
                  value={String(singleTarget)}
                  onChange={(e) =>
                    setSingleTarget(
                      e.target.value === "neutral"
                        ? "neutral"
                        : e.target.value === "free"
                          ? null
                          : (Number(e.target.value) as 0 | 1 | 2),
                    )
                  }
                >
                  <option value="0">Card A</option>
                  <option value="1">Card B</option>
                  <option value="2">Card C</option>
                  <option value="neutral">Neutral (centre dot)</option>
                  <option value="free">Free look (unlabelled)</option>
                </select>
              </label>
              <button
                className="secondary"
                disabled={inTrial || phase === "break"}
                onClick={() =>
                  beginPlan({
                    block: "single",
                    seed: 0,
                    runs: [
                      [
                        {
                          id: `x${Date.now().toString(36)}`,
                          block: "single",
                          requested: singleTarget,
                          index: 0,
                        },
                      ],
                    ],
                  })
                }
              >
                Run one trial
              </button>
            </div>
            {simulated && (
              <label className="field sim-gaze">
                <span>Simulated participant looks at</span>
                <select
                  value={simGaze}
                  onChange={(e) => setSimGaze(e.target.value as SimGaze)}
                  disabled={inTrial}
                >
                  <option value="follow">
                    Follow the requested target (pipeline test)
                  </option>
                  <option value="none">Nothing (noise only)</option>
                  <option value="0">Always card A (10 Hz)</option>
                  <option value="1">Always card B (12 Hz)</option>
                  <option value="2">Always card C (15 Hz)</option>
                </select>
                <small>
                  The backend adds a synthetic response at that frequency.
                  Results show the pipeline works, not that anyone's EEG can be
                  decoded.
                </small>
              </label>
            )}
            <p className="hint">
              Thresholds are chosen only from setup trials (to avoid neutral
              false activations), then frozen. Evaluation labels are never used
              for tuning. The requested target is never given to the decoder.
            </p>
            <button
              className="danger"
              onClick={() => endSession("Stopped by operator")}
            >
              Stop session
            </button>
          </section>
        )}

        <section className="exp-panel decoder">
          <div className="chart-heading">
            <h3>Decoded from EEG</h3>
            <span className={`mode-pill ${thresholds?.ready ? "ready" : ""}`}>
              {thresholds?.ready
                ? `r ≥ ${fmt(thresholds.correlation, 2)} · margin ≥ ${fmt(thresholds.margin, 2)}`
                : "Diagnostic-only"}
            </span>
          </div>
          <div
            className="corr-bars"
            role="img"
            aria-label={
              corr
                ? `CCA correlations: ${corr.map((c, i) => `${CARD_LABELS[i]} ${c.toFixed(2)}`).join(", ")}`
                : "No valid window yet"
            }
          >
            {FREQS.map((f, i) => (
              <div
                key={f}
                className={`corr-row ${latest?.candidate === i || (!latest && decision?.best === i) ? "cand" : ""}`}
              >
                <span>
                  {CARD_LABELS[i]} · {f} Hz
                </span>
                <div className="corr-track">
                  <div
                    className="corr-fill"
                    style={{ width: `${corr ? corr[i] * 100 : 0}%` }}
                  />
                  {thresholds?.ready && thresholds.correlation != null && (
                    <div
                      className="corr-th"
                      style={{ left: `${thresholds.correlation * 100}%` }}
                    />
                  )}
                </div>
                <b>{corr ? corr[i].toFixed(3) : "—"}</b>
              </div>
            ))}
          </div>
          <dl className="exp-facts">
            <dt>Candidate</dt>
            <dd>
              {latest?.valid && latest.candidate != null
                ? `${CARD_LABELS[latest.candidate]}${latest.stable ? " (stable ≥0.75 s)" : " (not yet stable)"}`
                : "—"}
            </dd>
            <dt>Accepted selection</dt>
            <dd>
              {!latest
                ? "—"
                : latest.accepted != null
                  ? `Card ${CARD_LABELS[latest.accepted]}`
                  : thresholds?.ready
                    ? "Abstain"
                    : "None (diagnostic-only)"}
            </dd>
            <dt>Runner-up margin</dt>
            <dd>{fmt(latest?.margin ?? decision?.margin, 3)}</dd>
            <dt>Channels used</dt>
            <dd>{latest?.channels?.join(", ") || "—"}</dd>
            <dt>Window</dt>
            <dd>
              {latest
                ? `${latest.window[0]}–${latest.window[1]} · ${latest.valid ? "valid" : latest.reason}`
                : phase === "stim"
                  ? "waiting for 0.5 s exclusion + 2 s window"
                  : "—"}
            </dd>
            {latest?.excluded?.length ? (
              <>
                <dt>Excluded</dt>
                <dd>
                  {latest.excluded
                    .map((x) => `${x.channel}: ${x.reason}`)
                    .join("; ")}
                </dd>
              </>
            ) : null}
          </dl>
          <p className="chart-caption">
            CCA correlations are similarities between EEG and each frequency's
            sine/cosine references (with second harmonic), not probabilities:
            0.8 does not mean 80% confidence.
          </p>
        </section>

        <Spectrum spectrum={analysis?.spectrum} />

        <section className="exp-panel">
          <h3>Display timing</h3>
          <dl className="exp-facts">
            <dt>Nominal frequencies</dt>
            <dd>{FREQS.join(" / ")} Hz</dd>
            <dt>Software schedule</dt>
            <dd>
              {fpc && preflight?.profile_hz
                ? `${fpc.join(" / ")} frames at ${preflight.profile_hz} Hz`
                : "—"}
            </dd>
            <dt>Measured refresh</dt>
            <dd>
              {preflight
                ? `${preflight.measured_hz.toFixed(2)} Hz (median ${preflight.median_interval_ms.toFixed(2)} ms)`
                : "—"}
            </dd>
            <dt>Worst interval, last trial</dt>
            <dd>{worstInterval ? `${worstInterval.toFixed(1)} ms` : "—"}</dd>
            <dt>Trials stopped for timing</dt>
            <dd>{timingFailures}</dd>
            <dt>Optical timing</dt>
            <dd>Unverified — no photodiode measurement</dd>
          </dl>
          <p className="chart-caption">
            Browser frame callbacks show when the page asked to draw, not when
            light left the screen.
          </p>
        </section>

        <Summary counts={counts} setup={analysis?.setup} />
        <SignalStatus
          telemetry={telemetry}
          fresh={fresh}
          channel={channel}
          onChannel={setChannel}
          electrodes={memory.electrodes}
        />
        <RecordingPanel
          experiment={mine ? exp : other ? exp : null}
          mine={mine}
        />
      </div>
    </div>
  );
}

function PreflightResult({ p, fpc }: { p: Preflight; fpc: number[] | null }) {
  return (
    <div className={`preflight ${p.passed ? "pass" : "fail"}`} role="status">
      <b>
        {p.passed ? `Passed · ${p.profile_hz} Hz profile` : "Not supported"}
      </b>
      <dl className="exp-facts">
        <dt>Measured</dt>
        <dd>
          {p.measured_hz.toFixed(2)} Hz · median{" "}
          {p.median_interval_ms.toFixed(2)} ms
        </dd>
        <dt>Late frames (&gt;1.5×)</dt>
        <dd>{(p.long_interval_fraction * 100).toFixed(2)}% (limit 1%)</dd>
        <dt>Longest frame</dt>
        <dd>{p.max_interval_ms.toFixed(1)} ms (limit 3× median)</dd>
        {fpc && (
          <>
            <dt>Frames per cycle</dt>
            <dd>{fpc.join(" / ")}</dd>
          </>
        )}
      </dl>
      {p.reasons.map((r) => (
        <p key={r} className="notice">
          {r}
        </p>
      ))}
    </div>
  );
}

function Spectrum({
  spectrum,
}: {
  spectrum?: { f: number[]; amplitude_uv: number[]; discontinuous: boolean };
}) {
  const f = spectrum?.f ?? [];
  const a = spectrum?.amplitude_uv ?? [];
  const max = Math.max(1, ...a);
  const x = (hz: number) => ((hz - 2) / 38) * 1000;
  const y = (v: number) => 110 - (v / max) * 100;
  const d = f
    .map((hz, i) => `${i ? "L" : "M"}${x(hz).toFixed(1)},${y(a[i]).toFixed(1)}`)
    .join("");
  return (
    <section className="exp-panel">
      <div className="chart-heading">
        <h3>Spectrum · decoder channels</h3>
        <span>
          {spectrum
            ? spectrum.discontinuous
              ? "contains a packet gap"
              : "last 2 s"
            : "waiting"}
        </span>
      </div>
      <svg
        viewBox="0 0 1000 125"
        preserveAspectRatio="none"
        className="spectrum"
        role="img"
        aria-label="Amplitude spectrum 2 to 40 Hz with markers at 10, 12 and 15 Hz and their harmonics"
      >
        {FREQS.flatMap((hz, i) => [
          <line
            key={`f${hz}`}
            x1={x(hz)}
            x2={x(hz)}
            y1={5}
            y2={112}
            stroke={["#f2c96e", "#8ff1d0", "#9db4ff"][i]}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />,
          <line
            key={`h${hz}`}
            x1={x(2 * hz)}
            x2={x(2 * hz)}
            y1={5}
            y2={112}
            stroke={["#f2c96e", "#8ff1d0", "#9db4ff"][i]}
            strokeDasharray="3 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />,
        ])}
        <path
          d={d}
          stroke="#e9f3f1"
          strokeWidth="1.5"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="timeline-legend">
        <span>2 Hz</span>
        <span>
          <i className="dot gold" /> A 10 <i className="dot mint" /> B 12{" "}
          <i className="dot blue" /> C 15 Hz · dashed = 2nd harmonic
        </span>
        <span>40 Hz</span>
      </div>
      <p className="chart-caption">
        Mean Hann-windowed amplitude across decoder channels, display only (µV).
      </p>
    </section>
  );
}

function Summary({
  counts,
  setup,
}: {
  counts?: { setup: Counts; evaluation: Counts; single: Counts };
  setup?: SetupReport;
}) {
  const rows: [string, keyof Counts][] = [
    ["Correct selections", "correct"],
    ["Incorrect selections", "incorrect"],
    ["Abstentions (target trials)", "abstained"],
    ["Neutral false activations", "neutral_false_activations"],
    ["Neutral abstentions", "neutral_abstained"],
    ["Invalid trials", "invalid"],
    ["Interrupted trials", "interrupted"],
    ["Completed / total", "completed"],
  ];
  return (
    <section className="exp-panel wide">
      <div className="chart-heading">
        <h3>Trial summary</h3>
        <span>counted separately; never merged into one accuracy</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <th>Setup</th>
              <th>Evaluation</th>
              <th>Single trials</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, k]) => (
              <tr key={k}>
                <td>{label}</td>
                {(["setup", "evaluation", "single"] as const).map((b) => (
                  <td key={b}>
                    {!counts
                      ? "—"
                      : k === "completed"
                        ? `${counts[b].completed} / ${counts[b].trials}`
                        : counts[b][k]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {setup && (
        <p className={setup.ready ? "meter-note" : "notice"}>
          Setup thresholds:{" "}
          {setup.ready ? "ready" : `not ready — ${setup.reason}`}. Valid setup
          trials: {setup.valid_target} target, {setup.valid_neutral} neutral,{" "}
          {setup.invalid} invalid
          {setup.setup_correct != null
            ? `; with these thresholds setup would accept ${setup.setup_correct} correctly, ${setup.setup_wrong} wrongly, 0 neutral`
            : ""}
          .
        </p>
      )}
      <p className="chart-caption">
        Setup trials are decoded diagnostic-only (no thresholds yet), so their
        selections read as abstentions. Results with Simulated EEG are pipeline
        checks only.
      </p>
    </section>
  );
}
