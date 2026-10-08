import { useEffect, useState } from 'react';
import Game from './Game';
import Diagnostics from './Diagnostics';
import { initialState, ROUND_SECONDS } from './simulation';
import { parseFrame, isUsable, type InputFrame } from './input';
export default function App() {
  const [running, setRunning] = useState(false);
  const [reset, setReset] = useState(0); const [stats, setStats] = useState(initialState);
  const [frame, setFrame] = useState<InputFrame | null>(null);
  const [receivedAt, setReceivedAt] = useState(0); const [now, setNow] = useState(performance.now());
  const [connected, setConnected] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 200); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let disposed = false; let retry: ReturnType<typeof setTimeout>; let socket: WebSocket;
    const connect = () => {
      socket = new WebSocket('ws://127.0.0.1:8000/ws/input'); let lastSequence = -1;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try { const next = parseFrame(JSON.parse(event.data));
          if (next && next.sequence > lastSequence) { lastSequence = next.sequence; setFrame(next); setReceivedAt(performance.now()); }
        } catch { /* Ignore malformed packets; freshness handling pauses gameplay. */ }
      };
      socket.onclose = () => { setConnected(false); setFrame(null); if (!disposed) retry = setTimeout(connect, 1500); };
      socket.onerror = () => socket.close();
    };
    connect(); return () => { disposed = true; clearTimeout(retry); socket.close(); setConnected(false); setFrame(null); };
  }, []);
  const usable = connected && isUsable(frame, receivedAt, now);
  const input = frame?.score ?? 0;
  const label = !connected ? 'Backend disconnected' : `${frame?.source ?? 'Waiting for'} input · ${usable ? 'ready' : 'paused'}`;
  const restart = () => { setReset(v => v + 1); setRunning(true); };
  return <main>
    <header><a className="brand" href="#">AI & DATA CLUB <span>/ LAB 01</span></a><span className="tag">WEEKEND PROTOTYPE</span></header>
    <section className="intro"><p className="eyebrow">BRAIN BALANCE</p><h1>Find your balance.</h1><p>A brain-responsive game in the making. Keep the ball in the mint zone for a 60-second round.</p></section>
    <div className="layout"><section className="stage"><div className="stage-top"><span className="status">{label}</span><span>01 / BALL & BEAM</span></div>
      <Game controls={{ running: running && usable, score: input, reset }} onStats={setStats} />
      <div className="metrics"><div><small>TIME REMAINING</small><strong>{Math.ceil(Math.max(0, ROUND_SECONDS - stats.elapsed))}s</strong></div><div><small>TIME IN ZONE</small><strong>{stats.centered.toFixed(1)}s</strong></div><div><small>ASSISTANCE INPUT</small><strong>{usable ? Math.round(input * 100) + '%' : '—'}</strong></div></div>
    </section><aside><p className="eyebrow">YOUR SESSION</p><h2>{stats.fell ? 'The ball fell off.' : stats.done ? 'Round complete.' : running && usable ? 'Keep it balanced.' : 'Ready to balance?'}</h2><p>Your signal changes balancing assistance. Keep the ball on the beam for 60 seconds; if it falls off, the round ends.</p>
      {!usable && <p className="notice">Connect an input in the Connection Lab below. EEG play requires a completed calibration and fresh valid samples.</p>}
      <button onClick={restart} disabled={!usable}>{stats.done ? 'Play again' : 'Start new round'} →</button><button className="secondary" disabled={stats.done || !usable} onClick={() => setRunning(v => !v)}>{running ? 'Pause' : 'Resume'}</button>
      {stats.fell && <p role="status" className="notice">Round ended after {stats.elapsed.toFixed(1)} seconds. Try again to stay on longer.</p>}
      {running && !usable && <p role="status" className="notice">Round paused until fresh, calibrated, good-quality input returns.</p>}
    </aside></div><Diagnostics onChange={() => { setRunning(false); setFrame(null); }} /><footer>Experimental neurofeedback gameplay. This prototype does not measure calmness or read thoughts.</footer>
  </main>;
}
