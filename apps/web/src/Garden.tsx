import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import GardenScene from "./GardenScene";
import {
  initialGarden,
  stepGarden,
  milestone,
  pushHistory,
  paceInsight,
  STAGE_LABEL,
  HISTORY_SECONDS,
  MILESTONES,
  PACE_MIN,
  PACE_MAX,
  type GardenState,
  type HistoryPoint,
  type Relation,
} from "./gardenSimulation";
import { breathAt } from "./breath";
import { GardenAudio } from "./gardenAudio";
import {
  loadLog,
  saveLog,
  logToCsv,
  type GardenPrefs,
  type PlantLog,
} from "./gardenPrefs";
import { duration } from "./SignalPanel";

export type GardenProps = {
  /** Every tick gate passes: selected, play page, started, visible, fresh, usable, same session. */
  live: boolean;
  /** Garden is the selected game on the visible play page (render loop allowed). */
  shown: boolean;
  /** The 30-second settle-in is running before a new plant starts. */
  intro: boolean;
  score: number | null;
  frameSeq: number;
  reset: number;
  started: boolean;
  canResume: boolean;
  canStart: boolean;
  statusMessage: string;
  simulation: boolean;
  sourceId: string;
  sourceLabel: string;
  relation: Relation | null;
  prefs: GardenPrefs;
  setPrefs: (patch: Partial<GardenPrefs>) => void;
  onPause: () => void;
  onResume: () => void;
  onNewPlant: () => void;
  onIntroDone: () => void;
  onChangeGame: () => void;
  onInspect: () => void;
  evidence: ReactNode;
};

type Snapshot = GardenState & {
  sun: number;
  time: number;
  motion: number;
  guide: number;
  intro: number;
};

/** Settle-in script. The breath clock is aligned so the guided breaths start at 14 s. */
export const INTRO_SECONDS = 34;
const INTRO_CLOCK_START = 6; // (6 + 14) % 10 === 0 → an in-breath begins as the guide appears
const INTRO_STEPS = [
  {
    at: 0,
    title: "Settle in.",
    text: "Sit comfortably, feet flat, hands resting in your lap.",
  },
  {
    at: 7,
    title: "Let your face soften.",
    text: "Unclench your jaw, drop your shoulders and rest your eyes on the plant. Stillness keeps the signal clean.",
  },
  {
    at: 14,
    title: "Follow the light.",
    text: "Breathe in as the ring grows. Breathe out slowly as it settles.",
  },
];

/** Growth points that ring a soft chime as new lights appear in the garden. */
const LIGHT_STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

const PACE_PRESETS = [
  { label: "Quick", pace: 60 },
  { label: "Standard", pace: 90 },
  { label: "Relaxed", pace: 150 },
  { label: "Long", pace: 240 },
];

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia(query).matches,
  );
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

const freshSnapshot = (time = 0, motion = 0, guide = 0): Snapshot => ({
  ...initialGarden(),
  sun: 0.5,
  time,
  motion,
  guide,
  intro: 0,
});

export default function Garden(props: GardenProps) {
  const reducedMotion = usePrefersReducedMotion();
  const current = useRef({ ...props, reducedMotion });
  current.current = { ...props, reducedMotion };
  const model = useRef<Snapshot>(freshSnapshot());
  const [snap, setSnap] = useState<Snapshot>(model.current);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [chartNow, setChartNow] = useState(() => performance.now());
  const audio = useMemo(() => new GardenAudio(), []);
  const introFired = useRef(false);

  // ---- session log (facilitator tuning) ----
  const [log, setLog] = useState<PlantLog[]>(() => loadLog());
  const plantMeta = useRef({ startedAt: "", source: props.sourceId });
  const [note, setNote] = useState("");
  const noteRef = useRef(note);
  noteRef.current = note;
  function archivePlant() {
    const m = model.current;
    if (m.active < 5 || !plantMeta.current.startedAt) return;
    const entry: PlantLog = {
      id: `${plantMeta.current.startedAt}-${Math.round(m.active)}`,
      startedAt: plantMeta.current.startedAt,
      source: plantMeta.current.source,
      pace: current.current.prefs.pace,
      active: m.active,
      above: m.stats.above,
      scoreSum: m.stats.scoreSum,
      driveSum: m.stats.driveSum,
      growth: m.growth,
      reached: m.stats.reached,
      note: noteRef.current.trim(),
    };
    setLog((l) => {
      const next = [...l, entry];
      saveLog(next);
      return next;
    });
  }

  // Explicit resets (new plant, new session, recalibration) archive the old plant
  // for the tuning log, then restore the initial state.
  const firstReset = useRef(props.reset);
  useEffect(() => {
    if (props.reset === firstReset.current) return;
    firstReset.current = props.reset;
    archivePlant();
    plantMeta.current = {
      startedAt: new Date().toISOString(),
      source: props.sourceId,
    };
    setNote("");
    model.current = freshSnapshot(
      model.current.time,
      model.current.motion,
      model.current.guide,
    );
    setSnap(model.current);
    setHistory([]);
  }, [props.reset]);

  // Settle-in starts: align the breath clock so the guided breaths begin cleanly.
  const stageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!props.intro) return;
    stageRef.current?.scrollIntoView({ block: "center" });
    introFired.current = false;
    model.current = { ...model.current, intro: 0, time: INTRO_CLOCK_START };
    setSnap(model.current);
  }, [props.intro]);

  // Render loop: runs only while the garden is on screen. Time-based, dt bounded,
  // timing restarts after every pause so nothing catches up.
  useEffect(() => {
    if (!props.shown) {
      void audio.suspend();
      return;
    }
    if (current.current.prefs.sound) void audio.start();
    let raf = 0;
    let last = performance.now();
    let lastAudio = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const c = current.current;
      const m = model.current;
      let next: Snapshot = m;
      if (c.live && c.score !== null) {
        const g = stepGarden(m, dt, c.score, c.prefs.pace);
        next = {
          ...m,
          ...g,
          sun: m.sun + (g.response - m.sun) * (1 - Math.exp(-dt / 2.5)),
        };
        if (c.prefs.sound) {
          LIGHT_STEPS.forEach((step, i) => {
            if (m.growth < step && g.growth >= step) audio.chime(i % 5, 0.45);
          });
          MILESTONES.forEach((step, i) => {
            if (m.growth < step && g.growth >= step) audio.milestone(i);
          });
        }
      }
      const awake = c.live || c.intro;
      const target = awake && !c.reducedMotion ? 1 : 0;
      let motion =
        next.motion + (target - next.motion) * (1 - Math.exp(-dt / 0.7));
      if (motion < 0.003) motion = 0;
      // In the settle-in the ring appears with "Follow the light"; in play it is optional.
      const guideTarget =
        (c.intro && next.intro >= INTRO_STEPS[2].at - 1) ||
        (c.live && c.prefs.guide)
          ? 1
          : 0;
      let guide =
        next.guide + (guideTarget - next.guide) * (1 - Math.exp(-dt / 0.8));
      if (guide < 0.003) guide = 0;
      let intro = next.intro;
      if (c.intro) {
        intro += dt;
        if (intro >= INTRO_SECONDS && !introFired.current) {
          introFired.current = true;
          c.onIntroDone();
        }
      }
      const ticking = awake || motion > 0 || guide > 0;
      if (ticking || next !== m) {
        model.current = {
          ...next,
          motion,
          guide,
          intro,
          time: next.time + (ticking ? dt : 0),
        };
        setSnap(model.current);
        if (c.live) setChartNow(performance.now());
      }
      if (now - lastAudio > 100) {
        lastAudio = now;
        audio.update({
          on: c.prefs.sound && awake,
          response: c.live ? model.current.response : 0.5,
          breath: breathAt(model.current.time).level,
          volume: c.prefs.volume,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.shown]);

  // Sound needs a user gesture before browsers allow it. If sound was left on
  // from an earlier visit, the next click or key press anywhere wakes it.
  useEffect(() => {
    if (!props.prefs.sound || !props.shown) return;
    const wake = () => void audio.start();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [props.prefs.sound, props.shown]);
  useEffect(() => () => audio.dispose(), [audio]);

  // History records each published frame while running, and a gap otherwise.
  // A stale score is never repeated: one point per new frame sequence only.
  useEffect(() => {
    if (!props.shown && !props.live) return;
    const t = performance.now();
    setHistory((h) =>
      pushHistory(
        h,
        t,
        props.live && props.score !== null ? props.score : null,
      ),
    );
  }, [props.frameSeq, props.live]);

  const ms = milestone(snap.growth);
  const level = props.score === null ? null : Math.round(props.score * 100);
  const showLevel = props.live && level !== null;
  const headline = props.intro
    ? "Settling in."
    : !props.started
      ? "Plant a seed."
      : props.live
        ? ms.full
          ? "Fully bloomed."
          : `${STAGE_LABEL[ms.stage]}.`
        : "Garden paused.";
  const breath = breathAt(snap.time);
  const showCue =
    snap.guide > 0.02 &&
    (props.live || (props.intro && snap.intro >= INTRO_STEPS[2].at));

  function toggleSound() {
    const on = !props.prefs.sound;
    props.setPrefs({ sound: on });
    if (on) void audio.start();
    else void audio.suspend();
  }

  return (
    <div className="garden-page">
      <div className="garden-title">
        <div>
          <h1>Glowing Garden</h1>
          <p>
            Higher relative alpha compared with your baseline increases the
            glow. Sustained higher input grows the plant. Growth is yours to
            keep during this session.
          </p>
        </div>
        <button className="secondary change-game" onClick={props.onChangeGame}>
          Change game
        </button>
      </div>
      <div className="garden-layout">
        <div className="garden-main">
          <section
            className="garden-stage"
            aria-label="Garden scene"
            ref={stageRef}
          >
            <div
              className={`garden-scene ${props.intro ? "settling" : ""}`}
              role="img"
              aria-label={`A ${STAGE_LABEL[ms.stage].toLowerCase()} plant at ${Math.round(snap.growth * 100)}% growth, glowing at ${Math.round(snap.response * 100)}% response${props.live ? "" : props.intro ? ", settling in" : ", paused"}.`}
            >
              <GardenScene
                growth={snap.growth}
                response={snap.response}
                sun={snap.sun}
                time={snap.time}
                motion={snap.motion}
                paused={!props.live && !props.intro}
                guide={snap.guide}
                reduced={reducedMotion}
              />
              <span
                className={`garden-badge ${props.live || props.intro ? "live" : ""}`}
              >
                {props.sourceLabel} ·{" "}
                {props.intro
                  ? "settling in"
                  : props.live
                    ? "growing"
                    : "paused"}
              </span>
              {props.intro && (
                <IntroOverlay elapsed={snap.intro} onSkip={props.onIntroDone} />
              )}
              {showCue && (
                <BreathCue
                  phase={breath.phase}
                  progress={breath.progress}
                  strength={snap.guide}
                />
              )}
              {!props.live && !props.intro && (
                <div className="garden-overlay" role="status">
                  <p>
                    {props.started || !props.canStart
                      ? props.statusMessage
                      : "Your plant is ready. Start when you are settled."}
                  </p>
                  {props.started ? (
                    <button
                      disabled={!props.canResume}
                      onClick={props.onResume}
                    >
                      Resume garden
                    </button>
                  ) : (
                    <button
                      disabled={!props.canStart}
                      onClick={props.onNewPlant}
                    >
                      Start growing
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
          <GardenChart
            history={history}
            now={chartNow}
            simulation={props.simulation}
          />
        </div>
        <aside className="garden-feedback">
          <h2>{headline}</h2>
          <div className="meter-block">
            <div className="meter-row">
              <span>Signal level</span>
              <b>{showLevel ? `${level}%` : "—"}</b>
            </div>
            <div className="meter" aria-hidden="true">
              <div
                className="meter-fill"
                style={{ width: `${showLevel ? level : 0}%` }}
              />
              <div className="meter-mark" />
            </div>
            <p className="meter-note">
              Game input. The mark is the{" "}
              {props.simulation ? "demo midpoint" : "baseline score"}.
            </p>
          </div>
          <div className="feedback-row">
            <span>Relative to baseline</span>
            <b>
              {props.simulation
                ? "Simulation input — no EEG baseline"
                : props.live && props.relation
                  ? {
                      below: "Below baseline",
                      near: "Near baseline",
                      above: "Above baseline",
                    }[props.relation]
                  : "—"}
            </b>
          </div>
          <div className="meter-block">
            <div className="meter-row">
              <span>Growth · {STAGE_LABEL[ms.stage]}</span>
              <b>{Math.round(snap.growth * 100)}%</b>
            </div>
            <div className="meter growth" aria-hidden="true">
              <div
                className="meter-fill"
                style={{ width: `${ms.progress * 100}%` }}
              />
            </div>
            <p className="meter-note">
              {ms.label}
              {ms.full ? "" : ` · ${Math.round(ms.progress * 100)}%`}
            </p>
          </div>
          <div className="feedback-row">
            <span>Active time</span>
            <b>{duration(snap.active)}</b>
          </div>
          <div className="garden-actions">
            {props.intro ? (
              <button onClick={props.onIntroDone}>Skip settle-in</button>
            ) : props.live ? (
              <button onClick={props.onPause}>Pause</button>
            ) : props.started ? (
              <button disabled={!props.canResume} onClick={props.onResume}>
                Resume garden
              </button>
            ) : (
              <button disabled={!props.canStart} onClick={props.onNewPlant}>
                Start growing
              </button>
            )}
            <button
              className="secondary"
              disabled={!props.canStart || !props.started || props.intro}
              onClick={props.onNewPlant}
            >
              Start new plant
            </button>
            <button className="secondary" onClick={props.onInspect}>
              Inspect baseline & signal
            </button>
          </div>
          <div
            className="garden-switches"
            role="group"
            aria-label="Garden settings"
          >
            <Switch
              label="Ambient sound"
              on={props.prefs.sound}
              onToggle={toggleSound}
            />
            {props.prefs.sound && (
              <label className="volume">
                <span>Volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={props.prefs.volume}
                  onChange={(e) =>
                    props.setPrefs({ volume: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <Switch
              label="Breathing guide"
              on={props.prefs.guide}
              onToggle={() => props.setPrefs({ guide: !props.prefs.guide })}
            />
            <Switch
              label="Settle in before each plant"
              on={props.prefs.settleIn}
              onToggle={() =>
                props.setPrefs({ settleIn: !props.prefs.settleIn })
              }
            />
          </div>
          <p className="hint">
            A lower signal dims the light but never takes leaves away. Missing
            or rejected input pauses the garden until you resume.
          </p>
        </aside>
      </div>
      <GardenTuning
        prefs={props.prefs}
        setPrefs={props.setPrefs}
        snap={snap}
        started={props.started}
        sourceId={props.sourceId}
        log={log}
        note={note}
        setNote={setNote}
        onClear={() => {
          setLog([]);
          saveLog([]);
        }}
      />
      {props.evidence}
    </div>
  );
}

function Switch({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch ${on ? "on" : ""}`}
      onClick={onToggle}
    >
      <span>{label}</span>
      <i aria-hidden="true" />
    </button>
  );
}

function IntroOverlay({
  elapsed,
  onSkip,
}: {
  elapsed: number;
  onSkip: () => void;
}) {
  const index = INTRO_STEPS.reduce((k, s, i) => (elapsed >= s.at ? i : k), 0);
  const step = INTRO_STEPS[index];
  return (
    <div className="intro-overlay" role="status" aria-live="polite">
      <div className="intro-copy" key={index}>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
      </div>
      <div className="intro-foot">
        <div
          className="intro-progress"
          aria-label={`Settle-in ${Math.round((elapsed / INTRO_SECONDS) * 100)}% complete`}
        >
          <div
            style={{
              width: `${Math.min(100, (elapsed / INTRO_SECONDS) * 100)}%`,
            }}
          />
        </div>
        <button className="secondary" onClick={onSkip}>
          Begin now
        </button>
      </div>
    </div>
  );
}

function BreathCue({
  phase,
  progress,
  strength,
}: {
  phase: "in" | "out";
  progress: number;
  strength: number;
}) {
  // Fade each word in and out at phase boundaries so the change reads calmly.
  const edge = Math.min(progress / 0.12, (1 - progress) / 0.12, 1);
  return (
    <div
      className="breath-cue"
      style={{ opacity: Math.max(0, edge) * strength }}
      aria-hidden="true"
    >
      {phase === "in" ? "Breathe in" : "Breathe out"}
    </div>
  );
}

function GardenTuning({
  prefs,
  setPrefs,
  snap,
  started,
  sourceId,
  log,
  note,
  setNote,
  onClear,
}: {
  prefs: GardenPrefs;
  setPrefs: (p: Partial<GardenPrefs>) => void;
  snap: Snapshot;
  started: boolean;
  sourceId: string;
  log: PlantLog[];
  note: string;
  setNote: (n: string) => void;
  onClear: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const current =
    started && snap.active > 0
      ? [
          {
            active: snap.active,
            driveSum: snap.stats.driveSum,
            source: sourceId,
          },
        ]
      : [];
  const all = [...log, ...current];
  const eeg = all.filter((e) => e.source !== "synthetic");
  const basis = eeg.length ? eeg : all;
  const insight = paceInsight(basis, prefs.pace, prefs.targetMinutes);
  const simOnly = !eeg.length && basis.length > 0;
  const remaining =
    snap.active > 10 && snap.stats.driveSum > 0
      ? ((1 - snap.growth) * prefs.pace) / (snap.stats.driveSum / snap.active)
      : null;
  function download() {
    const blob = new Blob([logToCsv(log)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `glowing-garden-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details className="garden-tuning">
      <summary>Facilitator: growth pace and session log</summary>
      <div className="tuning-grid">
        <section>
          <h3>Growth pace</h3>
          <label className="pace-label" htmlFor="pace">
            Full bloom after <b>{prefs.pace} s</b> of full signal
          </label>
          <input
            id="pace"
            type="range"
            min={PACE_MIN}
            max={PACE_MAX}
            step={5}
            value={prefs.pace}
            onChange={(e) => setPrefs({ pace: Number(e.target.value) })}
          />
          <div className="pace-presets">
            {PACE_PRESETS.map((p) => (
              <button
                key={p.pace}
                className="secondary small-button"
                aria-pressed={prefs.pace === p.pace}
                onClick={() => setPrefs({ pace: p.pace })}
              >
                {p.label} · {p.pace}s
              </button>
            ))}
          </div>
          <p className="meter-note">
            At 75% signal that is {duration(prefs.pace * 2)}. Changes apply to
            growth from now on; earned growth is kept.
          </p>
          <dl className="tuning-stats">
            <dt>This plant · active</dt>
            <dd>{duration(snap.active)}</dd>
            <dt>Time above baseline score</dt>
            <dd>
              {snap.active > 0
                ? `${Math.round((100 * snap.stats.above) / snap.active)}%`
                : "—"}
            </dd>
            <dt>Mean signal</dt>
            <dd>
              {snap.active > 0
                ? `${Math.round((100 * snap.stats.scoreSum) / snap.active)}%`
                : "—"}
            </dd>
            <dt>Projected full bloom</dt>
            <dd>
              {snap.growth >= 1
                ? "Bloomed"
                : remaining === null
                  ? "—"
                  : `in about ${duration(remaining)}`}
            </dd>
          </dl>
        </section>
        <section>
          <h3>Tune from real sessions</h3>
          {insight ? (
            <>
              <p className="meter-note">
                Based on {basis.length} plant{basis.length === 1 ? "" : "s"} and{" "}
                {duration(insight.active)} of play
                {simOnly
                  ? " — simulation only. Try it with the headset for real numbers."
                  : " with EEG input."}
              </p>
              <label className="pace-label" htmlFor="target">
                Typical player should bloom in
              </label>
              <div className="target-row">
                <input
                  id="target"
                  type="number"
                  min={1}
                  max={30}
                  value={prefs.targetMinutes}
                  onChange={(e) =>
                    setPrefs({ targetMinutes: Number(e.target.value) })
                  }
                />
                <span>minutes</span>
              </div>
              <dl className="tuning-stats">
                <dt>Typical bloom at current pace</dt>
                <dd>
                  {Number.isFinite(insight.bloomMinutes)
                    ? `${insight.bloomMinutes.toFixed(1)} min`
                    : "Never (no time above baseline)"}
                </dd>
                <dt>Suggested pace</dt>
                <dd>{insight.suggested} s</dd>
              </dl>
              <button
                className="secondary"
                disabled={insight.suggested === prefs.pace}
                onClick={() => setPrefs({ pace: insight.suggested })}
              >
                Apply suggested pace
              </button>
            </>
          ) : (
            <p className="meter-note">
              Play for at least 30 seconds to see how long a typical bloom
              takes, and get a suggested pace for your target session length.
            </p>
          )}
          <label className="pace-label" htmlFor="plant-note">
            Note for this plant
          </label>
          <input
            id="plant-note"
            type="text"
            maxLength={80}
            placeholder="e.g. P3 · headset · eyes open"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="meter-note">
            Avoid names; use participant codes. Saved with the plant when you
            start a new one.
          </p>
        </section>
      </div>
      <div className="log-head">
        <h3>Session log</h3>
        <div className="log-actions">
          <button
            className="secondary small-button"
            disabled={!log.length}
            onClick={download}
          >
            Download CSV
          </button>
          <button
            className="secondary small-button"
            disabled={!log.length}
            onClick={() => {
              if (confirmClear) {
                onClear();
                setConfirmClear(false);
              } else setConfirmClear(true);
            }}
            onBlur={() => setConfirmClear(false)}
          >
            {confirmClear ? "Confirm clear" : "Clear log"}
          </button>
        </div>
      </div>
      {log.length ? (
        <div className="log-table">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Source</th>
                <th>Pace</th>
                <th>Active</th>
                <th>Above</th>
                <th>Mean</th>
                <th>Growth</th>
                <th>Bloom at</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {log
                .map((e, i) => ({ e, i }))
                .slice(-8)
                .reverse()
                .map(({ e, i }) => (
                  <tr key={e.id + i}>
                    <td>{i + 1}</td>
                    <td>{e.source}</td>
                    <td>{e.pace}s</td>
                    <td>{duration(e.active)}</td>
                    <td>{Math.round((100 * e.above) / e.active)}%</td>
                    <td>{Math.round((100 * e.scoreSum) / e.active)}%</td>
                    <td>{Math.round(100 * e.growth)}%</td>
                    <td>
                      {e.reached[2] === null ? "—" : duration(e.reached[2])}
                    </td>
                    <td>{e.note}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="meter-note">
          Each plant is logged here (in this browser only) when a new one
          starts. No EEG is stored, only game totals.
        </p>
      )}
    </details>
  );
}

function GardenChart({
  history,
  now,
  simulation,
}: {
  history: HistoryPoint[];
  now: number;
  simulation: boolean;
}) {
  const span = HISTORY_SECONDS * 1000;
  const x = (t: number) => ((t - (now - span)) / span) * 1000;
  const y = (s: number) => 110 - s * 100;
  let d = "";
  let down = false;
  for (const p of history) {
    if (p.score === null || p.t < now - span) {
      down = false;
      continue;
    }
    d += `${down ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.score).toFixed(1)}`;
    down = true;
  }
  const values = history
    .filter((p) => p.score !== null && p.t >= now - span)
    .map((p) => p.score!);
  const mean = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
  const gaps = history.filter(
    (p) => p.score === null && p.t >= now - span,
  ).length;
  const summary = values.length
    ? `Last 60 seconds: ${values.length} samples, average ${Math.round(mean! * 100)}%, latest ${Math.round(values[values.length - 1] * 100)}%, ${gaps} gap${gaps === 1 ? "" : "s"}.`
    : "No input recorded in the last 60 seconds.";
  return (
    <section className="garden-chart">
      <div className="chart-heading">
        <h2>Recent signal</h2>
        <span>Last 60 seconds · game input</span>
      </div>
      <svg
        viewBox="0 0 1000 120"
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
      >
        <line
          x1="0"
          x2="1000"
          y1={y(0.5)}
          y2={y(0.5)}
          stroke="#6f8f93"
          strokeDasharray="6 6"
        />
        <path
          d={d}
          fill="none"
          stroke="#8ff1d0"
          strokeWidth="2.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="chart-caption">
        Dashed line: {simulation ? "demo midpoint" : "baseline score"} (50%).
        Breaks mean paused or invalid input. {summary}
      </p>
    </section>
  );
}
