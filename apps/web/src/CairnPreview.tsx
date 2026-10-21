// Development-only test bench (npm run dev, then open /?cairn-preview).
// Plays Cairn from recorded EEG game input without the backend, so the club can
// test and tune the game against real sessions. Not reachable in production builds.
//   ?cairn-preview                          recorded trace, calm mode
//   ?cairn-preview&mode=go&speed=4          go mode at 4x
//   ?cairn-preview&input=slider&score=0.6   hold a fixed score
//   ?cairn-preview&input=sine               the backend's simulation signal
//   ?cairn-preview&flicker=1                fireflies blink at the SSVEP rate
// Traces come from `python -m backend.score_trace` (tests/fixtures/cairn/*.json),
// or load any trace file with the file picker.
import { useEffect, useRef, useState } from "react";
import CairnStage, { BUG_HZ, type CairnControls, type CairnView } from "./CairnStage";
import PaperNumber from "./PaperNumber";
import { initialCairn, fallAngle, gustLoad, tierOf, type CairnMode } from "./cairnSimulation";
import { duration } from "./SignalPanel";

type Trace = { recording: string; rate_hz: number; score: number[]; usable: number[] };
type Input = "trace" | "slider" | "sine";

const bundled = import.meta.glob<Trace>("../../../tests/fixtures/cairn/*.json", {
  eager: true,
  import: "default",
});
// Built on demand so production bundles, which never render the bench, drop the data.
const bundledTraces = (): Record<string, Trace> =>
  Object.fromEntries(Object.entries(bundled).map(([path, t]) => [path.split("/").pop()!, t]));
const SPEEDS = [1, 2, 4, 8];

export default function CairnPreview() {
  const params = new URLSearchParams(location.search);
  const [input, setInput] = useState<Input>((params.get("input") as Input) ?? "trace");
  const [traces, setTraces] = useState(bundledTraces);
  const [traceName, setTraceName] = useState(() => Object.keys(traces)[0] ?? "");
  const [slider, setSlider] = useState(Number(params.get("score") ?? 0.6));
  const [mode, setMode] = useState<CairnMode>(params.get("mode") === "go" ? "go" : "calm");
  const [speed, setSpeed] = useState(Number(params.get("speed") ?? 1));
  const [playing, setPlaying] = useState(true);
  const [reset, setReset] = useState(0);
  const [position, setPosition] = useState(Number(params.get("at") ?? 0));
  const [flicker, setFlicker] = useState(params.get("flicker") === "1");
  const [event, setEvent] = useState<CairnControls["debugEvent"]>();
  const [strength, setStrength] = useState(0.5);
  const [view, setView] = useState<CairnView>({ ...initialCairn(mode), collapse: 0, settled: false });
  const trace = traces[traceName];
  const traceSeconds = trace ? trace.score.length / trace.rate_hz : 0;

  // The bench owns its clock: trace position and the sine advance with play speed.
  const clock = useRef({ position, playing, speed });
  clock.current = { position, playing, speed };
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = clock.current;
      if (c.playing) setPosition((p) => p + dt * c.speed);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const frame = trace ? Math.min(trace.score.length - 1, Math.floor(position * trace.rate_hz)) : 0;
  const ended = input === "trace" && (!trace || position >= traceSeconds);
  const usable = input !== "trace" || (!ended && trace.usable[frame] === 1);
  const score =
    input === "slider"
      ? slider
      : input === "sine"
        ? 0.5 + 0.4 * Math.sin(position * 0.4)
        : trace
          ? trace.score[frame]
          : 0.5;

  function restart(m = mode) {
    setMode(m);
    setReset((r) => r + 1);
  }

  async function load(file: File) {
    const t = JSON.parse(await file.text()) as Trace;
    if (!Array.isArray(t.score) || !Array.isArray(t.usable) || !t.rate_hz) throw Error("Not a score trace");
    setTraces((all) => ({ ...all, [file.name]: t }));
    setTraceName(file.name);
    setPosition(0);
    restart();
  }

  return (
    <main className="cairn-preview">
      <p className="notice">Development test bench · not connected to the backend</p>
      <div className="garden-layout">
        <section className="cairn-stage">
          <div className="cairn-frame">
            <CairnStage
              controls={{ running: playing && usable, score, reset, mode, timeScale: speed, flicker, debugEvent: event }}
              onState={setView}
              onStimulus={(s) => console.info("flicker stimulus", s)}
            />
            <div className="cairn-tag">
              <PaperNumber value={view.stones} />
              <span>{view.stones === 1 ? "stone" : "stones"}</span>
            </div>
          </div>
        </section>
        <aside className="garden-feedback">
          <h2>
            {view.fallen
              ? `Fell (${view.cause}) at ${view.stones}`
              : `${view.stones} ${view.stones === 1 ? "stone" : "stones"}`}
          </h2>
          <div className="cairn-modes" role="radiogroup" aria-label="Input">
            {(["trace", "slider", "sine"] as Input[]).map((i) => (
              <button
                key={i}
                role="radio"
                aria-checked={input === i}
                className={`secondary ${input === i ? "chosen" : ""}`}
                onClick={() => setInput(i)}
              >
                {i === "trace" ? "Recording" : i === "slider" ? "Slider" : "Sine"}
              </button>
            ))}
          </div>
          {input === "trace" && (
            <>
              <label htmlFor="trace">Recorded game input</label>
              <select
                id="trace"
                value={traceName}
                onChange={(e) => {
                  setTraceName(e.target.value);
                  setPosition(0);
                  restart();
                }}
              >
                {Object.keys(traces).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <label>
                Position {duration(Math.min(position, traceSeconds))} / {duration(traceSeconds)}
                <input
                  type="range"
                  min={0}
                  max={traceSeconds}
                  step={0.25}
                  value={Math.min(position, traceSeconds)}
                  onChange={(e) => setPosition(Number(e.target.value))}
                />
              </label>
              <label htmlFor="trace-file">Load a trace file</label>
              <input
                id="trace-file"
                type="file"
                accept="application/json"
                onChange={(e) => e.target.files?.[0] && void load(e.target.files[0]).catch((err) => alert(err))}
              />
            </>
          )}
          {input === "slider" && (
            <label>
              Score {slider.toFixed(2)} (0.5 is the baseline)
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={slider}
                onChange={(e) => setSlider(Number(e.target.value))}
              />
            </label>
          )}
          <div className="cairn-modes" role="radiogroup" aria-label="Game mode">
            {(["calm", "go"] as CairnMode[]).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                className={`secondary ${mode === m ? "chosen" : ""}`}
                onClick={() => restart(m)}
              >
                {m === "calm" ? "Calm" : "Go"}
              </button>
            ))}
          </div>
          <div className="cairn-modes" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={speed === s}
                className={`secondary ${speed === s ? "chosen" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
          <label>
            Event strength {strength.toFixed(2)} (0 small and brief, 1 big and long)
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
            />
          </label>
          <div className="cairn-modes" aria-label="Trigger an event">
            {(
              [
                ["bug", "ground", "Crawling bug"],
                ["bug", "air", "Flying bug"],
                ["gust", "ground", "Gust"],
              ] as const
            ).map(([kind, path, label]) => (
              <button
                key={label}
                className="secondary"
                onClick={() => setEvent((e) => ({ kind, path, strength, nonce: (e?.nonce ?? 0) + 1 }))}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="cairn-flicker-inline">
            <input type="checkbox" checked={flicker} onChange={(e) => setFlicker(e.target.checked)} /> Blink
            at {BUG_HZ} Hz
          </label>
          <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
          <button className="secondary" onClick={() => restart()}>
            New cairn
          </button>
          <dl className="cairn-readout">
            <dt>Score</dt>
            <dd>{usable ? score.toFixed(3) : ended ? "recording ended" : "unusable frame"}</dd>
            <dt>Focus · unrest</dt>
            <dd>
              {view.focus.toFixed(2)} · {view.unrest.toFixed(2)}
            </dd>
            <dt>Sway · angle</dt>
            <dd>
              {view.sway.toFixed(3)} · {view.angle.toFixed(3)} rad
            </dd>
            <dt>Hand</dt>
            <dd>
              {view.phase} {view.phase === "approach" ? `${Math.round(view.approach * 100)}%` : ""}
            </dd>
            <dt>Level · topple limit</dt>
            <dd>
              {tierOf(view.stones) + 1} · {fallAngle(view.stones, gustLoad(view)).toFixed(3)} rad
            </dd>
            <dt>Event · next</dt>
            <dd>
              {view.event
                ? `${view.event.kind} ${view.event.path === "air" && view.event.kind === "bug" ? "(air) " : ""}${view.event.strength.toFixed(2)} · ${view.event.time.toFixed(1)}/${view.event.duration.toFixed(1)} s`
                : `none · at ${duration(view.nextEvent)}`}
            </dd>
            <dt>Round time · steady</dt>
            <dd>
              {duration(view.elapsed)} · {view.elapsed ? Math.round((100 * view.steadyTime) / view.elapsed) : 0}%
            </dd>
          </dl>
        </aside>
      </div>
    </main>
  );
}
