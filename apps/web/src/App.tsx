import { useEffect, useState } from 'react';
import Game from './Game';
import { initialState, ROUND_SECONDS } from './simulation';
import { parseFrame, isUsable, type InputFrame } from './input';
export default function App() {
  const [mode, setMode] = useState<'manual' | 'stream'>('manual');
  const [score, setScore] = useState(0.5); const [running, setRunning] = useState(false);
  const [reset, setReset] = useState(0); const [stats, setStats] = useState(initialState);
  const [frame, setFrame] = useState<InputFrame | null>(null);
  const [receivedAt, setReceivedAt] = useState(0); const [now, setNow] = useState(performance.now());
  const [connected, setConnected] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 200); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (mode !== 'stream') return;
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
  }, [mode]);
  const usable = mode === 'manual' || (connected && isUsable(frame, receivedAt, now));
  const input = mode === 'manual' ? score : frame?.score ?? 0;
  const label = mode === 'manual' ? 'Manual simulation · no EEG' : !connected ? 'Backend disconnected' : `${frame?.source ?? 'Waiting for'} input · ${usable ? 'ready' : 'paused'}`;
  const restart = () => { setReset(v => v + 1); setRunning(true); };
  return <main>
    <header><a className="brand" href="#">AI & DATA CLUB <span>/ LAB 01</span></a><span className="tag">WEEKEND PROTOTYPE</span></header>
    <section className="intro"><p className="eyebrow">BRAIN BALANCE</p><h1>Find your balance.</h1><p>A brain-responsive game in the making. Keep the ball in the mint zone for a 60-second round.</p></section>
    <div className="layout"><section className="stage"><div className="stage-top"><span className="status">{label}</span><span>01 / BALL & BEAM</span></div>
      <Game controls={{ running: running && usable, score: input, reset }} onStats={setStats} />
      <div className="metrics"><div><small>TIME REMAINING</small><strong>{Math.ceil(Math.max(0, ROUND_SECONDS - stats.elapsed))}s</strong></div><div><small>TIME IN ZONE</small><strong>{stats.centered.toFixed(1)}s</strong></div><div><small>ASSISTANCE INPUT</small><strong>{usable ? Math.round(input * 100) + '%' : '—'}</strong></div></div>
    </section><aside><p className="eyebrow">YOUR SESSION</p><h2>{stats.done ? 'Round complete.' : 'Start with a signal.'}</h2><p>The game balances automatically. Your input changes disturbance strength: higher input makes balancing easier.</p>
      <label htmlFor="mode">Input source</label><select id="mode" value={mode} onChange={e => { setMode(e.target.value as 'manual' | 'stream'); setRunning(false); }}><option value="manual">Manual simulation</option><option value="stream">Local backend stream</option></select>
      {mode === 'manual' ? <><label htmlFor="assistance">Simulated EEG score · {Math.round(score * 100)}%</label><input id="assistance" type="range" min="0" max="1" step="0.01" value={score} onChange={e => setScore(Number(e.target.value))} /></> : <p className="notice">The included backend sends synthetic data. Live EEG requires a headset adapter and calibration.</p>}
      <button onClick={restart} disabled={!usable}>{stats.done ? 'Play again' : 'Start new round'} →</button><button className="secondary" disabled={stats.done} onClick={() => setRunning(v => !v)}>{running ? 'Pause' : 'Resume'}</button>
      <p className="hint">Optional: ← / → tilt the beam. Scores with keyboard steering are practice scores.</p>
      {running && !usable && <p role="status" className="notice">Round paused until fresh, calibrated, good-quality input returns.</p>}
    </aside></div><footer>Experimental neurofeedback gameplay. This prototype does not measure calmness or read thoughts.</footer>
  </main>;
}
