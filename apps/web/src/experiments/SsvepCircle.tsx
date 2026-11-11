import { useEffect, useRef, useState } from "react";
import type { Telemetry } from "../SignalPanel";
import { ElectrodeMap, ExperimentHeader, RecordingPanel, SourceBanner,
  cleanParticipant, fmt, useEscape, useSetupMemory } from "./Shared";
import { useExperimentSession } from "./session";
import { analyzePreflight, browserNow, intervalFails, type Preflight } from "./timing";
import { circleOn, observedFrequency, type CircleSegment, type CircleSettings } from "./circle";
import type { CircleMetrics, ExperimentTelemetry } from "./types";
import "./circle.css";

type Props = { telemetry: Telemetry | null; fresh: boolean; connected: boolean; onExit: () => void };
type Phase = "idle" | "checking" | "starting" | "running" | "stopping" | "ended";
type Trial = {
  id: string; start: number; deadline: number; profile: number; median: number;
  segment: CircleSegment | null; segments: number; frames: number;
};

export default function SsvepCircle({ telemetry, fresh, connected, onExit }: Props) {
  const [memory, setMemory] = useSetupMemory();
  const [settings, setSettings] = useState<CircleSettings>({ frequency_hz: 10, color: "#9db4ff" });
  const [seconds, setSeconds] = useState(30);
  const [notes, setNotes] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>(phase);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [observed, setObserved] = useState<number | null>(null);
  const [result, setResult] = useState<ExperimentTelemetry | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const active = useRef<Trial | null>(null);
  const desired = useRef(settings);
  desired.current = settings;
  const mounted = useRef(true);
  const cleanup = useRef<() => void>(() => {});
  const stopRef = useRef<(reason: string, completed?: boolean) => void>(() => {});
  const latest = useRef({ telemetry, fresh, connected });
  latest.current = { telemetry, fresh, connected };

  // Registered before the session hook: enqueue the final frames/events before
  // that hook drains its outbox and closes the recording on navigation.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cleanup.current(); };
  }, []);

  const session = useExperimentSession((reason) => stopRef.current(reason));
  const exp = telemetry?.experiment?.id === sessionId ? telemetry.experiment : result;
  const other = telemetry?.experiment?.state === "running" && telemetry.experiment.id !== sessionId;
  const running = phase === "running";
  const busy = ["checking", "starting", "running", "stopping"].includes(phase);
  const rawOk = connected && fresh && Boolean(telemetry?.receiving_samples) && telemetry?.source !== "synthetic";
  const researchActive = ["recording", "finalizing"].includes(telemetry?.research?.state ?? "");
  const canStart = rawOk && !other && !researchActive && preflight?.passed && acknowledged && !busy;
  const metrics = exp?.analysis.latest as unknown as CircleMetrics | undefined;
  const showMetrics = Boolean(metrics && (phase === "ended" || (rawOk && !exp?.stale)));

  function changePhase(value: Phase) { phaseRef.current = value; setPhase(value); }

  function draw(on: boolean, color = desired.current.color) {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#070f12";
    ctx.fillRect(0, 0, c.width, c.height);
    if (on) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.19, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A steady preview is shown only before a trial; Stop always blanks it.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      if (active.current) { stopRef.current("Stimulus area resized; run the display check again"); setPreflight(null); }
      const box = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(box.width * dpr);
      c.height = Math.round(box.height * dpr);
      draw(phaseRef.current === "idle" || phaseRef.current === "checking");
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    const resized = () => {
      setPreflight(null);
      if (active.current) stopRef.current("Display resized; run the display check again");
      if (phaseRef.current === "checking") {
        cancelAnimationFrame(raf.current);
        changePhase("idle");
        setMessage("Display check cancelled: display resized. Run it again.");
      }
    };
    window.addEventListener("resize", resized);
    return () => { ro.disconnect(); window.removeEventListener("resize", resized); };
  }, []);
  useEffect(() => {
    if (!active.current) draw(phase === "idle" || phase === "checking");
  }, [settings.color, phase]);

  function sendPending(t: Trial) {
    const s = t.segment;
    if (s?.rows.length) void session.sendFrames(s.id, t.profile, s.rows.splice(0));
  }

  function closeSegment(t: Trial, at: number) {
    const s = t.segment;
    if (!s) return;
    sendPending(t);
    session.log({ type: "segment_end", trial_id: t.id, segment_id: s.id,
      frames: s.frame, observed_hz: observedFrequency(s.rises), worst_interval_ms: s.worstInterval,
      elapsed_ms: at - s.first }, { at });
    t.segment = null;
  }

  function finishLocal(reason: string, completed: boolean) {
    cancelAnimationFrame(raf.current);
    draw(false);
    const t = active.current;
    if (!t) return;
    const at = browserNow();
    closeSegment(t, at);
    session.log({ type: "trial_end", trial_id: t.id, reason, completed,
      elapsed_ms: t.start ? at - t.start : 0, frames: t.frames, segments: t.segments,
      stimulus_off: true }, { at, urgent: true });
    active.current = null;
  }

  async function stopTrial(reason: string, completed = false) {
    if (phaseRef.current !== "running") return;
    changePhase("stopping");
    finishLocal(reason, completed);
    setMessage(reason);
    const final = await session.stop(reason, completed);
    if (mounted.current) {
      if (final) { setResult(final); setMessage(final.reason ?? reason); }
      changePhase("ended");
    }
  }
  stopRef.current = (reason, completed = false) => { void stopTrial(reason, completed); };
  cleanup.current = () => {
    cancelAnimationFrame(raf.current);
    finishLocal("Left the circle experiment", false);
  };

  function checkDisplay() {
    if (busy) return;
    changePhase("checking");
    setPreflight(null);
    setMessage("Checking display timing for 5 seconds. The circle stays steady.");
    const intervals: number[] = [];
    let first: number | null = null;
    let last: number | null = null;
    const loop = (now: number) => {
      if (phaseRef.current !== "checking") return;
      if (document.hidden) { changePhase("idle"); setMessage("Display check cancelled: tab hidden."); return; }
      first ??= now;
      if (last !== null) intervals.push(now - last);
      last = now;
      if (now - first < 5200) raf.current = requestAnimationFrame(loop);
      else {
        const p = analyzePreflight(intervals);
        setPreflight(p);
        changePhase("idle");
        setMessage(p.passed ? `Display check passed: ${fmt(p.measured_hz)} Hz.` : p.reasons.join(" "));
      }
    };
    raf.current = requestAnimationFrame(loop);
  }

  async function startTrial() {
    if (!canStart || !preflight?.profile_hz) return;
    const sourceSession = telemetry?.session_id;
    const p = preflight;
    changePhase("starting");
    setMessage("Starting the recording…");
    setElapsed(0);
    setObserved(null);
    setResult(null);
    try {
      const { owned } = await session.start({ kind: "ssvep_circle", participant: memory.participant,
        electrodes: memory.electrodes, reference: memory.reference,
        ssvep_circle: { ...desired.current, duration_s: seconds, display: p } });
      if (!mounted.current || document.hidden || !latest.current.connected || !latest.current.fresh ||
          !latest.current.telemetry?.receiving_samples || latest.current.telemetry.session_id !== sourceSession) {
        await session.stop("Input or visibility changed while starting");
        if (mounted.current) { setSessionId(owned.id); changePhase("ended"); setMessage("Start cancelled: input or visibility changed."); }
        return;
      }
      setSessionId(owned.id);
      session.log({ type: "notice_accepted" });
      if (notes.trim()) session.log({ type: "note", text: notes.trim(), context: "trial_setup" });
      const t: Trial = { id: crypto.randomUUID(), start: 0, deadline: seconds * 1000,
        profile: p.profile_hz!, median: p.median_interval_ms, segment: null, segments: 0, frames: 0 };
      active.current = t;
      changePhase("running");
      setMessage("Trial running. Color and frequency changes are timestamped in the recording.");
      let last: number | null = null;
      let uiAt = 0;
      const loop = (now: number) => {
        if (active.current !== t) return;
        const at = performance.timeOrigin + now;
        if (document.hidden) { stopRef.current("Tab hidden"); return; }
        if (!t.start) {
          t.start = at;
          session.log({ type: "trial_start", trial_id: t.id, duration_s: seconds }, { at, urgent: true });
        }
        const dt = last === null ? 0 : now - last;
        last = now;
        if (t.segment) t.segment.worstInterval = Math.max(t.segment.worstInterval, dt);
        if (dt && intervalFails(dt, t.median)) {
          stopRef.current(`Late display frame (${fmt(dt, 1)} ms); trial interrupted`); return;
        }
        if (at - t.start >= t.deadline) { setElapsed(seconds); stopRef.current("Trial duration complete", true); return; }
        const config = desired.current;
        if (!t.segment || t.segment.settings.color !== config.color || t.segment.settings.frequency_hz !== config.frequency_hz) {
          closeSegment(t, at);
          t.segments++;
          t.segment = { id: `${t.id}-${t.segments}`, settings: { ...config }, frame: 0, rows: [],
            first: at, last: at, lastOn: false, rises: [], worstInterval: 0 };
          const c = canvas.current!;
          session.log({ type: "segment_start", trial_id: t.id, segment_id: t.segment.id, ...config,
            geometry: { width_px: c.width, height_px: c.height, device_pixel_ratio: window.devicePixelRatio,
              radius_px: Math.min(c.width, c.height) * 0.19 },
            frame_columns: ["segment_frame", "t_browser_ms", "on"], waveform: "square_50_percent_frame_sampled" }, { at });
          setObserved(null);
        }
        const s = t.segment;
        const on = circleOn(s.frame, s.settings.frequency_hz, t.profile);
        draw(on, s.settings.color);
        if (on && !s.lastOn) s.rises.push(at);
        s.lastOn = on;
        s.last = at;
        s.rows.push([s.frame++, at, on ? 1 : 0]);
        t.frames++;
        if (s.rows.length >= t.profile) sendPending(t);
        if (now - uiAt > 250) {
          setElapsed((at - t.start) / 1000);
          setObserved(observedFrequency(s.rises));
          uiAt = now;
        }
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
    } catch (error) {
      draw(false);
      await session.stop("Trial could not start");
      if (mounted.current) { changePhase("ended"); setMessage(error instanceof Error ? error.message : String(error)); }
    }
  }

  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        setPreflight(null);
        if (phaseRef.current === "checking") {
          cancelAnimationFrame(raf.current);
          changePhase("idle");
          setMessage("Display check cancelled: tab hidden. Run it again.");
        }
        if (active.current) {
          session.log({ type: "visibility", hidden: true });
          stopRef.current("Tab hidden");
        }
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [session.log]);
  useEffect(() => {
    if (!active.current) return;
    if (!connected || !fresh || !telemetry?.receiving_samples || exp?.stale)
      stopRef.current("EEG connection or fresh samples lost");
    else if (exp && exp.state !== "running") stopRef.current(`Server ended the trial: ${exp.reason ?? exp.state}`);
    else if (other) stopRef.current("The recording session changed");
  }, [connected, fresh, telemetry, exp, other]);
  useEscape(running, () => stopRef.current("Escape pressed"));

  return (
    <div className="experiment circle-experiment">
      <ExperimentHeader title="SSVEP Circle" lead="One circle. Your color. Your frequency. Every trial recorded."
        onExit={onExit} />
      <SourceBanner telemetry={telemetry} />
      <section className="circle-stage" aria-label="Single circle stimulus">
        <div className="stage-meta"><span>{running ? "● RECORDING & FLASHING" : phase === "checking" ? "DISPLAY CHECK · NO FLASHING" : phase === "idle" ? "STEADY PREVIEW · NO FLASHING" : "STIMULUS OFF"}</span>
          <span>{fmt(elapsed, 1)} / {seconds} s</span></div>
        <canvas ref={canvas} className="circle-canvas" aria-label="One circle flashing on and off during an active trial" />
        <div className="circle-controls">
          <label className="circle-frequency">Flash frequency <strong>{settings.frequency_hz.toFixed(1)} Hz</strong>
            <input aria-label="Circle flash frequency" type="range" min="1" max="30" step="0.5"
              disabled={phase === "starting" || phase === "stopping"}
              value={settings.frequency_hz} onChange={(e) => setSettings((s) => ({ ...s, frequency_hz: Number(e.target.value) }))} />
            <span className="circle-range-labels"><span>1 Hz</span><span>30 Hz</span></span>
          </label>
          <label className="circle-color">Circle color
            <input type="color" aria-label="Circle color" value={settings.color}
              disabled={phase === "starting" || phase === "stopping"}
              onChange={(e) => setSettings((s) => ({ ...s, color: e.target.value }))} />
            <code>{settings.color.toUpperCase()}</code>
          </label>
          <div className="circle-timing"><small>OBSERVED FLASH RATE</small><strong>{fmt(observed)} Hz</strong>
            <small>Requested {settings.frequency_hz.toFixed(1)} Hz · display {preflight?.profile_hz ?? "—"} Hz</small></div>
          <button className="circle-stop" disabled={!running} onClick={() => stopRef.current("Stopped by participant")}>Stop · Esc</button>
        </div>
      </section>

      <div className="circle-setup">
        <section className="exp-panel">
          <h2>Trial setup</h2>
          <fieldset disabled={busy} className="circle-fields">
            <label>Participant pseudonym<input value={memory.participant} placeholder="e.g. P01" maxLength={32}
              onChange={(e) => setMemory({ participant: cleanParticipant(e.target.value) })} /></label>
            <label>Trial length (seconds)<input type="number" min="5" max="600" value={seconds}
              onChange={(e) => setSeconds(Math.max(5, Math.min(600, Math.round(Number(e.target.value) || 5))))} /></label>
            <label>Trial notes<textarea maxLength={2000} value={notes} placeholder="Condition, instructions, electrode observations…"
              onChange={(e) => setNotes(e.target.value)} /></label>
          </fieldset>
          <details><summary>Electrode map &amp; reference (saved with the trial)</summary>
            <ElectrodeMap electrodes={memory.electrodes} reference={memory.reference} disabled={busy}
              onChange={(electrodes) => setMemory({ electrodes })} onReference={(reference) => setMemory({ reference })} />
          </details>
          <p className="meter-note">The slider requests complete on/off cycles per second. Display frames limit precision;
            fractional periods use unequal frame counts. The observed rate uses browser callbacks, with no optical timing verification.</p>
        </section>
        <section className="exp-panel">
          <h2>Start a recorded trial</h2>
          <p className="circle-notice">This circle flashes at 1–30 Hz. Do not start if you or anyone watching has
            photosensitive epilepsy or light-triggered seizures or migraines. Stop immediately if uncomfortable.</p>
          <label className="circle-ack"><input type="checkbox" checked={acknowledged} disabled={busy}
            onChange={(e) => setAcknowledged(e.target.checked)} /> I understand and agree to the flashing stimulus.</label>
          <div className="circle-actions">
            <button className="secondary" disabled={busy} onClick={checkDisplay}>
              {phase === "checking" ? "Checking display…" : "Check display (5 s)"}</button>
            <button disabled={!canStart} onClick={() => void startTrial()}>
              {phase === "starting" ? "Starting recording…" : phase === "stopping" ? "Saving trial…" : "Start recorded trial"}</button>
          </div>
          {!rawOk && <p className="hint">Connect Live Cyton, recorded EEG, or Simulated EEG on Connect. No alpha calibration needed.</p>}
          {other && <p className="notice">Another experiment is recording. Stop it before starting this trial.</p>}
          {researchActive && <p className="notice">Stop &amp; save the Research recording in the top bar first.</p>}
          {!preflight?.passed && <p className="hint">Pass the display check at a steady 60 or 120 Hz before starting.</p>}
          <p className="circle-message" role="status">{message || "Ready for setup. The preview is steady; opening this page does not start flashing."}</p>
        </section>
      </div>

      {exp && <RecordingPanel experiment={exp} mine={exp.id === sessionId} />}

      <section className="exp-panel circle-readings" aria-label="Channel frequencies and total alpha">
        <div className="chart-heading"><div><h2>EEG channels</h2><p className="meter-note">
          {phase === "ended" ? "Last recorded window" : showMetrics ? "Live · 2-second windows, updated every 0.5 s" : "Waiting for a recorded trial and a complete EEG window"}
        </p></div><div className="circle-alpha"><small>TOTAL ALPHA · 8–&lt;12 Hz</small>
          <strong>{showMetrics ? fmt(metrics?.total_alpha_uv2) : "—"} <span>µV²</span></strong>
          <small>{showMetrics ? metrics?.valid_channels : 0} / 8 valid channels</small></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr>
          <th>Channel</th><th>Electrode</th><th>Dominant frequency</th><th>Alpha power</th><th>Signal</th>
        </tr></thead><tbody>{memory.electrodes.map((name, i) => {
          const m = showMetrics ? metrics?.channels[i] : undefined;
          return <tr key={i}><td>CH{i + 1}</td><td>{name || "Unmapped"}</td>
            <td>{m?.valid ? `${fmt(m.dominant_hz, 1)} Hz` : "—"}</td>
            <td>{m?.valid ? `${fmt(m.alpha)} µV²` : "—"}</td>
            <td className={m?.valid ? "ok" : "bad"}>{m ? m.valid ? "Valid" : m.reason : "Waiting"}</td></tr>;
        })}</tbody></table></div>
        <p className="meter-note">Dominant frequency = strongest spectral bin from 1–45 Hz, with 0.5 Hz resolution.
          Total alpha = sum of 8–&lt;12 Hz power across valid channels; rejected channels are excluded.
          These readings describe the signal and do not establish an SSVEP response.</p>
      </section>
    </div>
  );
}
