import { useCallback, useEffect, useRef, useState } from "react";
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
  duration,
  fmt,
  useEscape,
  useSetupMemory,
} from "./Shared";
import { setSimulatedGaze, useExperimentSession } from "./session";
import {
  PHASE_LABEL,
  bilateralAt,
  expectedSideChanges,
  phasesOf,
  type BilateralSettings,
  type Phase,
} from "./protocol";
import type { ExperimentTelemetry, PhaseSummary } from "./types";

type Props = {
  telemetry: Telemetry | null;
  fresh: boolean;
  connected: boolean;
  onExit: () => void;
};

type RunView = {
  phase: Phase | null;
  side: "left" | "right" | null;
  elapsed: number;
  changes: number;
};
const IDLE: RunView = { phase: null, side: null, elapsed: 0, changes: 0 };

const INSTRUCTIONS = {
  follow:
    "Follow the highlighted circle with your eyes, keeping your head comfortable and still.",
  fixate:
    "Keep your eyes on the centre cross while the highlight alternates in your peripheral vision.",
};

export default function BilateralExperiment({
  telemetry,
  fresh,
  connected,
  onExit,
}: Props) {
  const [memory, setMemory] = useSetupMemory();
  const [settings, setSettings] = useState<
    BilateralSettings & { condition_order: string }
  >({
    interval_ms: 1000,
    fixation_pre_s: 20,
    alternating_s: 30,
    fixation_post_s: 20,
    instruction: "follow",
    condition_order: "",
  });
  const [status, setStatus] = useState<
    "idle" | "starting" | "running" | "ended"
  >("idle");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<RunView>(IDLE);
  const [channel, setChannel] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const raf = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  const exp = (telemetry?.experiment ?? null) as ExperimentTelemetry | null;
  const mine = Boolean(exp && runId && exp.id === runId);
  const other = Boolean(exp && exp.state === "running" && !mine);
  const simulated = telemetry?.source === "simulated_eeg";

  const neutralize = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setView((v) => ({ ...v, side: null }));
    if (simulated) void setSimulatedGaze(null, null);
  }, [simulated]);

  const session = useExperimentSession((reason) => {
    if (statusRef.current !== "running") return;
    neutralize();
    setStatus("ended");
    setMessage(`Session ended: ${reason}`);
  });

  const interrupt = useCallback(
    (reason: string) => {
      if (statusRef.current !== "running") return;
      neutralize();
      session.log({ type: "run_interrupted", reason }, { urgent: true });
      void session.stop(reason, false);
      setStatus("ended");
      setMessage(
        `Stopped: ${reason}. The partial recording is kept. Start a new run to try again.`,
      );
    },
    [neutralize, session],
  );

  // Stop conditions: hidden tab, stale EEG, lost socket, server-side end.
  useEffect(() => {
    if (status !== "running") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") interrupt("Tab hidden");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [status, interrupt]);
  useEffect(() => {
    if (status !== "running") return;
    if (!connected) interrupt("Connection to the backend lost");
    else if (!fresh) interrupt("EEG samples stopped arriving");
    else if (mine && exp?.stale) interrupt("EEG samples stopped arriving");
    else if (mine && exp && exp.state !== "running") {
      neutralize();
      setStatus("ended");
      setMessage(`Session ended by the server: ${exp.reason ?? exp.state}`);
    }
  }, [
    status,
    connected,
    fresh,
    mine,
    exp?.stale,
    exp?.state,
    exp?.reason,
    interrupt,
    neutralize,
  ]);
  useEscape(status === "running", () => interrupt("Escape pressed"));
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  async function start() {
    setStatus("starting");
    setMessage("");
    try {
      const { owned } = await session.start({
        kind: "bilateral",
        participant: memory.participant,
        electrodes: memory.electrodes,
        reference: memory.reference,
        bilateral: settings,
      });
      setRunId(owned.id);
      setStatus("running");
      document
        .querySelector(".bilateral-stage")
        ?.scrollIntoView({ block: "start" });
      session.log(
        {
          type: "run_start",
          settings,
          instruction_text: INSTRUCTIONS[settings.instruction],
        },
        { urgent: true },
      );
      run();
    } catch (e) {
      setStatus("idle");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  function run() {
    let t0 = -1;
    let lastPhase: Phase | null = null;
    let lastChange = -1;
    let lastPaint = 0;
    let shownSide: "left" | "right" | null = null;
    let gazeCleared = true;
    const s = settings;
    const loop = (now: number) => {
      if (statusRef.current !== "running") return;
      if (t0 < 0) t0 = now;
      const at = performance.timeOrigin + now; // this frame's callback time (software)
      const state = bilateralAt(s, now - t0);
      if (state.phase !== lastPhase) {
        if (lastPhase)
          session.log(
            { type: "phase_end", phase: lastPhase },
            { at, urgent: true },
          );
        if (state.phase)
          session.log(
            { type: "phase_start", phase: state.phase },
            { at, urgent: true },
          );
        lastPhase = state.phase;
      }
      if (state.changeIndex !== lastChange && state.side) {
        lastChange = state.changeIndex;
        session.log(
          { type: "side", side: state.side, n: state.changeIndex + 1 },
          { at },
        );
        if (simulated && s.instruction === "follow") {
          void setSimulatedGaze(null, state.side);
          gazeCleared = false;
        }
      }
      if (state.side === null && !gazeCleared) {
        gazeCleared = true;
        void setSimulatedGaze(null, null);
      }
      if (state.done) {
        session.log({ type: "run_complete" }, { at, urgent: true });
        setView({
          phase: null,
          side: null,
          elapsed: state.total,
          changes: lastChange + 1,
        });
        if (simulated) void setSimulatedGaze(null, null);
        void session.stop("Run complete", true);
        setStatus("ended");
        setMessage("Run complete. The recording is being finalized.");
        return;
      }
      if (now - lastPaint > 200 || state.side !== shownSide) {
        lastPaint = now;
        shownSide = state.side;
        setView({
          phase: state.phase,
          side: state.side,
          elapsed: now - t0,
          changes: Math.max(0, lastChange + 1),
        });
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }

  const running = status === "running";
  const phases = phasesOf(settings);
  const total = phases[phases.length - 1].end;
  const rawOk = Boolean(
    fresh && telemetry?.receiving_samples && telemetry.source !== "synthetic",
  );
  const canStart = rawOk && !other && status !== "starting" && !running;
  const analysis = mine ? exp?.analysis : null;
  const phaseNow = view.phase
    ? phases.find((p) => p.phase === view.phase)
    : null;
  const shownSettings =
    (mine && (exp?.settings as BilateralSettings | null)) || settings;

  return (
    <div className="exp-page">
      <ExperimentHeader
        title="Bilateral Visual Stimulation"
        lead="Two circles take turns receiving a soft highlight while EEG is observed and recorded. An exploratory observation, not a therapy or a measure of relaxation."
        onExit={onExit}
      />
      <SourceBanner telemetry={telemetry} />
      {message && (
        <p
          className={`notice exp-message ${status === "ended" ? "" : "error"}`}
          role="alert"
        >
          {message.startsWith("Run complete") && mine && exp?.saved
            ? "Run complete and saved. Export it from the Recording panel."
            : message}
        </p>
      )}

      <section
        className={`bilateral-stage ${running ? "running" : ""}`}
        aria-label="Stimulus"
      >
        <div className="stage-meta">
          <span>
            {running && view.phase
              ? `${PHASE_LABEL[view.phase]} · ${duration(Math.max(0, ((phaseNow?.end ?? 0) - view.elapsed) / 1000))} left`
              : status === "ended"
                ? "Run ended"
                : "Preview · not recording"}
          </span>
          <span>
            {running
              ? `${duration(view.elapsed / 1000)} / ${duration(total / 1000)}`
              : ""}
          </span>
        </div>
        <div className="bilateral-field">
          <div
            className={`bi-circle left ${view.side === "left" ? "lit" : ""}`}
          />
          <div
            className={`bi-fix ${view.phase && view.phase !== "alternating" ? "strong" : ""}`}
            aria-hidden="true"
          >
            +
          </div>
          <div
            className={`bi-circle right ${view.side === "right" ? "lit" : ""}`}
          />
        </div>
        <div className="stage-instruction">
          {running
            ? INSTRUCTIONS[settings.instruction]
            : "Static preview. Nothing moves until you start a session."}
        </div>
        {running && (
          <button
            className="stop-button"
            onClick={() => interrupt("Stopped by operator")}
          >
            Stop (Esc)
          </button>
        )}
      </section>

      {settings.instruction === "follow" && (
        <p className="artifact-note" role="note">
          <b>Eye movements dominate this condition.</b> Following the cues moves
          the eyes, which produces large electrical artifacts, especially on
          frontal channels. Changes in band power during the alternating phase
          cannot be read as brain activity, relaxation or left/right activation.
          No automatic artifact removal is applied.
        </p>
      )}

      <div className="exp-grid">
        <section className="exp-panel">
          <h3>Session setup</h3>
          <fieldset disabled={running || status === "starting"}>
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
            <div className="field">
              <span>Instruction condition</span>
              {(["follow", "fixate"] as const).map((k) => (
                <label key={k} className="radio">
                  <input
                    type="radio"
                    name="instruction"
                    checked={settings.instruction === k}
                    onChange={() =>
                      setSettings({ ...settings, instruction: k })
                    }
                  />
                  <span>
                    <b>
                      {k === "follow" ? "Follow the cues" : "Central fixation"}
                    </b>{" "}
                    — {INSTRUCTIONS[k]}
                  </span>
                </label>
              ))}
              <small>
                These are different conditions. In repeated runs, alternate or
                counterbalance their order and note it below.
              </small>
            </div>
            <label className="field">
              <span>Condition order note</span>
              <input
                value={settings.condition_order}
                maxLength={80}
                placeholder="e.g. run 2 of 2, fixate-first"
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    condition_order: e.target.value.slice(0, 80),
                  })
                }
              />
            </label>
            <label className="field">
              <span>
                Time between side changes: <b>{settings.interval_ms} ms</b>
              </span>
              <input
                type="range"
                min={500}
                max={2000}
                step={50}
                value={settings.interval_ms}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    interval_ms: Number(e.target.value),
                  })
                }
              />
              <small>
                Left → right takes {(settings.interval_ms / 1000).toFixed(2)} s;
                left → right → left takes{" "}
                {((2 * settings.interval_ms) / 1000).toFixed(2)} s. About{" "}
                {expectedSideChanges(settings)} side changes. Demo parameter,
                not a clinical setting.
              </small>
            </label>
            <div className="phase-inputs">
              {(
                [
                  ["fixation_pre_s", "Fixation before"],
                  ["alternating_s", "Alternating"],
                  ["fixation_post_s", "Fixation after"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="field">
                  <span>{label} (s)</span>
                  <input
                    type="number"
                    min={10}
                    max={60}
                    value={settings[k]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        [k]: Math.max(
                          10,
                          Math.min(60, Number(e.target.value) || 10),
                        ),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <ElectrodeMap
            electrodes={memory.electrodes}
            reference={memory.reference}
            disabled={running}
            onChange={(electrodes) => setMemory({ electrodes })}
            onReference={(reference) => setMemory({ reference })}
          />
        </section>

        <section className="exp-panel">
          <h3>Start</h3>
          <Prerequisites
            items={[
              {
                ok: rawOk,
                label: "Fresh raw EEG",
                detail: rawOk
                  ? `${telemetry?.source === "live" ? "Live Cyton" : telemetry?.source === "replay" ? "Replay" : "Simulated EEG"} samples arriving`
                  : telemetry?.source === "synthetic"
                    ? "Score-only simulation has no raw EEG. Connect Simulated EEG, a recording or the headset."
                    : "Connect an input on step 1.",
              },
              {
                ok: !other,
                label: "No other experiment running",
                detail: other ? "Another window owns a session." : undefined,
              },
              {
                ok: true,
                label: "Alpha baseline not required",
                detail: "Experiments bypass the game baseline.",
              },
            ]}
          />
          <SessionNotice flicker={false} />
          {!running ? (
            <button disabled={!canStart} onClick={() => void start()}>
              {status === "starting"
                ? "Starting…"
                : status === "ended"
                  ? "Start a new run"
                  : "Start session"}
            </button>
          ) : (
            <button
              className="danger"
              onClick={() => interrupt("Stopped by operator")}
            >
              Stop session
            </button>
          )}
          <p className="hint">
            Starting records every EEG sample and every phase and side change to
            a local folder. Leaving this page, hiding the tab or losing the
            signal stops the run; it never resumes on its own.
          </p>
        </section>

        <SignalStatus
          telemetry={telemetry}
          fresh={fresh}
          channel={channel}
          onChannel={setChannel}
          electrodes={memory.electrodes}
        />

        <Timeline
          settings={shownSettings}
          elapsed={running || status === "ended" ? view.elapsed : 0}
          rttMs={mine ? (exp?.clock.rtt_ms ?? null) : null}
          phase={analysis?.phase ?? null}
          sides={analysis?.sides ?? view.changes}
        />

        <LatestMetrics analysis={analysis} channel={channel} />
        <PhaseTable phases={analysis?.phases} electrodes={memory.electrodes} />
        <RecordingPanel
          experiment={mine ? exp : other ? exp : null}
          mine={mine}
        />
      </div>
    </div>
  );
}

function Timeline({
  settings,
  elapsed,
  rttMs,
  phase,
  sides,
}: {
  settings: BilateralSettings;
  elapsed: number;
  rttMs: number | null;
  phase: string | null;
  sides: number;
}) {
  const phases = phasesOf(settings);
  const total = phases[phases.length - 1].end;
  const x = (t: number) => (t / total) * 1000;
  const alt = phases[1];
  const ticks: number[] = [];
  for (let t = alt.start; t < alt.end; t += settings.interval_ms) ticks.push(t);
  const uncertainty = rttMs == null ? null : rttMs / 2 + 4;
  return (
    <section className="exp-panel timeline">
      <div className="chart-heading">
        <h3>Stimulus timeline</h3>
        <span>{sides} side changes logged</span>
      </div>
      <svg
        viewBox="0 0 1000 60"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Timeline: fixation, alternating cues, fixation. ${duration(elapsed / 1000)} elapsed.`}
      >
        {phases.map((p) => (
          <rect
            key={p.phase + p.start}
            x={x(p.start)}
            width={x(p.end) - x(p.start)}
            y={14}
            height={26}
            fill={p.phase === "alternating" ? "#2f4b5c" : "#1d3a3a"}
            stroke="#0b2026"
          />
        ))}
        {ticks.map((t, i) => (
          <line
            key={t}
            x1={x(t)}
            x2={x(t)}
            y1={i % 2 ? 26 : 14}
            y2={i % 2 ? 40 : 28}
            stroke={i % 2 ? "#9db4ff" : "#f2c96e"}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={x(elapsed)}
          x2={x(elapsed)}
          y1={4}
          y2={50}
          stroke="#8ff1d0"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="timeline-legend">
        <span>Fixation {settings.fixation_pre_s} s</span>
        <span>
          Alternating {settings.alternating_s} s · <i className="dot gold" />{" "}
          left <i className="dot blue" /> right
        </span>
        <span>Fixation {settings.fixation_post_s} s</span>
      </div>
      <p className="chart-caption">
        Server phase: {phase ? PHASE_LABEL[phase as Phase] : "—"}. Event-to-EEG
        alignment is software-only
        {uncertainty != null
          ? ` (about ±${uncertainty.toFixed(0)} ms plus source timestamp jitter)`
          : ""}
        ; times are browser frame callbacks, not measured light. Windows within
        the uncertainty of a phase boundary are excluded from phase summaries.
      </p>
    </section>
  );
}

function LatestMetrics({
  analysis,
  channel,
}: {
  analysis: ExperimentTelemetry["analysis"] | null | undefined;
  channel: number;
}) {
  const latest = analysis?.latest as
    | {
        window: [number, number];
        phase: string | null;
        discontinuous: boolean;
        channels: {
          name: string;
          valid: boolean;
          reason: string | null;
          rms?: number;
          theta?: number;
          alpha?: number;
          beta?: number;
        }[];
      }
    | undefined;
  return (
    <section className="exp-panel">
      <div className="chart-heading">
        <h3>Latest 2-second window</h3>
        <span>
          {latest
            ? `samples ${latest.window[0].toLocaleString()}–${latest.window[1].toLocaleString()}`
            : "waiting"}
        </span>
      </div>
      {latest ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>RMS µV</th>
                <th>θ µV²</th>
                <th>α µV²</th>
                <th>β µV²</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {latest.channels.map((c, i) => (
                <tr key={i} className={i === channel ? "selected" : ""}>
                  <td>
                    CH{i + 1}
                    {c.name && !c.name.startsWith("CH") ? ` · ${c.name}` : ""}
                  </td>
                  <td>{c.valid ? fmt(c.rms, 1) : "—"}</td>
                  <td>{c.valid ? fmt(c.theta, 1) : "—"}</td>
                  <td>{c.valid ? fmt(c.alpha, 1) : "—"}</td>
                  <td>{c.valid ? fmt(c.beta, 1) : "—"}</td>
                  <td className={c.valid ? "ok" : "bad"}>
                    {c.valid ? "valid" : c.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="meter-note">
          Metrics appear once a session is recording.
        </p>
      )}
      <p className="chart-caption">
        Descriptive only: mean-removed, unfiltered; band power from a
        Hann-windowed periodogram (θ 4–&lt;8, α 8–&lt;12, β 12–30 Hz), updated
        every 0.5 s.
      </p>
    </section>
  );
}

function PhaseTable({
  phases,
  electrodes,
}: {
  phases?: Record<string, PhaseSummary>;
  electrodes: string[];
}) {
  const names: Phase[] = ["fixation_pre", "alternating", "fixation_post"];
  const avg = (p: PhaseSummary, k: "rms" | "theta" | "alpha" | "beta") => {
    const v = p.channels
      .filter((c) => c.valid >= 3 && c[k] != null)
      .map((c) => c[k] as number);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return (
    <section className="exp-panel wide">
      <div className="chart-heading">
        <h3>Phase summaries</h3>
        <span>channel-averaged means of valid windows</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Windows</th>
              <th>Valid / rejected (channel-windows)</th>
              <th>Boundary-excluded</th>
              <th>RMS µV</th>
              <th>θ µV²</th>
              <th>α µV²</th>
              <th>β µV²</th>
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const p = phases?.[n];
              const valid = p ? p.channels.reduce((a, c) => a + c.valid, 0) : 0;
              const rejected = p
                ? p.channels.reduce((a, c) => a + c.rejected, 0)
                : 0;
              const enough = p && p.windows >= 3;
              return (
                <tr key={n}>
                  <td>
                    {n === "fixation_pre"
                      ? "Fixation (before)"
                      : n === "fixation_post"
                        ? "Fixation (after)"
                        : "Alternating"}
                  </td>
                  <td>{p ? p.windows : "—"}</td>
                  <td>{p ? `${valid} / ${rejected}` : "—"}</td>
                  <td>{p ? p.boundary_excluded : "—"}</td>
                  {(["rms", "theta", "alpha", "beta"] as const).map((k) => (
                    <td key={k}>
                      {!p
                        ? "—"
                        : enough
                          ? fmt(avg(p, k), 1)
                          : "insufficient data"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chart-caption">
        Requires at least 3 valid windows per channel. These are summaries of
        recorded signal power, not brain activation, calmness or treatment
        effect. Per-channel values are in the exported summary.json (
        {electrodes.filter(Boolean).length} of 8 channels named).
      </p>
    </section>
  );
}
