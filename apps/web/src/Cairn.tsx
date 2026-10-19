import { useEffect, useRef, useState, type ReactNode } from "react";
import CairnStage, { BUG_HZ, type CairnView, type StageStimulus } from "./CairnStage";
import PaperNumber from "./PaperNumber";
import {
  initialCairn,
  fallAngle,
  dropSway,
  gustLoad,
  tierOf,
  STEADY_SWAY,
  GO_APPROACH,
  GO_WAIT,
  type CairnMode,
} from "./cairnSimulation";
import {
  bestKey,
  stimulusCsv,
  type CairnRecord,
  type CairnRound,
  type CairnStimulus,
} from "./cairnScores";
import { duration } from "./SignalPanel";

export type CairnProps = {
  /** Every tick gate passes: selected, play page, running, visible, fresh, usable, same session. */
  live: boolean;
  /** The Cairn page is on screen; the stage sleeps otherwise. */
  shown: boolean;
  score: number | null;
  reset: number;
  mode: CairnMode;
  started: boolean;
  canResume: boolean;
  canStart: boolean;
  statusMessage: string;
  sourceId: string;
  sourceLabel: string;
  simulation: boolean;
  record: CairnRecord;
  onRound: (round: CairnRound) => void;
  /** Turn the bugs' SSVEP blinking on or off. */
  onFlicker: (on: boolean) => void;
  /** A stretch of blinking ended; log it for lining up with EEG. */
  onStimulus: (s: CairnStimulus) => void;
  /** Start a new cairn, optionally in another mode. */
  onStart: (mode?: CairnMode) => void;
  onPause: () => void;
  onResume: () => void;
  onChangeGame: () => void;
  onInspect: () => void;
  evidence: ReactNode;
};

const MODE_INFO: Record<CairnMode, { title: string; text: string }> = {
  calm: {
    title: "Calm",
    text: "The hand only moves while the tower is still: a stone every 3 seconds when you stay focused.",
  },
  go: {
    title: "Go",
    text: "A stone every 6 seconds, ready or not. If it lands while the tower is swaying, the whole cairn falls.",
  },
};

function swayLabel(view: CairnView) {
  if (view.fallen) return "Fallen";
  if (view.sway < STEADY_SWAY) return "Steady";
  if (view.sway < dropSway(view.stones, gustLoad(view))) return "Swaying";
  return "Toppling";
}

/** What the hand is doing, and any passing bug or gust, in words, for the stage badge. */
function handNote(view: CairnView, live: boolean) {
  if (view.fallen || !live) return "";
  const event =
    view.event?.kind === "gust" ? " · a gust!" : view.event?.kind === "bug" ? " · a firefly" : "";
  if (view.mode === "go") {
    const left =
      view.phase === "wait"
        ? GO_WAIT - view.phaseTime + GO_APPROACH
        : view.phase === "approach"
          ? (1 - view.approach) * GO_APPROACH
          : 0;
    return (left > 0 ? `next stone in ${left.toFixed(1)} s` : "stone placed") + event;
  }
  if (view.phase === "approach" && view.sway >= STEADY_SWAY)
    return "the hand waits for stillness" + event;
  return (view.phase === "approach" ? "bringing a stone" : "stone placed") + event;
}

/** Degrees, for showing the topple limit. */
const degrees = (rad: number) => (rad * 180) / Math.PI;

export default function Cairn(props: CairnProps) {
  const [view, setView] = useState<CairnView>(() => ({
    ...initialCairn(props.mode),
    collapse: 0,
    settled: false,
  }));
  const reducedMotion = usePrefersReducedMotion();
  const best = props.record.best[bestKey(props.sourceId, props.mode)] ?? 0;
  const roundMeta = useRef({
    at: new Date().toISOString(),
    source: props.sourceId,
    recorded: false,
    bestBefore: best,
  });
  const latest = useRef(view);
  latest.current = view;
  const onRound = useRef(props.onRound);
  onRound.current = props.onRound;
  // Stimuli are tagged with the mode and source playing when the blinking ended.
  const logStimulus = useRef<(s: StageStimulus) => void>(() => {});
  logStimulus.current = (s) => props.onStimulus({ ...s, mode: props.mode, source: props.sourceId });

  function record(v: CairnView, ending: CairnRound["ending"]) {
    const meta = roundMeta.current;
    if (meta.recorded || v.stones <= 0) return;
    meta.recorded = true;
    onRound.current({
      at: meta.at,
      mode: v.mode,
      source: meta.source,
      stones: v.stones,
      seconds: v.elapsed,
      steady: v.elapsed > 0 ? v.steadyTime / v.elapsed : 0,
      ending,
    });
  }

  // A fallen cairn is scored once; a cairn abandoned for a new one is scored as ended.
  useEffect(() => {
    if (view.fallen && view.cause) record(view, view.cause);
  }, [view.fallen]);
  const firstReset = useRef(props.reset);
  useEffect(() => {
    if (props.reset === firstReset.current) return;
    firstReset.current = props.reset;
    record(latest.current, "ended");
    roundMeta.current = {
      at: new Date().toISOString(),
      source: props.sourceId,
      recorded: false,
      bestBefore: best,
    };
  }, [props.reset]);

  const recent = props.record.rounds.slice(-5).reverse();
  const level = props.score === null ? null : Math.round(props.score * 100);
  const showLevel = props.live && level !== null;
  const fallenNow = props.started && view.fallen;
  const headline = !props.started
    ? "Build a cairn."
    : fallenNow
      ? view.settled
        ? "The cairn fell."
        : "Timber!"
      : props.live
        ? view.event?.kind === "gust"
          ? "Gust! Hold it still."
          : swayLabel(view) === "Steady"
            ? "Steady hands."
            : "Hold it still."
        : "Cairn paused.";
  const note = handNote(view, props.live);
  // The sway gauge runs up to the current topple limit, which shrinks every five stones and in gusts.
  const gust = gustLoad(view);
  const limit = fallAngle(view.stones, gust);
  const gauge = (sway: number) => `${Math.min(100, (sway / limit) * 100)}%`;
  const flickerOn = props.record.flicker && !reducedMotion;

  function downloadStimuli() {
    const url = URL.createObjectURL(new Blob([stimulusCsv(props.record.stimuli)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cairn-flicker-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cairn-page">
      <div className="garden-title">
        <div>
          <h1>Cairn</h1>
          <p>
            Higher relative alpha compared with your baseline keeps the stack
            still. Distraction lets it sway, and a long sway topples it. Every
            stone is a point; every fifth makes the cairn touchier, and
            fireflies and gusts come more often as it grows.
          </p>
        </div>
        <button className="secondary change-game" onClick={props.onChangeGame}>
          Change game
        </button>
      </div>
      <div className="garden-layout">
        <section className="cairn-stage" aria-label="Cairn scene">
          <div className="cairn-frame">
            {props.started || props.shown ? (
              <CairnStage
                active={props.shown}
                controls={{
                  running: props.live && props.started,
                  score: props.score ?? 0.5,
                  reset: props.reset,
                  mode: props.mode,
                  flicker: flickerOn,
                  reducedMotion,
                }}
                onState={setView}
                onStimulus={(s) => logStimulus.current(s)}
              />
            ) : null}
            <span className={`cairn-badge ${props.live ? "live" : ""}`}>
              {props.sourceLabel} · {MODE_INFO[props.mode].title} mode
              {note ? ` · ${note}` : props.live ? "" : " · paused"}
            </span>
            <div className="cairn-tag" aria-live="polite">
              <PaperNumber value={view.stones} />
              <span>{view.stones === 1 ? "stone" : "stones"}</span>
            </div>
            {fallenNow && view.settled && (
              <div className="cairn-overlay result" role="status">
                <p>
                  <b>
                    {view.stones} {view.stones === 1 ? "stone" : "stones"}
                  </b>
                  {view.cause === "drop"
                    ? "A stone landed on a swaying tower."
                    : "The sway grew too big and the stack slid off."}
                  {view.stones > roundMeta.current.bestBefore ? " New best!" : ""}
                </p>
                <button disabled={!props.canStart} onClick={() => props.onStart()}>
                  Stack again
                </button>
              </div>
            )}
            {!props.live && !fallenNow && (
              <div className="cairn-overlay" role="status">
                <p>
                  {props.started || !props.canStart
                    ? props.statusMessage
                    : "Sit comfortably and rest your eyes on the stones. Start when you are settled."}
                </p>
                {props.started ? (
                  <button disabled={!props.canResume} onClick={props.onResume}>
                    Resume
                  </button>
                ) : (
                  <button disabled={!props.canStart} onClick={() => props.onStart()}>
                    Start stacking
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
        <aside className="garden-feedback cairn-feedback">
          <div className="cairn-scorecard">
            <div>
              <small>STONES</small>
              <PaperNumber value={view.stones} />
            </div>
            <div>
              <small>BEST · {MODE_INFO[props.mode].title.toUpperCase()}</small>
              <PaperNumber value={best} />
            </div>
          </div>
          <h2>{headline}</h2>
          <div className="cairn-modes" role="radiogroup" aria-label="Game mode">
            {(["calm", "go"] as CairnMode[]).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={props.mode === m}
                className={`secondary ${props.mode === m ? "chosen" : ""}`}
                disabled={!props.canStart && props.mode !== m}
                onClick={() => props.mode !== m && props.onStart(m)}
              >
                {MODE_INFO[m].title}
              </button>
            ))}
          </div>
          <p className="meter-note">
            {MODE_INFO[props.mode].text}
            {props.started && !view.fallen && view.stones > 0 ? " Switching mode starts a new cairn." : ""}
          </p>
          <div className="meter-block">
            <div className="meter-row">
              <span>Sway</span>
              <b>{props.started ? swayLabel(view) : "—"}</b>
            </div>
            <div className="meter sway" aria-hidden="true">
              <div
                className={`meter-fill ${view.sway >= dropSway(view.stones, gust) ? "danger" : view.sway >= STEADY_SWAY ? "warn" : ""}`}
                style={{ width: gauge(view.sway) }}
              />
              <div className="meter-mark" style={{ left: gauge(STEADY_SWAY) }} />
              {props.mode === "go" && (
                <div className="meter-mark danger" style={{ left: gauge(dropSway(view.stones, gust)) }} />
              )}
            </div>
            <p className="meter-note">
              {props.mode === "calm"
                ? "Left of the mark is steady: the hand moves only then."
                : "Past the red mark a landing stone knocks the cairn over."}{" "}
              The bar's end is the fall: level {tierOf(view.stones) + 1} topples at{" "}
              {degrees(limit).toFixed(1)}°{gust > 0.02 ? " while the gust blows" : ""}.
            </p>
          </div>
          <div className="meter-block">
            <div className="meter-row">
              <span>Signal level</span>
              <b>{showLevel ? `${level}%` : "—"}</b>
            </div>
            <div className="meter" aria-hidden="true">
              <div className="meter-fill" style={{ width: `${showLevel ? level : 0}%` }} />
              <div className="meter-mark" />
            </div>
            <p className="meter-note">
              Game input. The mark is the {props.simulation ? "demo midpoint" : "baseline score"}.
            </p>
          </div>
          <div className="feedback-row">
            <span>Time this cairn</span>
            <b>{duration(view.elapsed)}</b>
          </div>
          <div className="garden-actions">
            {fallenNow ? (
              <button disabled={!props.canStart} onClick={() => props.onStart()}>
                Stack again
              </button>
            ) : props.live ? (
              <button onClick={props.onPause}>Pause</button>
            ) : props.started ? (
              <button disabled={!props.canResume} onClick={props.onResume}>
                Resume
              </button>
            ) : (
              <button disabled={!props.canStart} onClick={() => props.onStart()}>
                Start stacking
              </button>
            )}
            <button
              className="secondary"
              disabled={!props.canStart || !props.started || fallenNow}
              onClick={() => props.onStart()}
            >
              Start a new cairn
            </button>
            <button className="secondary" onClick={props.onInspect}>
              Inspect baseline & signal
            </button>
          </div>
          <div className="cairn-flicker">
            <label>
              <input
                type="checkbox"
                checked={flickerOn}
                disabled={reducedMotion}
                onChange={(e) => props.onFlicker(e.target.checked)}
              />
              Fireflies blink at {BUG_HZ} Hz (SSVEP)
            </label>
            <p className="meter-note">
              {reducedMotion
                ? "Off while your system asks for reduced motion."
                : "Flashing light can trigger seizures in people with photosensitive epilepsy. Turn this on only for players who have agreed to it. Off, the fireflies glow and pulse slowly."}
            </p>
            {props.record.stimuli.length > 0 && (
              <button className="secondary" onClick={downloadStimuli}>
                Download flicker log ({props.record.stimuli.length})
              </button>
            )}
          </div>
          {recent.length > 0 && (
            <div className="cairn-recent">
              <h3>Recent cairns</h3>
              <ol>
                {recent.map((r) => (
                  <li key={r.at + r.stones}>
                    <b>{r.stones}</b>
                    <span>
                      {MODE_INFO[r.mode].title} · {duration(r.seconds)} ·{" "}
                      {r.ending === "drop" ? "dropped on a sway" : r.ending === "sway" ? "swayed over" : "ended"}
                      {r.source === "synthetic" ? " · simulation" : r.source === "replay" ? " · recording" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="hint">
            Missing or rejected input pauses the cairn until you resume. A
            recording ending is not a fall.
          </p>
        </aside>
      </div>
      {props.evidence}
    </div>
  );
}

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
