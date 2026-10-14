// Development-only art preview (npm run dev, then open /?garden-preview).
// Lets the club review every growth stage without waiting minutes for input.
// Not reachable in production builds and never touches the game state.
//   ?garden-preview               sliders
//   ?garden-preview&guide         show the breathing-guide ring
//   ?garden-preview&demo          time-lapse a whole session (growth 0 → 1)
//   ?garden-preview&demo&sound    …with ambient sound (click once to allow audio)
import { useEffect, useRef, useState } from "react";
import GardenScene from "./GardenScene";
import { GardenAudio } from "./gardenAudio";
import { breathAt } from "./breath";
import { MILESTONES } from "./gardenSimulation";

const DEMO_SECONDS = 40;

export default function GardenPreview() {
  const params = new URLSearchParams(location.search);
  const [growth, setGrowth] = useState(Number(params.get("growth") ?? 0.5));
  const [response, setResponse] = useState(
    Number(params.get("response") ?? 0.75),
  );
  const [time, setTime] = useState(Number(params.get("time") ?? 0));
  const still = params.has("still");
  const demo = params.has("demo");
  const sound = params.has("sound");
  const audio = useRef<GardenAudio | null>(null);
  useEffect(() => {
    if (still) return;
    let raf = 0;
    let lastGrowth = 0;
    let lastAudio = 0;
    const t0 = performance.now();
    if (sound) {
      audio.current = new GardenAudio();
      void audio.current.start();
      const wake = () => void audio.current?.start();
      window.addEventListener("pointerdown", wake);
      record(audio.current);
    }
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      setTime(t);
      if (demo) {
        const g = Math.min(1, Math.max(0, (t - 2) / (DEMO_SECONDS - 6)));
        const r = 0.58 + 0.32 * Math.sin(t * 0.42 - 1.4);
        setGrowth(g);
        setResponse(r);
        const a = audio.current;
        if (a) {
          for (let k = 1; k < 10; k++)
            if (lastGrowth < k / 10 && g >= k / 10) a.chime((k - 1) % 5, 0.45);
          MILESTONES.forEach((m, i) => {
            if (lastGrowth < m && g >= m) a.milestone(i);
          });
          if (now - lastAudio > 100) {
            lastAudio = now;
            a.update({
              on: true,
              response: r,
              breath: breathAt(t).level,
              volume: 0.8,
            });
          }
        }
        lastGrowth = g;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      audio.current?.dispose();
    };
  }, [still, demo, sound]);
  return (
    <main>
      <p className="notice">
        Development art preview · not connected to any input
      </p>
      <div className="garden-stage">
        <div className="garden-scene">
          <GardenScene
            growth={growth}
            response={response}
            sun={response}
            time={time}
            motion={still ? 0 : 1}
            guide={params.has("guide") || demo ? 1 : 0}
            paused={false}
          />
        </div>
      </div>
      <label>
        Growth {growth.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={growth}
          onChange={(e) => setGrowth(Number(e.target.value))}
        />
      </label>
      <label>
        Response {response.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={response}
          onChange={(e) => setResponse(Number(e.target.value))}
        />
      </label>
    </main>
  );
}

/** Records the demo's audio so it can be paired with a screen capture. */
function record(audio: GardenAudio) {
  const stream = audio.tap();
  if (!stream || typeof MediaRecorder === "undefined") return;
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: rec.mimeType });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    (window as unknown as { __gardenAudio?: string }).__gardenAudio = btoa(bin);
  };
  rec.start();
  setTimeout(() => rec.stop(), DEMO_SECONDS * 1000);
}
