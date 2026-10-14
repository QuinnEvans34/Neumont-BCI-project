// Original SVG garden scene. Pure presentation: every value it draws comes
// from props, so it can be driven by the live loop or by the dev preview.
import { memo, useId } from "react";
import { visuals } from "./gardenSimulation";
import { breathAt } from "./breath";

export type SceneProps = {
  /** Lasting growth [0,1]. */
  growth: number;
  /** Reversible display response [0,1]. */
  response: number;
  /** Extra-smoothed response used for the sun's height. */
  sun: number;
  /** Animation clock in seconds (decorative motion only). */
  time: number;
  /** Decorative motion amplitude [0,1]; 0 freezes sway and fireflies. */
  motion: number;
  /** Dims the scene so a paused garden never looks live. */
  paused: boolean;
  /** SVG preserveAspectRatio; the live scene anchors to the ground. */
  fit?: string;
  /** Breathing-guide ring visibility 0..1 (follows the shared breath clock). */
  guide?: number;
  /** prefers-reduced-motion: the guide pulses in light instead of size. */
  reduced?: boolean;
};

const W = 960;
const H = 600;
const GROUND = 468;
const BASE_X = 480;
const BASE_Y = 476;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - (1 - t) ** 2.2;
function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return (
    "#" +
    pa
      .map((v, i) =>
        Math.round(lerp(v, pb[i], clamp01(t)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const f = (n: number) => n.toFixed(1);

// Deterministic layout for background flora, generated once.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);
type Blade = {
  x: number;
  y: number;
  h: number;
  lean: number;
  w: number;
  tone: number;
};
function bladesAround(
  cx: number,
  spread: number,
  n: number,
  y: number,
  hMin: number,
  hMax: number,
) {
  return Array.from({ length: n }, (): Blade => ({
    x: cx + (rand() - 0.5) * spread,
    y: y + rand() * 6,
    h: lerp(hMin, hMax, rand()),
    lean: (rand() - 0.5) * 0.5,
    w: 2.2 + rand() * 2.6,
    tone: rand(),
  }));
}
const MID_GRASS = [
  ...bladesAround(120, 170, 16, 452, 50, 120),
  ...bladesAround(300, 110, 9, 458, 35, 80),
  ...bladesAround(680, 120, 10, 458, 35, 85),
  ...bladesAround(850, 190, 18, 452, 55, 130),
];
const FRONT_GRASS = [
  ...bladesAround(40, 120, 14, 604, 70, 170),
  ...bladesAround(930, 120, 14, 604, 70, 170),
];
// Lantern flowers light up progressively as lasting growth is earned.
const LANTERNS = [
  { x: 210, h: 120, r: 9, at: 0.0 },
  { x: 760, h: 135, r: 10, at: 0.08 },
  { x: 92, h: 165, r: 11, at: 0.2 },
  { x: 880, h: 175, r: 11, at: 0.3 },
  { x: 338, h: 92, r: 7, at: 0.42 },
  { x: 640, h: 100, r: 8, at: 0.52 },
  { x: 262, h: 150, r: 8, at: 0.64 },
  { x: 705, h: 168, r: 9, at: 0.76 },
  { x: 160, h: 205, r: 8, at: 0.88 },
  { x: 818, h: 215, r: 9, at: 0.96 },
].map((l) => ({ ...l, y: 456 + rand() * 6 }));
const FERNS = [
  { x: 30, y: 470, len: 190, dir: 1, curl: 0.9 },
  { x: 250, y: 462, len: 120, dir: -1, curl: 0.8 },
  { x: 728, y: 462, len: 125, dir: 1, curl: 0.8 },
  { x: 950, y: 470, len: 200, dir: -1, curl: 0.95 },
];
const FIREFLIES = Array.from({ length: 16 }, (_, i) => ({
  x: 80 + rand() * 800,
  y: 170 + rand() * 260,
  ax: 18 + rand() * 30,
  ay: 10 + rand() * 22,
  sp: 0.15 + rand() * 0.25,
  ph: rand() * Math.PI * 2,
  order: i / 16,
}));
// Small ground flowers bloom one by one as lasting growth is earned.
const GROUND_FLOWERS = Array.from({ length: 22 }, (_, i) => {
  const side = i % 2 ? 1 : -1;
  const dist = 120 + rand() * 340;
  return {
    x: BASE_X + side * dist,
    y: 492 + rand() * 80,
    s: 0.7 + rand() * 0.6,
    at: Math.min(0.98, (i / 22) * 1.05),
    hue: i % 3,
  };
}).sort((a, b) => a.y - b.y);
const SHRUBS = [
  { x: 60, w: 120, h: 46 },
  { x: 175, w: 90, h: 34 },
  { x: 395, w: 70, h: 22 },
  { x: 590, w: 80, h: 26 },
  { x: 780, w: 100, h: 36 },
  { x: 905, w: 130, h: 50 },
];
const STARS = Array.from({ length: 34 }, () => ({
  x: rand() * W,
  y: rand() * 230,
  r: 0.6 + rand() * 1.2,
  tw: rand() * Math.PI * 2,
}));

/** Gentle wind: a slow, breath-paced wave travelling across the garden. */
/**
 * Gentle wind that breathes: the main sway follows the shared breath clock
 * (in 4 s, out 6 s), arriving at the central plant exactly in phase and
 * travelling outward across the garden, with a small faster flutter on top.
 */
function wind(time: number, x: number) {
  const delay = Math.abs(x - 480) / 520;
  const breath = breathAt(time - delay).level * 2 - 1;
  return breath * 0.8 + Math.sin(time * 1.9 - x / 150 + 1.3) * 0.2;
}

function bladePath(b: Blade, sway: number) {
  const bend = (b.lean + sway * 0.12) * b.h;
  const tx = b.x + bend;
  const ty = b.y - b.h;
  return `M${f(b.x - b.w)},${f(b.y)} Q${f(b.x + bend * 0.35)},${f(b.y - b.h * 0.55)} ${f(tx)},${f(ty)} Q${f(
    b.x + bend * 0.35 + b.w * 0.6,
  )},${f(b.y - b.h * 0.5)} ${f(b.x + b.w)},${f(b.y)}Z`;
}

function fernPath(fern: (typeof FERNS)[number], sway: number) {
  // Arching frond: a spine with alternating leaflets that shrink toward the tip.
  const pts: [number, number, number][] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const ang =
      -Math.PI / 2 + fern.dir * (0.35 + s * fern.curl * 1.3 + sway * 0.08 * s);
    const prev = pts[i - 1] ?? [fern.x, fern.y, ang];
    const step = fern.len / n;
    pts.push([
      prev[0] + Math.cos(ang) * step,
      prev[1] + Math.sin(ang) * step,
      ang,
    ]);
  }
  let d =
    `M${f(fern.x)},${f(fern.y)} ` +
    pts.map((p) => `L${f(p[0])},${f(p[1])}`).join(" ");
  for (let i = 2; i < n; i++) {
    const [x, y, a] = pts[i];
    const len = (1 - i / n) * 26 + 6;
    for (const side of [-1, 1]) {
      const la = a + side * 1.05;
      const ex = x + Math.cos(la) * len;
      const ey = y + Math.sin(la) * len;
      const cx = x + Math.cos(la - side * 0.35) * len * 0.6;
      const cy = y + Math.sin(la - side * 0.35) * len * 0.6;
      d += ` M${f(x)},${f(y)} Q${f(cx)},${f(cy)} ${f(ex)},${f(ey)}`;
    }
  }
  return d;
}

// ---------- hero plant ----------
const LEAF_PAIRS = [
  { h: 62, len: 84, w: 0.42, from: -1, to: 0, tilt: 8 },
  { h: 140, len: 96, w: 0.4, from: 0.16, to: 0.4, tilt: 0 },
  { h: 214, len: 84, w: 0.38, from: 0.4, to: 0.62, tilt: -4 },
  { h: 280, len: 58, w: 0.36, from: 0.6, to: 0.8, tilt: -8 },
];

function leafShape(len: number, wr: number) {
  const w = len * wr;
  return `M0,0 C${f(len * 0.18)},${f(-w * 0.95)} ${f(len * 0.68)},${f(-w * 0.85)} ${f(len)},0 C${f(
    len * 0.7,
  )},${f(w * 0.55)} ${f(len * 0.22)},${f(w * 0.7)} 0,0Z`;
}

function Plant({
  growth,
  response,
  time,
  motion,
  u,
}: {
  growth: number;
  response: number;
  time: number;
  motion: number;
  u: string;
}) {
  const v = visuals(response);
  const height = 92 + 258 * easeOut(clamp01(growth));
  // Stem bends from the base like a real stalk: lateral offset grows with s².
  const sway = motion * (0.055 * wind(time, BASE_X) + 0.004);
  const lift = (response - 0.5) * 0.02;
  const point = (s: number): [number, number] => {
    const lateral =
      Math.sin(sway - lift) * height * s * s +
      Math.sin(Math.PI * s) * height * 0.035;
    return [BASE_X + lateral, BASE_Y - height * s * (1 - 0.04 * s * s)];
  };
  const tangent = (s: number) => {
    const a = point(Math.max(0, s - 0.01));
    const b = point(Math.min(1, s + 0.01));
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  // Tapered stem polygon.
  const n = 28;
  const left: string[] = [];
  const right: string[] = [];
  const base = 7 + 4 * growth;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const [x, y] = point(s);
    const a = tangent(s) + Math.PI / 2;
    const w = lerp(base, 2.2, s ** 0.8);
    left.push(`${f(x + Math.cos(a) * w)},${f(y + Math.sin(a) * w)}`);
    right.unshift(`${f(x - Math.cos(a) * w)},${f(y - Math.sin(a) * w)}`);
  }
  const stem = `M${left.join(" L")} L${right.join(" L")}Z`;

  const leaves = LEAF_PAIRS.flatMap((pair, pi) => {
    const reveal = pair.from < 0 ? 1 : smooth(pair.from, pair.to, growth);
    if (reveal <= 0.001) return [];
    const s = Math.min(0.97, pair.h / height);
    const [x, y] = point(s);
    const t = (tangent(s) * 180) / Math.PI; // stem direction (≈ -90° = up)
    const open = (22 + v.leafOpenDegrees) * (0.35 + 0.65 * reveal);
    const scale = reveal * v.leafScale;
    return [-1, 1].map((side) => {
      const flutter = motion * 2.2 * Math.sin(time * 1.3 + pi * 1.7 + side);
      const lift = motion * 5 * breathAt(time).level; // leaves rise a little on each in-breath
      const angle = t + side * (open + pair.tilt + lift) + flutter;
      return (
        <g
          key={`${pi}${side}`}
          transform={`translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${scale.toFixed(3)} ${(side * scale).toFixed(3)})`}
        >
          <path d={leafShape(pair.len, pair.w)} fill={`url(#${u}leaf)`} />
          <path
            d={leafShape(pair.len, pair.w)}
            fill={`url(#${u}leafLight)`}
            opacity={(0.12 + 0.6 * response).toFixed(3)}
          />
          <path
            d={`M2,0 Q${f(pair.len * 0.5)},${f(-pair.len * pair.w * 0.12)} ${f(pair.len * 0.92)},0`}
            stroke="#d9f7c5"
            strokeOpacity={0.25 + 0.3 * response}
            strokeWidth="1.2"
            fill="none"
          />
        </g>
      );
    });
  });

  // Bud forms late in Growing; petals open through Blooming.
  const bud = smooth(0.55, 0.7, growth);
  const bloom = smooth(0.67, 1, growth);
  const [tx, ty] = point(1);
  const tipAngle = (tangent(1) * 180) / Math.PI + 90;
  const petals = 12;
  const spread = lerp(0.28, 1.92, bloom) * Math.PI * (0.9 + 0.1 * response);
  const petalLen = lerp(17, 60, bloom) * (0.95 + 0.1 * response);
  return (
    <g>
      <path d={stem} fill={`url(#${u}stem)`} />
      {leaves}
      {bud < 0.999 && (
        // Unfurling apex: a small pair of new leaves at the growing tip.
        <g
          transform={`translate(${f(tx)} ${f(ty)}) rotate(${f(tipAngle - 90)}) scale(${(1 - bud).toFixed(3)})`}
        >
          {[-1, 1].map((side) => (
            <path
              key={side}
              transform={`rotate(${side * (18 + 10 * response)}) scale(1 ${side})`}
              d={leafShape(24, 0.42)}
              fill={`url(#${u}leaf)`}
            />
          ))}
        </g>
      )}
      {bud > 0.001 && (
        <g transform={`translate(${f(tx)} ${f(ty)}) rotate(${f(tipAngle)})`}>
          <circle
            r={lerp(20, 95, bloom)}
            fill={`url(#${u}flowerGlow)`}
            opacity={(bloom * (0.3 + v.glowOpacity)).toFixed(3)}
          />
          <g transform={`scale(${bud.toFixed(3)})`}>
            {[0, 1].map((ring) =>
              Array.from({ length: petals }, (_, k) => {
                const a =
                  -Math.PI / 2 +
                  ((k + ring * 0.5) / (petals - 1) - 0.5) *
                    spread *
                    (ring ? 0.94 : 1);
                const deg = (a * 180) / Math.PI;
                const len = petalLen * (ring ? 0.68 : 1);
                return (
                  <path
                    key={`${ring}-${k}`}
                    transform={`rotate(${f(deg)})`}
                    d={`M0,0 C${f(len * 0.3)},${f(-len * 0.32)} ${f(len * 0.85)},${f(-len * 0.26)} ${f(len)},0 C${f(len * 0.85)},${f(len * 0.26)} ${f(len * 0.3)},${f(len * 0.32)} 0,0Z`}
                    fill={ring ? `url(#${u}petalA)` : `url(#${u}petalB)`}
                  />
                );
              }),
            )}
            {/* sepals hold the closed bud */}
            {[-1, 1].map((side) => (
              <path
                key={side}
                transform={`scale(${side} 1)`}
                d={`M0,6 C7,2 ${f(10 - 6 * bloom)},${f(-8 + 10 * bloom)} ${f(4 + 10 * bloom)},${f(-14 + 18 * bloom)} C3,-4 1,2 0,6Z`}
                fill="#5aa86a"
              />
            ))}
            <circle r={lerp(3, 11, bloom)} fill={`url(#${u}flowerCenter)`} />
          </g>
        </g>
      )}
    </g>
  );
}

function Scene({
  growth,
  response,
  sun,
  time,
  motion,
  paused,
  fit = "xMidYMax slice",
  guide = 0,
  reduced = false,
}: SceneProps) {
  // Unique gradient IDs so several scenes (chooser art + live game) never collide.
  const u = "g" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const v = visuals(response);
  const warm = clamp01(0.15 + 0.85 * response);
  const sunY = lerp(GROUND + 28, 250, clamp01(0.35 * growth + 0.65 * sun));
  const skyTop = mix("#071a20", "#173c47", warm);
  const skyMid = mix("#0d2a2f", "#3f6b63", warm);
  const skyLow = mix(
    "#1b3f3c",
    "#e6b36f",
    warm * (0.55 + 0.45 * clamp01(1 - (sunY - 250) / 260)),
  );
  const plantMidY = BASE_Y - (92 + 258 * easeOut(growth)) * 0.62;
  const lit = (at: number) => smooth(at - 0.06, at + 0.04, growth + 0.02);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={fit}
      className="garden-svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${u}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={skyTop} />
          <stop offset="0.55" stopColor={skyMid} />
          <stop offset="0.8" stopColor={skyLow} />
        </linearGradient>
        <radialGradient id={`${u}sunHalo`}>
          <stop offset="0" stopColor="#ffe2a6" stopOpacity="0.9" />
          <stop offset="0.25" stopColor="#f3c46b" stopOpacity="0.38" />
          <stop offset="1" stopColor="#f3c46b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}sunDisc`}>
          <stop offset="0" stopColor="#fff4d6" />
          <stop offset="0.7" stopColor="#fbd99a" />
          <stop offset="1" stopColor="#f2bf72" />
        </radialGradient>
        <radialGradient id={`${u}plantHalo`}>
          <stop offset="0" stopColor="#c9f5b5" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#8fe3b5" stopOpacity="0.18" />
          <stop offset="1" stopColor="#8fe3b5" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}lantern`}>
          <stop offset="0" stopColor="#fff1c4" stopOpacity="1" />
          <stop offset="0.3" stopColor="#ffd98a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd98a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}firefly`}>
          <stop offset="0" stopColor="#f4ffd8" />
          <stop offset="0.35" stopColor="#c8f7a8" stopOpacity="0.6" />
          <stop offset="1" stopColor="#c8f7a8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}stem`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2f6b47" />
          <stop offset="1" stopColor={mix("#4f9a5e", "#86cf78", response)} />
        </linearGradient>
        <linearGradient id={`${u}leaf`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2f7a4c" />
          <stop offset="1" stopColor={mix("#4f9f5f", "#7fd27a", response)} />
        </linearGradient>
        <linearGradient id={`${u}leafLight`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#b8f59a" stopOpacity="0" />
          <stop offset="1" stopColor="#d6ffb0" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={`${u}petalA`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e9a54a" />
          <stop offset="1" stopColor="#ffe2a0" />
        </linearGradient>
        <linearGradient id={`${u}petalB`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d98f3c" />
          <stop offset="1" stopColor="#f7cf7c" />
        </linearGradient>
        <radialGradient id={`${u}flowerCenter`}>
          <stop offset="0" stopColor="#fff0b8" />
          <stop offset="1" stopColor="#c7792e" />
        </radialGradient>
        <radialGradient id={`${u}flowerGlow`}>
          <stop offset="0" stopColor="#ffe6a8" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ffe6a8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}groundGrad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#12322f" />
          <stop offset="1" stopColor="#081a1d" />
        </linearGradient>
        <linearGradient id={`${u}mist`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe8d6" stopOpacity="0" />
          <stop offset="0.7" stopColor="#bfe8d6" stopOpacity="0.16" />
          <stop offset="1" stopColor="#bfe8d6" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${u}pool`}>
          <stop offset="0" stopColor="#f6dc9c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f6dc9c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}guideFill`}>
          <stop offset="0.72" stopColor="#ffe7b0" stopOpacity="0" />
          <stop offset="0.9" stopColor="#ffe7b0" stopOpacity="0.14" />
          <stop offset="1" stopColor="#ffe7b0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}vignette`} cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#04121a" stopOpacity="0" />
          <stop offset="1" stopColor="#04121a" stopOpacity="0.6" />
        </radialGradient>
      </defs>

      <rect width={W} height={H} fill={`url(#${u}sky)`} />
      {STARS.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill="#e8fff4"
          opacity={(
            (1 - warm) *
            0.6 *
            (0.7 + 0.3 * Math.sin(time * 0.8 + s.tw) * motion)
          ).toFixed(3)}
        />
      ))}

      {/* Sun rises with the signal and with what has been earned. */}
      <circle
        cx={BASE_X}
        cy={sunY}
        r={300}
        fill={`url(#${u}sunHalo)`}
        opacity={(v.glowOpacity * 0.95).toFixed(3)}
      />
      <circle
        cx={BASE_X}
        cy={sunY}
        r={lerp(40, 52, response)}
        fill={`url(#${u}sunDisc)`}
        opacity={(0.55 + 0.45 * warm).toFixed(3)}
      />

      {/* Distant hills */}
      <path
        d="M0,392 C120,352 220,366 330,384 C430,400 520,350 640,356 C760,362 860,392 960,370 L960,600 L0,600Z"
        fill={mix("#0f2c31", "#2d4c45", warm * 0.6)}
      />
      <path
        d="M0,420 C150,396 260,428 400,420 C540,412 600,392 740,404 C840,412 900,426 960,414 L960,600 L0,600Z"
        fill={mix("#0d2529", "#203f39", warm * 0.5)}
      />

      <rect
        y={360}
        width={W}
        height={110}
        fill={`url(#${u}mist)`}
        opacity={(0.25 + 0.35 * warm).toFixed(3)}
      />
      {SHRUBS.map((b, i) => (
        <path
          key={i}
          d={`M${b.x - b.w / 2},462 C${b.x - b.w / 2},${462 - b.h} ${b.x - b.w * 0.15},${462 - b.h * 1.25} ${b.x},${462 - b.h} C${b.x + b.w * 0.2},${462 - b.h * 1.3} ${b.x + b.w / 2},${462 - b.h * 0.9} ${b.x + b.w / 2},462Z`}
          fill={mix("#10302d", "#1d4a3b", warm * 0.6)}
        />
      ))}

      {/* Mid-ground ferns, grasses and lantern flowers */}
      {FERNS.map((fern, i) => (
        <path
          key={i}
          d={fernPath(fern, motion * wind(time, fern.x))}
          stroke={mix("#1f4a3c", "#3f7a55", warm * 0.7)}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      ))}
      {LANTERNS.map((l, i) => {
        const sway = motion * wind(time, l.x) * 0.07;
        const hx = l.x + Math.sin(sway) * l.h;
        const hy = l.y - Math.cos(sway) * l.h;
        const on = lit(l.at);
        const glow = on * (0.25 + 0.75 * response);
        const bow = (i % 2 ? 1 : -1) * l.h * 0.12;
        const mx = l.x + (hx - l.x) * 0.4 + bow;
        const my = l.y - l.h * 0.55;
        const lean = (Math.atan2(hy - my, hx - mx) * 180) / Math.PI + 90;
        return (
          <g key={i}>
            <path
              d={`M${l.x},${f(l.y)} Q${f(mx)},${f(my)} ${f(hx)},${f(hy)}`}
              stroke="#2b5c47"
              strokeWidth="2"
              fill="none"
            />
            <path
              transform={`translate(${f(l.x + bow * 0.35)} ${f(l.y - l.h * 0.28)}) rotate(${i % 2 ? -50 : -130})`}
              d="M0,0 C6,-5 16,-5 22,0 C16,4 6,4 0,0Z"
              fill="#2f6a4c"
            />
            <circle
              cx={f(hx)}
              cy={f(hy)}
              r={l.r * 5.5}
              fill={`url(#${u}lantern)`}
              opacity={(glow * 0.85).toFixed(3)}
            />
            <g transform={`translate(${f(hx)} ${f(hy)}) rotate(${f(lean)})`}>
              <circle
                r={l.r * 0.9}
                cy={-l.r * 0.15}
                fill={mix("#35614f", "#fff0c2", 0.1 + 0.9 * glow)}
              />
              <path
                d={`M${-l.r * 1.15},${f(-l.r * 0.2)} C${-l.r},${f(l.r * 1.1)} ${l.r},${f(l.r * 1.1)} ${l.r * 1.15},${f(-l.r * 0.2)} C${l.r * 0.5},${f(l.r * 0.25)} ${-l.r * 0.5},${f(l.r * 0.25)} ${-l.r * 1.15},${f(-l.r * 0.2)}Z`}
                fill={mix("#2c5a46", "#e9b866", glow * 0.7)}
              />
            </g>
          </g>
        );
      })}
      {MID_GRASS.map((b, i) => (
        <path
          key={i}
          d={bladePath(b, motion * wind(time, b.x))}
          fill={mix("#163b33", "#2f6a4b", b.tone * 0.6 + warm * 0.3)}
        />
      ))}

      {/* Ground and the mound the plant grows from */}
      <path
        d="M0,462 C160,452 300,466 420,462 C520,458 640,452 760,460 C860,466 920,458 960,462 L960,600 L0,600Z"
        fill={`url(#${u}groundGrad)`}
      />
      <path
        d="M0,462 C160,452 300,466 420,462 C520,458 640,452 760,460 C860,466 920,458 960,462"
        stroke="#f3c46b"
        strokeOpacity={(0.08 + 0.3 * response).toFixed(3)}
        strokeWidth="1.5"
        fill="none"
      />
      <ellipse cx={BASE_X} cy={BASE_Y + 6} rx={92} ry={16} fill="#0a1f1f" />
      <path
        d={`M${BASE_X - 96},${BASE_Y + 8} C${BASE_X - 60},${BASE_Y - 16} ${BASE_X + 60},${BASE_Y - 16} ${BASE_X + 96},${BASE_Y + 8}Z`}
        fill="#1a3a30"
      />
      <ellipse cx={BASE_X - 56} cy={BASE_Y + 2} rx={9} ry={5} fill="#2d4a40" />
      <ellipse cx={BASE_X + 64} cy={BASE_Y + 4} rx={7} ry={4} fill="#28453b" />
      <ellipse
        cx={BASE_X}
        cy={BASE_Y + 22}
        rx={360}
        ry={70}
        fill={`url(#${u}pool)`}
        opacity={(0.08 + 0.5 * v.glowOpacity).toFixed(3)}
      />
      {GROUND_FLOWERS.map((g, i) => {
        const on = lit(g.at);
        if (on <= 0.01) return null;
        const sway = motion * wind(time, g.x) * 2.5;
        const color = ["#ffe3a3", "#c9f2d9", "#f3c6a4"][g.hue];
        const sc = g.s * on;
        return (
          <g
            key={i}
            transform={`translate(${f(g.x)} ${f(g.y)}) scale(${sc.toFixed(3)})`}
          >
            <path
              d={`M0,0 Q${f(sway * 0.5)},-9 ${f(sway)},-18`}
              stroke="#2f6a4c"
              strokeWidth="1.6"
              fill="none"
            />
            <circle
              cx={f(sway)}
              cy={-18}
              r={14}
              fill={`url(#${u}lantern)`}
              opacity={(0.2 + 0.6 * response).toFixed(3)}
            />
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse
                key={a}
                cx={f(sway)}
                cy={-18}
                rx={4.6}
                ry={2.4}
                transform={`rotate(${a} ${f(sway)} -18) translate(4 0)`}
                fill={color}
                opacity={(0.55 + 0.45 * response).toFixed(3)}
              />
            ))}
            <circle cx={f(sway)} cy={-18} r={1.8} fill="#e2a24c" />
          </g>
        );
      })}

      {/* Halo and hero plant */}
      <circle
        cx={BASE_X}
        cy={plantMidY}
        r={150 + 150 * growth}
        fill={`url(#${u}plantHalo)`}
        opacity={v.glowOpacity.toFixed(3)}
      />
      {guide > 0.001 &&
        (() => {
          const b = breathAt(time).level;
          const r = reduced ? 135 : 92 + 80 * b;
          return (
            <g opacity={guide.toFixed(3)} aria-hidden="true">
              <circle
                cx={BASE_X}
                cy={plantMidY}
                r={f(r + 26)}
                fill={`url(#${u}guideFill)`}
                opacity={(0.25 + 0.55 * b).toFixed(3)}
              />
              <circle
                cx={BASE_X}
                cy={plantMidY}
                r={f(r)}
                fill="none"
                stroke="#ffe7b0"
                strokeWidth={1.6}
                opacity={(0.3 + 0.45 * b).toFixed(3)}
              />
              <circle
                cx={BASE_X}
                cy={plantMidY}
                r={f(r + 12)}
                fill="none"
                stroke="#ffe7b0"
                strokeWidth={0.8}
                opacity={(0.12 + 0.2 * b).toFixed(3)}
              />
            </g>
          );
        })()}
      <Plant
        growth={growth}
        response={response}
        time={time}
        motion={motion}
        u={u}
      />

      {/* Fireflies appear as the garden grows; brightness follows the signal. */}
      {FIREFLIES.map((ff, i) => {
        if (ff.order > 0.25 + 0.75 * growth) return null;
        const tt = time * ff.sp;
        const x = ff.x + Math.sin(tt * 2 + ff.ph) * ff.ax * motion;
        const y = ff.y + Math.sin(tt * 3 + ff.ph * 1.3) * ff.ay * motion;
        const flick = 0.8 + 0.2 * motion * Math.sin(time * 1.7 + ff.ph * 3);
        return (
          <circle
            key={i}
            cx={f(x)}
            cy={f(y)}
            r={7}
            fill={`url(#${u}firefly)`}
            opacity={(response * flick * 0.95).toFixed(3)}
          />
        );
      })}

      {/* Foreground grass frames the scene */}
      {FRONT_GRASS.map((b, i) => (
        <path
          key={i}
          d={bladePath(b, motion * wind(time, b.x) * 0.7)}
          fill="#061719"
        />
      ))}
      <rect width={W} height={H} fill={`url(#${u}vignette)`} />
      {paused && <rect width={W} height={H} fill="#06161b" opacity="0.38" />}
    </svg>
  );
}

export default memo(Scene);
