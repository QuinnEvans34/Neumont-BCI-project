import { useEffect, useRef, useState } from "react";
import Game from "./Game";
import Garden from "./Garden";
import Cairn from "./Cairn";
import GamePicker from "./GamePicker";
import { gameInfo, type GameId } from "./games/catalog";
import { initialWatch, observeReference, canTick } from "./games/lifecycle";
import { baselineRelation } from "./gardenSimulation";
import { usePrefs } from "./gardenPrefs";
import { addRound, addStimulus, useCairnRecord } from "./cairnScores";
import type { CairnMode } from "./cairnSimulation";
import SignalPanel, {
  Overview,
  duration,
  sourceName,
  streamMessage,
  type Recording,
  type Telemetry,
} from "./SignalPanel";
import { initialState } from "./simulation";
import { parseFrame, isUsable, type InputFrame } from "./input";
const API = "http://127.0.0.1:8000";
type Page = "setup" | "calibrate" | "choose" | "play";
type Options = {
  recordings: string[];
  ports: { device: string; description: string }[];
};
export default function App() {
  const [page, setPage] = useState<Page>("setup");
  const [source, setSource] = useState("replay");
  const [recording, setRecording] = useState("");
  const [port, setPort] = useState("");
  const [options, setOptions] = useState<Options>({
    recordings: [],
    ports: [],
  });
  const [preview, setPreview] = useState<Recording | null>(null);
  const [frame, setFrame] = useState<InputFrame | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(performance.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [hasRound, setHasRound] = useState(false);
  const [roundSession, setRoundSession] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [stats, setStats] = useState(initialState);
  const [game, setGame] = useState<GameId>("garden");
  const [gardenStarted, setGardenStarted] = useState(false);
  const [gardenRunning, setGardenRunning] = useState(false);
  const [gardenSession, setGardenSession] = useState<string | null>(null);
  const [gardenReset, setGardenReset] = useState(0);
  const [gardenIntro, setGardenIntro] = useState(false);
  const [gardenPrefs, setGardenPrefs] = usePrefs();
  const [cairnStarted, setCairnStarted] = useState(false);
  const [cairnRunning, setCairnRunning] = useState(false);
  const [cairnSession, setCairnSession] = useState<string | null>(null);
  const [cairnReset, setCairnReset] = useState(0);
  const [cairnRecord, updateCairnRecord] = useCairnRecord();
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState === "visible",
  );
  const watch = useRef(initialWatch());
  const initialized = useRef(false);
  // Comparison reference changed: every game loses progress bound to the old baseline.
  function invalidateGames() {
    setRunning(false);
    setHasRound(false);
    setRoundSession(null);
    setReset((v) => v + 1);
    setGardenRunning(false);
    setGardenStarted(false);
    setGardenSession(null);
    setGardenReset((v) => v + 1);
    setGardenIntro(false);
    setCairnRunning(false);
    setCairnStarted(false);
    setCairnSession(null);
    setCairnReset((v) => v + 1);
  }
  useEffect(() => {
    // A background tab or sleeping laptop pauses everything; return needs Resume.
    const onVisibility = () => {
      const shown = document.visibilityState === "visible";
      setVisible(shown);
      if (!shown) {
        setRunning(false);
        setGardenRunning(false);
        setCairnRunning(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  async function refresh() {
    try {
      const r = await fetch(`${API}/api/options`);
      if (!r.ok) throw Error("Cannot list inputs");
      const o: Options = await r.json();
      setOptions(o);
      setRecording((v) =>
        o.recordings.includes(v)
          ? v
          : (o.recordings.find((p) => p.endsWith("_2.csv")) ??
            o.recordings[0] ??
            ""),
      );
      setPort((v) => (o.ports.some((p) => p.device === v) ? v : ""));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!recording) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    setPreview(null);
    fetch(`${API}/api/recording?name=${encodeURIComponent(recording)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Unable to inspect recording");
        return r.json();
      })
      .then(setPreview)
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e));
      });
    return () => controller.abort();
  }, [recording]);
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;
    let socket: WebSocket;
    const connect = () => {
      socket = new WebSocket("ws://127.0.0.1:8000/ws/input");
      let sequence = -1;
      socket.onopen = () => {
        if (!disposed) setConnected(true);
      };
      socket.onmessage = (e) => {
        if (disposed) return;
        try {
          const raw = JSON.parse(e.data);
          const next = parseFrame(raw);
          if (next && next.sequence > sequence) {
            sequence = next.sequence;
            setFrame(next);
            setReceivedAt(performance.now());
            if (raw.telemetry) {
              const t: Telemetry = raw.telemetry;
              setTelemetry(t);
              if (!initialized.current && t.session_id) {
                initialized.current = true;
                setSource(t.source);
              }
            }
          }
        } catch {
          /* Invalid packets cannot make gameplay ready. */
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        setConnected(false);
        setFrame(null);
        setRunning(false);
        setGardenRunning(false);
        setCairnRunning(false);
        retry = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.close();
    };
  }, []);
  useEffect(() => {
    if (telemetry?.recording)
      setRecording(
        (v) =>
          options.recordings.find((p) =>
            p.endsWith("/" + telemetry.recording!.name),
          ) ?? v,
      );
  }, [telemetry?.session_id, options.recordings]);
  const fresh = connected && now - receivedAt <= 2000;
  const t = fresh ? telemetry : null;
  const usable = connected && isUsable(frame, receivedAt, now);
  const sameSession = roundSession === t?.session_id;
  const gardenSame = gardenSession !== null && gardenSession === t?.session_id;
  const cairnSame = cairnSession !== null && cairnSession === t?.session_id;
  useEffect(() => {
    if (!usable || !sameSession) setRunning(false);
  }, [usable, sameSession]);
  useEffect(() => {
    if (!usable || !gardenSame) setGardenRunning(false);
  }, [usable, gardenSame]);
  useEffect(() => {
    if (!usable || !cairnSame) setCairnRunning(false);
  }, [usable, cairnSame]);
  // Fresh telemetry reveals new sessions and recalibration, including ones
  // started by another viewer. Missing telemetry is an outage, not a change.
  useEffect(() => {
    const r = observeReference(
      watch.current,
      t ? { session_id: t.session_id, calibrating: t.calibrating } : null,
    );
    watch.current = r.watch;
    if (r.invalidate) invalidateGames();
  }, [t?.session_id, t?.calibrating]);
  async function command(action: string) {
    setBusy(true);
    setError("");
    setRunning(false);
    setGardenRunning(false);
    setCairnRunning(false);
    try {
      const r = await fetch(`${API}/api/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(action === "connect"
          ? { body: JSON.stringify({ source, recording, serial_port: port }) }
          : {}),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.detail ?? "Command failed");
      setTelemetry(result);
      if (action === "connect") {
        setFrame(null);
        invalidateGames();
        setPage("calibrate");
        window.scrollTo(0, 0);
      }
      if (action === "calibrate") {
        setFrame(null);
        invalidateGames();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function start() {
    if (!usable || !t?.session_id) return;
    setRoundSession(t.session_id);
    setReset((v) => v + 1);
    setHasRound(true);
    setRunning(true);
    setGardenRunning(false);
    setCairnRunning(false);
    setGame("balance");
    setPage("play");
    window.scrollTo(0, 0);
  }
  function startGarden() {
    setGardenIntro(false);
    if (!usable || busy || !t?.session_id) return;
    setGardenSession(t.session_id);
    setGardenReset((v) => v + 1);
    setGardenStarted(true);
    setGardenRunning(true);
    setRunning(false);
    setCairnRunning(false);
    setGame("garden");
    setPage("play");
  }
  // A new plant begins with the optional 30-second settle-in. The old plant is
  // cleared immediately; the new one binds to the session when growth starts.
  function requestGarden() {
    if (!usable || busy || !t?.session_id) return;
    if (!gardenPrefs.settleIn) return startGarden();
    setGardenRunning(false);
    setGardenStarted(false);
    setGardenSession(null);
    setGardenReset((v) => v + 1);
    setGardenIntro(true);
    setRunning(false);
    setCairnRunning(false);
    setGame("garden");
    setPage("play");
  }
  // A new cairn binds to the current session; switching mode always starts one.
  function startCairn(mode?: CairnMode) {
    if (mode) updateCairnRecord((r) => ({ ...r, mode }));
    if (!usable || busy || !t?.session_id) return;
    setCairnSession(t.session_id);
    setCairnReset((v) => v + 1);
    setCairnStarted(true);
    setCairnRunning(true);
    setRunning(false);
    setGardenRunning(false);
    setGame("cairn");
    setPage("play");
  }
  // From the chooser: continue an existing game paused, or start a new one.
  function openGame(id: GameId) {
    const existing =
      id === "garden"
        ? gardenStarted && gardenSame
        : id === "cairn"
          ? cairnStarted && cairnSame
          : hasRound && sameSession;
    if (existing) {
      setRunning(false);
      setGardenRunning(false);
      setCairnRunning(false);
      setGame(id);
      setPage("play");
      window.scrollTo(0, 0);
    } else if (id === "garden") {
      requestGarden();
      window.scrollTo(0, 0);
    } else if (id === "cairn") {
      // Opens on the start prompt so the player can pick a mode first.
      setRunning(false);
      setGardenRunning(false);
      setGame("cairn");
      setPage("play");
      window.scrollTo(0, 0);
    } else start();
  }
  function navigate(next: Page) {
    setRunning(false);
    setGardenRunning(false);
    setCairnRunning(false);
    setGardenIntro(false);
    setPage(next);
    setError("");
    window.scrollTo(0, 0);
  }
  const readiness =
    source === "synthetic" ||
    (source === "live" ? Boolean(port) : Boolean(recording && preview));
  return (
    <main>
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("setup");
          }}
        >
          AI & DATA CLUB <span>/ BRAIN GAMES</span>
        </a>
        <span className={`source-pill ${fresh ? "online" : ""}`}>
          {fresh
            ? t?.state === "disconnected"
              ? "No input connected"
              : sourceName(t?.source)
            : "Backend offline"}
        </span>
      </header>
      <nav className="steps" aria-label="Session steps">
        {(["setup", "calibrate", "choose", "play"] as Page[]).map((p, i) => (
          <button
            key={p}
            className={page === p ? "selected" : ""}
            onClick={() => navigate(p)}
            disabled={p !== "setup" && !t?.session_id}
          >
            <span>0{i + 1}</span>
            {p === "setup"
              ? "Connect"
              : p === "calibrate"
                ? "Calibrate"
                : p === "choose"
                  ? "Choose a game"
                  : "Play"}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {page === "setup" && (
        <>
          <section className="intro">
            <p className="eyebrow">01 / CONNECT</p>
            <h1>Start with a signal.</h1>
            <p>
              Choose where your signal comes from. Inspect it, build a baseline,
              then bring the same stream into the game.
            </p>
          </section>
          <div className="source-cards">
            {[
              {
                id: "live",
                title: "Live headset",
                text: "Connect to Cyton through its USB radio dongle.",
              },
              {
                id: "replay",
                title: "Recorded session",
                text: "Watch your actual EEG recording move through the pipeline.",
              },
              {
                id: "synthetic",
                title: "Simulation",
                text: "Generated input for testing. No headset or baseline required.",
              },
            ].map((o) => (
              <button
                aria-pressed={source === o.id}
                className={`source-card ${source === o.id ? "chosen" : ""}`}
                key={o.id}
                disabled={busy}
                onClick={() => {
                  setSource(o.id);
                  setError("");
                }}
              >
                <small>
                  {o.id === "live"
                    ? "HARDWARE"
                    : o.id === "replay"
                      ? "LOCAL FILE"
                      : "DEMO"}
                </small>
                <h2>{o.title}</h2>
                <p>{o.text}</p>
              </button>
            ))}
          </div>
          <section className="panel">
            <div className="chart-heading">
              <h2>
                {source === "replay"
                  ? "Choose a recording"
                  : source === "live"
                    ? "Connect your Cyton"
                    : "Try the flow"}
              </h2>
              <button
                className="secondary small-button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Refresh inputs
              </button>
            </div>
            {source === "live" && (
              <>
                <label htmlFor="port">Cyton dongle port</label>
                <select
                  id="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                >
                  <option value="">
                    Select the USB dongle · /dev/cu… on Mac
                  </option>
                  {options.ports.map((p) => (
                    <option value={p.device} key={p.device}>
                      {p.device} · {p.description}
                    </option>
                  ))}
                </select>
                <p>
                  First confirm the headset works in OpenBCI GUI, then close its
                  board session before connecting here. An open serial session
                  is not proof of incoming EEG.
                </p>
              </>
            )}
            {source === "replay" && (
              <>
                <label htmlFor="recording">Local BrainFlow recording</label>
                <select
                  id="recording"
                  value={recording}
                  onChange={(e) => setRecording(e.target.value)}
                >
                  {options.recordings.map((p) => (
                    <option value={p} key={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {preview ? (
                  <>
                    <p>
                      {preview.channels} channels · {preview.sample_rate_hz} Hz
                      · {preview.name}
                    </p>
                    <Overview recording={preview} />
                    {preview.backwards_timestamps > 0 && (
                      <p className="notice">
                        This recording contains backwards timestamps.
                      </p>
                    )}
                  </>
                ) : (
                  <p>Waiting for a recording preview…</p>
                )}
              </>
            )}
            {source === "synthetic" && (
              <p>
                Simulation generates a changing assistance value. It is
                explicitly labeled throughout the app and never verifies a
                headset connection.
              </p>
            )}
            <div className="actions">
              <button
                disabled={busy || !readiness}
                onClick={() => void command("connect")}
              >
                {busy
                  ? "Opening input…"
                  : source === "synthetic"
                    ? "Start simulation"
                    : source === "replay"
                      ? "Start playback & inspect"
                      : "Connect & inspect"}
              </button>
              {t?.session_id && (
                <button
                  className="secondary"
                  onClick={() => navigate("calibrate")}
                >
                  Return to current session
                </button>
              )}
            </div>
          </section>
        </>
      )}
      {page === "calibrate" && (
        <>
          <section className="intro">
            <p className="eyebrow">02 / CALIBRATE</p>
            <h1>
              {t?.source === "synthetic"
                ? "Explore the demo."
                : t?.calibrated
                  ? "Your baseline is ready."
                  : "Find your starting point."}
            </h1>
            <p>
              {t?.source === "synthetic"
                ? "This input is generated. You can go straight to the game."
                : "Sit comfortably and inspect the signal below. Begin when you are ready; we collect 60 seconds of accepted EEG windows."}
            </p>
          </section>
          <div className="calibration-layout">
            <SignalPanel telemetry={t} preview={preview} />
            <aside className="baseline">
              <p className="eyebrow">YOUR BASELINE</p>
              <h2>
                {t?.source === "synthetic"
                  ? "Bypassed for demo"
                  : t?.calibrated
                    ? "Ready to play"
                    : t?.calibrating
                      ? "Collecting baseline…"
                      : "Ready when you are"}
              </h2>
              {t?.source !== "synthetic" && (
                <>
                  <strong className="baseline-number">
                    {t?.calibration_seconds ?? 0}
                    <span> / 60s</span>
                  </strong>
                  <progress
                    aria-label="Valid baseline seconds"
                    max={60}
                    value={t?.calibration_seconds ?? 0}
                  />
                  <p>
                    Valid signal time, not a countdown. Rejected windows extend
                    calibration.
                  </p>
                  <div className="counts">
                    <span>
                      <b>{t?.accepted_windows ?? 0}</b> accepted
                    </span>
                    <span>
                      <b>{t?.rejected_windows ?? 0}</b> rejected
                    </span>
                  </div>
                  {t?.last_rejection && (
                    <p className="notice">
                      Last rejected window: {t.last_rejection}
                    </p>
                  )}
                  {t?.calibrated && (
                    <dl>
                      <dt>Typical relative alpha</dt>
                      <dd>{t.baseline_center?.toFixed(4)}</dd>
                      <dt>Robust variation</dt>
                      <dd>{t.baseline_scale?.toFixed(4)}</dd>
                      <dt>Baseline sample interval</dt>
                      <dd>
                        {t.baseline_start_sample?.toLocaleString()} →{" "}
                        {t.baseline_end_sample?.toLocaleString()}
                      </dd>
                    </dl>
                  )}
                  <button
                    className="secondary"
                    disabled={busy || !t?.receiving_samples || t?.calibrating}
                    onClick={() => void command("calibrate")}
                  >
                    {t?.calibrated || t?.calibration_error
                      ? "Recalibrate"
                      : "Begin baseline"}
                  </button>
                </>
              )}
              {t?.calibration_error && (
                <p role="alert" className="notice">
                  {t.calibration_error}
                </p>
              )}
              <button
                disabled={busy || !t?.session_id}
                onClick={() => navigate("choose")}
              >
                Choose a game
              </button>
              <p className="hint">
                Your stream keeps running. Choosing and switching games
                preserves the session, sample position, and baseline.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void command("disconnect")}
              >
                Disconnect
              </button>
            </aside>
          </div>
        </>
      )}
      {page === "choose" && (
        <GamePicker
          ready={usable && !busy}
          reason={
            !t?.session_id
              ? "No input session yet. Connect a source first."
              : t.source !== "synthetic" && !t.calibrated
                ? "Build a baseline on Calibrate before starting a game."
                : streamMessage(t)
          }
          status={{
            garden: {
              inProgress: gardenStarted && gardenSame,
              detail: gardenStarted && gardenSame ? "In progress · paused" : "",
            },
            cairn: {
              inProgress: cairnStarted && cairnSame,
              detail: cairnStarted && cairnSame ? "In progress · paused" : "",
            },
            balance: {
              inProgress: hasRound && sameSession,
              detail:
                hasRound && sameSession
                  ? stats.fell
                    ? "Last round ended"
                    : "In progress · paused"
                  : "",
            },
          }}
          onOpen={openGame}
          onConnect={() => navigate("setup")}
          onCalibrate={() => navigate("calibrate")}
        />
      )}
      <div hidden={page !== "play" || game !== "garden"}>
        <Garden
          live={canTick({
            selected: game === "garden",
            onPlayPage: page === "play",
            running: gardenRunning,
            visible,
            usable,
            boundSession: gardenSession,
            telemetrySession: t?.session_id,
          })}
          shown={page === "play" && game === "garden" && visible}
          intro={gardenIntro && page === "play" && game === "garden"}
          score={usable ? (frame?.score ?? null) : null}
          frameSeq={frame?.sequence ?? -1}
          reset={gardenReset}
          started={gardenStarted}
          canResume={gardenStarted && usable && gardenSame && !busy}
          canStart={usable && !busy && Boolean(t?.session_id)}
          statusMessage={
            !usable
              ? streamMessage(t)
              : !gardenSame
                ? "The input session changed. Start a new plant with its baseline."
                : "Paused. Your growth is saved for this session."
          }
          simulation={t?.source === "synthetic"}
          sourceLabel={sourceName(t?.source)}
          sourceId={t?.source ?? "unknown"}
          prefs={gardenPrefs}
          setPrefs={setGardenPrefs}
          relation={
            usable
              ? baselineRelation(
                  t?.relative_alpha,
                  t?.baseline_center,
                  t?.baseline_scale,
                )
              : null
          }
          onPause={() => setGardenRunning(false)}
          onResume={() => {
            if (gardenStarted && usable && gardenSame) setGardenRunning(true);
          }}
          onNewPlant={requestGarden}
          onIntroDone={startGarden}
          onChangeGame={() => navigate("choose")}
          onInspect={() => navigate("calibrate")}
          evidence={
            <details className="garden-evidence">
              <summary>Signal evidence: source, playback and baseline</summary>
              {page === "play" && game === "garden" && (
                <SignalPanel telemetry={t} preview={preview} compact />
              )}
            </details>
          }
        />
      </div>
      <div hidden={page !== "play" || game !== "cairn"}>
        <Cairn
          live={canTick({
            selected: game === "cairn",
            onPlayPage: page === "play",
            running: cairnRunning,
            visible,
            usable,
            boundSession: cairnSession,
            telemetrySession: t?.session_id,
          })}
          shown={page === "play" && game === "cairn" && visible}
          score={usable ? (frame?.score ?? null) : null}
          reset={cairnReset}
          mode={cairnRecord.mode}
          started={cairnStarted}
          canResume={cairnStarted && usable && cairnSame && !busy}
          canStart={usable && !busy && Boolean(t?.session_id)}
          statusMessage={
            !usable
              ? streamMessage(t)
              : !cairnSame
                ? "The input session changed. Start a new cairn with its baseline."
                : "Paused. Your cairn is waiting for you."
          }
          simulation={t?.source === "synthetic"}
          sourceLabel={sourceName(t?.source)}
          sourceId={t?.source ?? "unknown"}
          record={cairnRecord}
          onRound={(round) => updateCairnRecord((r) => addRound(r, round))}
          onFlicker={(on) => updateCairnRecord((r) => ({ ...r, flicker: on }))}
          onStimulus={(s) => updateCairnRecord((r) => addStimulus(r, s))}
          onStart={startCairn}
          onPause={() => setCairnRunning(false)}
          onResume={() => {
            if (cairnStarted && usable && cairnSame) setCairnRunning(true);
          }}
          onChangeGame={() => navigate("choose")}
          onInspect={() => navigate("calibrate")}
          evidence={
            <details className="garden-evidence">
              <summary>Signal evidence: source, playback and baseline</summary>
              {page === "play" && game === "cairn" && (
                <SignalPanel telemetry={t} preview={preview} compact />
              )}
            </details>
          }
        />
      </div>
      <div hidden={page !== "play" || game !== "balance"}>
        <section className="intro">
          <div className="title-row">
            <p className="eyebrow">
              04 / PLAY · {gameInfo("balance").title.toUpperCase()}
            </p>
            <button
              className="secondary change-game"
              onClick={() => navigate("choose")}
            >
              Change game
            </button>
          </div>
          <h1>
            {stats.fell ? "Find your balance again." : "Stay in the moment."}
          </h1>
          <p>
            No countdown, no finish line. Keep the ball on the beam for as long
            as you can.
          </p>
        </section>
        <div className="layout">
          <section className="stage">
            <div className="stage-top">
              <span className="status">
                {sourceName(t?.source)} ·{" "}
                {running && usable ? "playing" : "paused"}
              </span>
              <span>ENDLESS BALANCE</span>
            </div>
            <Game
              controls={{
                running: canTick({
                  selected: game === "balance",
                  onPlayPage: page === "play",
                  running,
                  visible,
                  usable,
                  boundSession: roundSession,
                  telemetrySession: t?.session_id,
                }),
                score: frame?.score ?? 0.5,
                reset,
              }}
              onStats={setStats}
            />
            <div className="metrics">
              <div>
                <small>TIME SURVIVED</small>
                <strong>{duration(stats.elapsed)}</strong>
              </div>
              <div>
                <small>TIME IN CENTER</small>
                <strong>{stats.centered.toFixed(1)}s</strong>
              </div>
              <div>
                <small>BALANCE ASSISTANCE</small>
                <strong>
                  {usable ? `${Math.round(stats.assistance * 100)}%` : "—"}
                </strong>
              </div>
            </div>
          </section>
          <aside>
            <p className="eyebrow">YOUR ROUND</p>
            <h2>
              {stats.fell
                ? "The ball fell off."
                : !usable
                  ? "Signal paused."
                  : running
                    ? "Keep it balanced."
                    : "Ready to continue?"}
            </h2>
            <p>
              {stats.fell
                ? `You stayed on for ${stats.elapsed.toFixed(1)} seconds. Try again with the same baseline.`
                : !usable
                  ? streamMessage(t)
                  : "Your signal changes assistance. Each round eases in over five seconds."}
            </p>
            {hasRound && !sameSession && (
              <p className="notice">
                The input session changed. Start a new round with its baseline.
              </p>
            )}
            <button disabled={!usable || busy} onClick={start}>
              {stats.fell
                ? "Play again"
                : hasRound
                  ? "Start new round"
                  : "Start balancing"}{" "}
              →
            </button>
            <button
              className="secondary"
              disabled={!hasRound || stats.done || !usable || !sameSession}
              onClick={() => setRunning((v) => !v)}
            >
              {running ? "Pause" : "Resume"}
            </button>
            <button className="secondary" onClick={() => navigate("calibrate")}>
              Inspect baseline & signal
            </button>
            <p className="hint">
              Missing or rejected data pauses play. Resume when the signal
              returns. A recording ending is not a loss.
            </p>
          </aside>
        </div>
        {page === "play" && game === "balance" && (
          <SignalPanel telemetry={t} preview={preview} compact />
        )}
      </div>
      <footer>
        Experimental signal-driven experience. This is not a validated
        measurement of stress or health.
      </footer>
    </main>
  );
}
