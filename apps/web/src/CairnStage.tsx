import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { CairnTrace } from "./research/cairnTrace";
import { research as researchLog } from "./research/logger";
import {
  initialCairn,
  stepCairn,
  startEvent,
  stoneRandom,
  gustLoad,
  RELEASE_SECONDS,
  EXIT_SECONDS,
  type CairnEvent,
  type CairnMode,
  type CairnState,
  type EventKind,
} from "./cairnSimulation";
import {
  Stack,
  STONE_SCALE,
  PRINT_MARGIN,
  plankOrigin,
  printColumn,
  type CairnManifest,
  type PlacedStone,
} from "./cairnGeometry";
import type { CairnStimulus } from "./cairnScores";
import manifestData from "./assets/cairn/manifest.json";
import woodUrl from "./assets/cairn/wood.webp";
import handOpenBigUrl from "./assets/cairn/hand_open_big.webp";
import handOpenSmallUrl from "./assets/cairn/hand_open_small.webp";
import handOpeningUrl from "./assets/cairn/hand_opening.webp";
import handClosedUrl from "./assets/cairn/hand_closed.webp";
import pivotUrl from "./assets/cairn/pivot.webp";

const stoneUrls = import.meta.glob<string>("./assets/cairn/rock*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});
/** The main photo and the views shot higher up. */
const photoUrls = import.meta.glob<string>("./assets/cairn/background*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});

const M = manifestData as unknown as CairnManifest & {
  ground: [number, number][];
  hand: { armTop: [number, number] };
  /** Full-resolution cut-out of the pivot rock, laid exactly over the background. */
  pivot: { image: { x: number; y: number; scale: number } };
};

export type CairnControls = {
  /** Every tick gate passes; physics and the hand advance only then. */
  running: boolean;
  score: number;
  /** Changing this starts a fresh cairn in `mode`. */
  reset: number;
  mode: CairnMode;
  /** Opt-in: bug lanterns blink at BUG_HZ for SSVEP. Otherwise they glow and breathe slowly. */
  flicker?: boolean;
  /** Development preview only: run the model faster than real time. */
  timeScale?: number;
  reducedMotion?: boolean;
  /** Development preview only: start this event now; a new `nonce` triggers it again. */
  debugEvent?: { kind: EventKind; strength: number; path: CairnEvent["path"]; nonce: number };
  /** Research context: why ticking is blocked, and why the next reset happens. */
  source?: string;
  usable?: boolean;
  blocker?: string | null;
  resetReason?: string;
};

export type CairnView = CairnState & {
  /** Seconds since the cairn fell; 0 while standing. */
  collapse: number;
  /** The collapse animation has finished. */
  settled: boolean;
};

/** A stretch of lantern blinking, in epoch milliseconds, for lining up with EEG. */
export type StageStimulus = Omit<CairnStimulus, "mode" | "source">;

/**
 * Lantern blink rate. 15 Hz sits outside the 8–12 Hz alpha band that drives the game,
 * and is an exact square wave on 60, 120 and 240 Hz displays (2, 4 or 8 frames on, then off).
 */
export const BUG_HZ = 15;

const W = 1200;
const H = 800;
/** The camera's closest framing, for a short cairn. */
const MAX_ZOOM = Math.min(H / 640, W / 980);
/**
 * The photo, its pivot rock and the plank are drawn this much smaller than the world the hand
 * and stones live in, so the hand reads at a believable size. The photo ships finer than world
 * units, so drawing it smaller also sharpens it.
 */
const SCENE = 0.85;
const TIP = { x: M.pivot.tip[0] * SCENE, y: M.pivot.tip[1] * SCENE };
const PIVOT_BASE = M.pivot.base * SCENE;
/** Hand photos from widest pinch to closed; the hand shares the stones' scale. */
const HAND = ["hand_open_big", "hand_open_small", "hand_opening", "hand_closed"] as const;
type HandFrame = (typeof HAND)[number];
const HAND_SCALE = STONE_SCALE;
/** Pinch point between index fingertip and thumb in a frame, where a carried stone's centre sits. */
function pinch(frame: HandFrame) {
  const t = M.hand.tips[frame];
  return {
    x: (t[0][0] + t[t.length - 1][0]) / 2,
    y: (t[0][1] + t[t.length - 1][1]) / 2 - 18,
  };
}
const ANCHOR = pinch("hand_open_big");
/** Narrow stones are carried in the smaller pinch so the fingertips touch them. */
function carryPose(kind: number): HandFrame {
  const o = M[`rock${kind}`].object;
  return (o[2] - o[0]) * STONE_SCALE < 140 ? "hand_open_small" : "hand_open_big";
}
/** Unit vector from the pinch up the forearm: the hand arrives and leaves along it. */
const ARM = (() => {
  const dx = M.hand.armTop[0] - ANCHOR.x;
  const dy = M.hand.armTop[1] - ANCHOR.y;
  const n = Math.hypot(dx, dy);
  return { x: dx / n, y: dy / n };
})();
const PLANK = plankOrigin(M.wood);
const PLANK_HALF = ((M.wood.object[2] - M.wood.object[0]) / 2) * SCENE;
const SHADOW = { x: 6, y: 8, alpha: 0.42 };
/** The main photo with the higher views taped above it, in photo world units. */
const COLUMN = printColumn(M.background);
/** The camera keeps this far inside the column, so the shake when the cairn falls never shows the page. */
const EDGE = 12;
/** What the camera may show, in world units: only photos, never the bare page. */
const BOUNDS = {
  left: COLUMN.left * SCENE + EDGE,
  right: COLUMN.right * SCENE - EDGE,
  top: COLUMN.top * SCENE + EDGE,
  bottom: COLUMN.bottom * SCENE - EDGE,
};
/** The camera's widest framing: the view just fills the photo column. */
const MIN_ZOOM = Math.max(W / (BOUNDS.right - BOUNDS.left), H / (BOUNDS.bottom - BOUNDS.top));
const PAGE = { x: -3000, y: BOUNDS.top - 2000, w: 8000, h: BOUNDS.bottom - BOUNDS.top + 4000 };
const GRAVITY = 2400;
const SETTLE_SECONDS = 2.6;
/** Firefly texture: canvas size, the body's centre in it, and its lantern relative to that centre. */
const BUG = { w: 320, h: 200, cx: 160, cy: 100, lantern: { x: -92, y: 14 }, feet: 66, length: 250 };

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;
const smooth = (a: number, b: number, t: number) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Boulder top edge under world x, in world units; fallen stones bounce and bugs walk here. */
function groundAt(x: number) {
  const g = M.ground;
  const gx = x / SCENE;
  if (gx <= g[0][0]) return g[0][1] * SCENE;
  for (let i = 1; i < g.length; i++)
    if (gx <= g[i][0]) {
      const [x0, y0] = g[i - 1];
      const [x1, y1] = g[i];
      return (y0 + ((y1 - y0) * (gx - x0)) / (x1 - x0)) * SCENE;
    }
  return g[g.length - 1][1] * SCENE;
}

/** Plank tilt when one end rests on the boulder. */
function restAngle(sign: number) {
  const endX = TIP.x + sign * PLANK_HALF;
  const drop = groundAt(endX) - TIP.y + 6;
  return sign * Math.asin(Math.min(0.9, Math.max(0.2, drop / PLANK_HALF)));
}

type StoneSprite = {
  stone: PlacedStone;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
};
type Debris = StoneSprite & {
  vx: number;
  vy: number;
  spin: number;
  bounces: number;
  /** Seconds the stone still rides the tipping plank before sliding off. */
  delay: number;
  /** 0 at the bottom of the stack, 1 at the top: higher stones fly further. */
  height: number;
  index: number;
};
/** A wind streak or a leaf blowing through during a gust. */
type Gust = {
  img: Phaser.GameObjects.Image;
  vx: number;
  wave: number;
  phase: number;
  spin: number;
  age: number;
};

function makeShadowTexture(scene: Phaser.Scene, key: string) {
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const pad = 14;
  const tex = scene.textures.createCanvas(`${key}-shadow`, src.width + pad * 2, src.height + pad * 2);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.filter = "blur(5px)";
  ctx.drawImage(src, pad, pad);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#1a140c";
  ctx.fillRect(0, 0, tex.width, tex.height);
  tex.refresh();
}

/** Warm scrapbook card with paper fibres and speckles, tiled behind the photo. */
function makePaperTexture(scene: Phaser.Scene) {
  const size = 512;
  const tex = scene.textures.createCanvas("paper", size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.fillStyle = "#e8dcc3";
  ctx.fillRect(0, 0, size, size);
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) {
    const v = rand() < 0.5 ? 255 : 90;
    ctx.fillStyle = `rgba(${v},${v - 10},${v - 30},${0.05 + rand() * 0.07})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const l = 6 + rand() * 18;
    ctx.strokeStyle = `rgba(120,95,60,${0.06 + rand() * 0.06})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rand() * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  tex.refresh();
}

function makePrintShadow(scene: Phaser.Scene, w: number, h: number) {
  const pad = 40;
  const tex = scene.textures.createCanvas("print-shadow", w + pad * 2, h + pad * 2);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.filter = "blur(14px)";
  ctx.fillStyle = "rgba(40,28,12,0.55)";
  ctx.fillRect(pad, pad, w, h);
  tex.refresh();
}

const PAPER_WHITE = "#fbfaf6";
const INK = "#2a1f16";

/**
 * A side-on firefly cut from paper, facing right: two leg poses, folded or spread wings,
 * and its lantern lit. Every part is first drawn fat in white so it gets a scissored margin.
 */
function makeBugTextures(scene: Phaser.Scene) {
  const { cx, cy } = BUG;
  const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(cx + x, cy + y, rx, ry, rot, 0, Math.PI * 2);
  };
  const legs = (ctx: CanvasRenderingContext2D, pose: number, width: number) => {
    const hips = [40, 10, -22];
    const knee = pose === 0 ? [14, -4, -18] : [2, 8, -6];
    const foot = pose === 0 ? [28, -12, -32] : [6, 18, -14];
    ctx.lineWidth = width;
    hips.forEach((hx, i) => {
      ctx.beginPath();
      ctx.moveTo(cx + hx, cy + 20);
      ctx.lineTo(cx + hx + knee[i], cy + 42);
      ctx.lineTo(cx + hx + foot[i], cy + 60);
      ctx.stroke();
    });
  };
  const antennae = (ctx: CanvasRenderingContext2D, width: number) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx + 98, cy - 2);
    ctx.quadraticCurveTo(cx + 118, cy - 30, cx + 140, cy - 48);
    ctx.moveTo(cx + 94, cy - 4);
    ctx.quadraticCurveTo(cx + 106, cy - 36, cx + 120, cy - 60);
    ctx.stroke();
  };
  const body = (ctx: CanvasRenderingContext2D, paper: boolean) => {
    const fill = (color: string) => {
      ctx.fillStyle = paper ? PAPER_WHITE : color;
      ctx.fill();
      if (paper) ctx.stroke();
    };
    ellipse(ctx, -18, 0, 88, 36);
    fill("#3b2c1f");
    ellipse(ctx, -92, 14, 30, 20);
    fill("#e7e0a8");
    ellipse(ctx, 62, -8, 32, 26);
    fill("#e07b39");
    ellipse(ctx, 92, 8, 14, 14);
    fill(INK);
    if (paper) return;
    ctx.strokeStyle = "#c9a04e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx - 18, cy - 3, 78, 26, 0, Math.PI * 1.08, Math.PI * 1.9);
    ctx.stroke();
    ctx.strokeStyle = "#c2b97f";
    ctx.lineWidth = 2;
    for (const dx of [-82, -100]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx, cy + 14, 6, 17, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
    ellipse(ctx, 64, -12, 11, 8);
    ctx.fillStyle = INK;
    ctx.fill();
    ellipse(ctx, 98, 4, 4, 4);
    ctx.fillStyle = "#f4efe2";
    ctx.fill();
  };
  for (const pose of [0, 1]) {
    const tex = scene.textures.createCanvas(`bug-${pose}`, BUG.w, BUG.h);
    if (!tex) continue;
    const ctx = tex.getContext();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = PAPER_WHITE;
    legs(ctx, pose, 18);
    antennae(ctx, 16);
    ctx.lineWidth = 14;
    body(ctx, true);
    ctx.strokeStyle = INK;
    legs(ctx, pose, 6);
    antennae(ctx, 4);
    body(ctx, false);
    tex.refresh();
  }
  // Spread wings, translucent like vellum, rooted behind the head shield.
  const wings = scene.textures.createCanvas("bug-wings", BUG.w, BUG.h);
  if (wings) {
    const ctx = wings.getContext();
    for (const [x, y, rx, ry, rot] of [
      [-36, -50, 72, 22, -0.38],
      [-44, -38, 66, 18, -0.16],
    ]) {
      ellipse(ctx, x, y, rx, ry, rot);
      ctx.fillStyle = "rgba(251,250,246,0.95)";
      ctx.fill();
      ellipse(ctx, x, y, rx - 5, ry - 5, rot);
      ctx.fillStyle = "rgba(214,226,236,0.9)";
      ctx.fill();
      ctx.strokeStyle = "rgba(110,124,138,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    wings.refresh();
  }
  // The lit lantern, laid over the pale one.
  const lit = scene.textures.createCanvas("bug-lantern", BUG.w, BUG.h);
  if (lit) {
    const ctx = lit.getContext();
    const g = ctx.createRadialGradient(cx - 96, cy + 12, 2, cx - 92, cy + 14, 30);
    g.addColorStop(0, "#fffff0");
    g.addColorStop(0.5, "#f4ff8a");
    g.addColorStop(1, "#d8f04a");
    ellipse(ctx, -92, 14, 30, 20);
    ctx.fillStyle = g;
    ctx.fill();
    lit.refresh();
  }
  const glow = scene.textures.createCanvas("bug-glow", 128, 128);
  if (glow) {
    const ctx = glow.getContext();
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,210,1)");
    g.addColorStop(0.3, "rgba(220,255,120,0.6)");
    g.addColorStop(1, "rgba(160,230,60,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    glow.refresh();
  }
}

/** Chalky wind streaks and two paper leaves for gusts. */
function makeGustTextures(scene: Phaser.Scene) {
  const streak = scene.textures.createCanvas("streak", 256, 28);
  if (streak) {
    const ctx = streak.getContext();
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, "rgba(251,250,246,0)");
    g.addColorStop(0.55, "rgba(251,250,246,0.9)");
    g.addColorStop(1, "rgba(251,250,246,0)");
    ctx.strokeStyle = g;
    ctx.lineCap = "round";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(4, 18);
    ctx.bezierCurveTo(80, 6, 170, 26, 252, 10);
    ctx.stroke();
    streak.refresh();
  }
  ["#c8742c", "#8a9c3e"].forEach((color, i) => {
    const tex = scene.textures.createCanvas(`leaf-${i}`, 76, 44);
    if (!tex) return;
    const ctx = tex.getContext();
    const leaf = () => {
      ctx.beginPath();
      ctx.moveTo(8, 22);
      ctx.quadraticCurveTo(34, -4, 68, 22);
      ctx.quadraticCurveTo(34, 48, 8, 22);
      ctx.closePath();
    };
    ctx.lineJoin = "round";
    leaf();
    ctx.fillStyle = PAPER_WHITE;
    ctx.strokeStyle = PAPER_WHITE;
    ctx.lineWidth = 10;
    ctx.fill();
    ctx.stroke();
    leaf();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,20,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 22);
    ctx.lineTo(64, 22);
    ctx.stroke();
    tex.refresh();
  });
}

export default function CairnStage({
  controls,
  onState,
  onStimulus,
  active = true,
  trace,
}: {
  controls: CairnControls;
  /** Research instrumentation (observes the model; never changes it). */
  trace?: CairnTrace;
  onState: (v: CairnView) => void;
  /** Called when a stretch of lantern blinking ends. */
  onStimulus?: (s: StageStimulus) => void;
  /** False while the stage is hidden: the render loop sleeps. */
  active?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Phaser.Game | null>(null);
  const current = useRef(controls);
  current.current = controls;
  const report = useRef(onState);
  report.current = onState;
  const stimulus = useRef(onStimulus);
  stimulus.current = onStimulus;
  const tracer = useRef(trace);
  tracer.current = trace;

  useEffect(() => {
    // Render at the screen's pixel density (up to 2x) so photo detail survives on sharp displays.
    const density = Math.min(2, Math.max(1, (host.current!.clientWidth * window.devicePixelRatio) / W));
    let live: CairnScene | null = null;
    class CairnScene extends Phaser.Scene {
      private sim = initialCairn();
      private stack = new Stack(M, 1, SCENE);
      private resetId = -1;
      private round = 0;
      private tower!: Phaser.GameObjects.Container;
      private plank!: Phaser.GameObjects.Image;
      private plankShadow!: Phaser.GameObjects.Image;
      private stones: StoneSprite[] = [];
      private debris: Debris[] = [];
      private handGroup!: Phaser.GameObjects.Container;
      private hand!: Phaser.GameObjects.Image;
      private handShadow!: Phaser.GameObjects.Image;
      private carried!: Phaser.GameObjects.Image;
      private carriedShadow!: Phaser.GameObjects.Image;
      private landing: PlacedStone | null = null;
      private pose: HandFrame = "hand_open_big";
      private collapse = 0;
      private plankAngle = 0;
      private plankVelocity = 0;
      private handExit: { x: number; y: number; t: number } | null = null;
      private lastPlaced: { x: number; y: number } | null = null;
      private zoom = 1;
      private focusX = TIP.x;
      private focusY = TIP.y;
      private snapCamera = true;
      private reported = 0;
      private bug!: Phaser.GameObjects.Container;
      private bugBody!: Phaser.GameObjects.Image;
      private bugShadow!: Phaser.GameObjects.Image;
      private bugWings!: Phaser.GameObjects.Image;
      private bugLantern!: Phaser.GameObjects.Image;
      private bugGlow!: Phaser.GameObjects.Image;
      /** The bug that was crossing when the cairn fell or the round ended fades out. */
      private bugFade = 0;
      private flick: { start: number; event: CairnEvent } | null = null;
      private wind!: Phaser.GameObjects.Container;
      private gusts: Gust[] = [];
      private streakDue = 0;
      private leafDue = 0;
      private debugNonce = 0;

      preload() {
        for (const [path, url] of Object.entries(photoUrls)) {
          const name = path.match(/(background\w*)\.jpg$/)?.[1];
          if (name) this.load.image(name, url);
        }
        this.load.image("pivot", pivotUrl);
        this.load.image("wood", woodUrl);
        this.load.image("hand_open_big", handOpenBigUrl);
        this.load.image("hand_open_small", handOpenSmallUrl);
        this.load.image("hand_opening", handOpeningUrl);
        this.load.image("hand_closed", handClosedUrl);
        for (const [path, url] of Object.entries(stoneUrls)) {
          const name = path.match(/(rock\d+)\.webp$/)?.[1];
          if (name) this.load.image(name, url);
        }
      }

      create() {
        live = this;
        makePaperTexture(this);
        makeBugTextures(this);
        makeGustTextures(this);
        makePrintShadow(this, M.background.w + PRINT_MARGIN * 2, M.background.h + PRINT_MARGIN * 2);
        for (const key of [
          "wood",
          ...HAND,
          "bug-0",
          ...Object.keys(stoneUrls).map((p) => p.match(/(rock\d+)/)![1]),
        ])
          makeShadowTexture(this, key);

        // The scrapbook page, then the photo prints taped onto it, drawn at the scene's scale.
        // Each higher view is laid over the top of the print below it.
        this.add.tileSprite(PAGE.x, PAGE.y, PAGE.w, PAGE.h, "paper").setOrigin(0);
        const page = this.add.container(0, 0).setScale(SCENE);
        COLUMN.prints.forEach((p, i) => {
          const hw = p.w / 2;
          const hh = p.h / 2;
          const print = this.add.container(p.x, p.y).setRotation(p.rotation);
          print.add([
            this.add
              .image(10, 16, "print-shadow")
              .setDisplaySize(p.w + PRINT_MARGIN * 2 + 80, p.h + PRINT_MARGIN * 2 + 80),
            this.add.rectangle(0, 0, p.w + PRINT_MARGIN * 2, p.h + PRINT_MARGIN * 2, 0xfbfaf6),
            this.add.image(0, 0, p.name).setScale(p.scale).setFlipX(p.flip),
          ]);
          if (i === 0) {
            const pivot = M.pivot.image;
            print.add(this.add.image(pivot.x - hw, pivot.y - hh, "pivot").setOrigin(0).setScale(pivot.scale));
          }
          const tape: number[][] = [
            [-hw - 14, hh + 8, 0.55],
            [hw + 14, hh + 8, -0.55],
          ];
          // The next print up covers this one's top corners.
          if (i === COLUMN.prints.length - 1) tape.push([-hw - 10, -hh - 12, -0.62], [hw + 10, -hh - 12, 0.62]);
          // Strips across the seam hold a higher view down, clear of the cairn in the middle.
          if (i > 0)
            tape.push(
              [-hw * (0.67 - 0.05 * i), hh + PRINT_MARGIN, 1.32 + 0.08 * i],
              [hw * (0.52 + 0.06 * i), hh + PRINT_MARGIN, -1.4 + 0.07 * i],
            );
          for (const [x, y, r] of tape)
            print.add(this.add.rectangle(x, y, 210, 58, 0xefe3c4, 0.78).setRotation(r));
          page.add(print);
        });

        this.tower = this.add.container(TIP.x, TIP.y);
        this.plankShadow = this.add
          .image(SHADOW.x, SHADOW.y, "wood-shadow")
          .setOrigin((PLANK.x + 14) / (M.wood.w + 28), (PLANK.y + 14) / (M.wood.h + 28))
          .setScale(SCENE)
          .setAlpha(SHADOW.alpha);
        this.plank = this.add
          .image(0, 0, "wood")
          .setOrigin(PLANK.x / M.wood.w, PLANK.y / M.wood.h)
          .setScale(SCENE);
        this.tower.add([this.plankShadow, this.plank]);

        // The firefly: body and wings share the texture frame, so they stay in register.
        this.bugShadow = this.add.image(4, 6, "bug-0-shadow");
        this.bugBody = this.add.image(0, 0, "bug-0");
        this.bugWings = this.add
          .image(0, 0, "bug-wings")
          .setOrigin((BUG.cx + 20) / BUG.w, (BUG.cy - 26) / BUG.h);
        this.bugWings.setPosition(20, -26);
        this.bugLantern = this.add.image(0, 0, "bug-lantern");
        this.bugGlow = this.add
          .image(BUG.lantern.x, BUG.lantern.y, "bug-glow")
          .setBlendMode(Phaser.BlendModes.ADD);
        this.bug = this.add.container(0, 0, [
          this.bugShadow,
          this.bugBody,
          this.bugWings,
          this.bugLantern,
          this.bugGlow,
        ]);
        this.bug.setVisible(false);
        this.wind = this.add.container(0, 0);

        // The hand group pivots on the pinch point; the carried stone sits behind the fingers.
        const ax = ANCHOR.x / M.hand.w;
        const ay = ANCHOR.y / M.hand.h;
        this.handShadow = this.add
          .image(SHADOW.x * 1.6, SHADOW.y * 1.6, "hand_open_big-shadow")
          .setOrigin((ANCHOR.x + 14) / (M.hand.w + 28), (ANCHOR.y + 14) / (M.hand.h + 28))
          .setScale(HAND_SCALE)
          .setAlpha(SHADOW.alpha);
        this.carriedShadow = this.add.image(SHADOW.x * 1.6, SHADOW.y * 1.6, "rock1-shadow").setAlpha(SHADOW.alpha);
        this.carried = this.add.image(0, 0, "rock1");
        this.hand = this.add.image(0, 0, "hand_open_big").setOrigin(ax, ay).setScale(HAND_SCALE);
        this.handGroup = this.add.container(0, 0, [this.handShadow, this.carriedShadow, this.carried, this.hand]);
        this.handGroup.setVisible(false);
      }

      private newRound(time: number) {
        const c = current.current;
        this.endFlicker(time, "round_reset");
        this.round += 1;
        const seed = (Date.now() ^ (this.round * 7919)) >>> 0;
        this.sim = initialCairn(c.mode, seed);
        tracer.current?.newRound(
          this.sim,
          {
            mode: c.mode,
            seed,
            flicker: !!c.flicker,
            reducedMotion: !!c.reducedMotion,
            timeScale: c.timeScale ?? 1,
          },
          c.resetReason ?? "reset",
          performance.timeOrigin + time,
          c.reset,
        );
        this.stack = new Stack(M, seed, SCENE);
        for (const s of [...this.stones, ...this.debris]) {
          s.img.destroy();
          s.shadow.destroy();
        }
        for (const g of this.gusts) g.img.destroy();
        this.gusts = [];
        this.stones = [];
        this.debris = [];
        this.landing = null;
        this.collapse = 0;
        this.plankAngle = 0;
        this.plankVelocity = 0;
        this.handExit = null;
        this.lastPlaced = null;
        this.bugFade = 0;
        this.bug.setVisible(false);
        this.tower.setRotation(0);
        this.handGroup.setVisible(false);
        this.snapCamera = true;
        report.current({ ...this.sim, collapse: 0, settled: false });
      }

      private toWorld(x: number, y: number, angle = this.sim.angle) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return { x: TIP.x + x * c - y * s, y: TIP.y + x * s + y * c };
      }

      private stoneSprites(stone: PlacedStone, parent?: Phaser.GameObjects.Container) {
        const key = `rock${stone.kind}`;
        const shadow = this.add
          .image(stone.x + SHADOW.x, stone.y + SHADOW.y, `${key}-shadow`)
          .setScale(STONE_SCALE)
          .setFlipX(stone.flip)
          .setAlpha(SHADOW.alpha);
        const img = this.add.image(stone.x, stone.y, key).setScale(STONE_SCALE).setFlipX(stone.flip);
        if (parent) parent.add([shadow, img]);
        return { stone, img, shadow };
      }

      private placeStone() {
        const index = this.stack.stones.length;
        const stone = this.stack.place(index);
        this.stones.push(this.stoneSprites(stone, this.tower));
        this.lastPlaced = { x: stone.x, y: stone.y };
        this.landing = null;
      }

      private startCollapse() {
        const sign = Math.sign(this.sim.angle || this.sim.velocity || 1);
        this.plankAngle = this.sim.angle;
        this.plankVelocity = this.sim.velocity + sign * 0.4;
        const all = [...this.stones];
        // In go mode the stone that knocked it over joins the fall from the hand.
        if (this.sim.cause === "drop" && this.landing) {
          const p = this.handGroup;
          const s = this.stoneSprites(this.landing);
          const local = this.worldToLocal(p.x, p.y);
          s.stone = { ...this.landing, x: local.x, y: local.y };
          all.push(s);
          this.carried.setVisible(false);
          this.carriedShadow.setVisible(false);
        }
        const n = all.length;
        // The top topples first; lower stones ride the tipping plank a moment longer.
        all.forEach((s, i) => {
          if (s.img.parentContainer) this.tower.remove([s.shadow, s.img]);
          const d: Debris = {
            ...s,
            vx: 0,
            vy: 0,
            spin: 0,
            bounces: 0,
            delay: Math.min(0.6, 0.025 * (n - 1 - i)),
            height: n > 1 ? i / (n - 1) : 1,
            index: i,
          };
          this.ride(d);
          if (d.delay <= 0) this.release(d);
          this.debris.push(d);
        });
        this.stones = [];
        if (this.handGroup.visible) this.handExit = { x: this.handGroup.x, y: this.handGroup.y, t: 0 };
        if (this.bug.visible) this.bugFade = 1;
        if (!current.current.reducedMotion) {
          // Phaser shakes by up to intensity × width × zoom world units; keep it inside EDGE.
          const cam = this.cameras.main;
          cam.shake(260, Math.min(0.004, EDGE / (cam.width * cam.zoom)));
        }
      }

      private ride(d: Debris) {
        const w = this.toWorld(d.stone.x, d.stone.y, this.plankAngle);
        d.img.setPosition(w.x, w.y).setRotation(this.plankAngle);
        d.shadow.setPosition(w.x + SHADOW.x, w.y + SHADOW.y).setRotation(this.plankAngle);
      }

      /** Let go of the plank with its swing, sliding downhill. */
      private release(d: Debris) {
        const sign = Math.sign(this.plankAngle || 1);
        const omega = this.plankVelocity;
        const r = (k: number) => stoneRandom(this.sim.seed, d.index, 10 + k) - 0.5;
        d.vx = -omega * (d.img.y - TIP.y) + sign * (70 + 220 * d.height) + 60 * r(1);
        d.vy = omega * (d.img.x - TIP.x) - 60 * d.height + 40 * r(2);
        d.spin = sign * (0.8 + 2.2 * d.height) + 1.5 * r(3);
      }

      private worldToLocal(x: number, y: number) {
        const c = Math.cos(-this.sim.angle);
        const s = Math.sin(-this.sim.angle);
        const dx = x - TIP.x;
        const dy = y - TIP.y;
        return { x: dx * c - dy * s, y: dx * s + dy * c };
      }

      private offPageDistance(target: { x: number; y: number }) {
        // Far enough along the arm that the hand clears the top of the view.
        const view = this.cameras.main.worldView;
        return Math.max(500, (target.y - view.top + 140) / -ARM.y);
      }

      private drawHand(dt: number) {
        const s = this.sim;
        const g = this.handGroup;
        if (this.handExit) {
          // After a fall the hand withdraws from wherever it was.
          const e = this.handExit;
          e.t += dt;
          const t = Math.min(1, e.t / EXIT_SECONDS);
          const d = this.offPageDistance(e) * easeIn(t);
          g.setPosition(e.x + ARM.x * d, e.y + ARM.y * d).setRotation(0);
          this.setHandFrame("hand_closed");
          this.carried.setVisible(false);
          this.carriedShadow.setVisible(false);
          g.setVisible(t < 1);
          return;
        }
        if (s.fallen) return;
        if (s.phase === "wait") {
          g.setVisible(false);
          return;
        }
        g.setVisible(true);
        if (s.phase === "approach") {
          if (!this.landing) this.landing = this.stack.landing(this.stack.stones.length);
          const l = this.landing;
          const key = `rock${l.kind}`;
          this.pose = carryPose(l.kind);
          // The group pivots on the stone; the hand shifts so its pinch closes on it.
          const p = pinch(this.pose);
          this.hand.setPosition((ANCHOR.x - p.x) * HAND_SCALE, (ANCHOR.y - p.y) * HAND_SCALE);
          this.handShadow.setPosition(
            this.hand.x + SHADOW.x * 1.6,
            this.hand.y + SHADOW.y * 1.6,
          );
          this.carried.setTexture(key).setScale(STONE_SCALE).setFlipX(l.flip).setVisible(true);
          this.carriedShadow
            .setTexture(`${key}-shadow`)
            .setScale(STONE_SCALE)
            .setFlipX(l.flip)
            .setVisible(true);
          const target = this.toWorld(l.x, l.y);
          const d = this.offPageDistance(target) * (1 - easeOut(s.approach));
          g.setPosition(target.x + ARM.x * d, target.y + ARM.y * d);
          g.setRotation(s.angle * smooth(0.6, 1, s.approach));
          this.setHandFrame(this.pose);
          return;
        }
        this.carried.setVisible(false);
        this.carriedShadow.setVisible(false);
        const placed = this.lastPlaced ?? { x: 0, y: this.stack.top };
        const base = this.toWorld(placed.x, placed.y);
        if (s.phase === "release") {
          const t = Math.min(1, s.phaseTime / RELEASE_SECONDS);
          const closing = HAND.slice(HAND.indexOf(this.pose) + 1);
          this.setHandFrame(closing[Math.min(closing.length - 1, Math.floor(t * closing.length))]);
          g.setPosition(base.x + ARM.x * 12 * t, base.y - 46 * easeOut(t) + ARM.y * 12 * t);
          g.setRotation(s.angle * (1 - t));
          return;
        }
        // exit: back the way it came, from where the release left it just above the stone.
        const rest = { x: base.x + ARM.x * 12, y: base.y - 46 + ARM.y * 12 };
        const t = Math.min(1, s.phaseTime / EXIT_SECONDS);
        const d = this.offPageDistance(rest) * easeIn(t);
        g.setPosition(rest.x + ARM.x * d, rest.y + ARM.y * d).setRotation(0);
        this.setHandFrame("hand_closed");
      }

      private setHandFrame(key: HandFrame) {
        if (this.hand.texture.key === key) return;
        this.hand.setTexture(key);
        this.handShadow.setTexture(`${key}-shadow`);
      }

      private drawTower() {
        const s = this.sim;
        if (s.fallen) {
          this.tower.setRotation(this.plankAngle);
          return;
        }
        this.tower.setRotation(s.angle);
        // Upper stones lag the swing a little, like a real stack flexing.
        const top = Math.max(1, -this.stack.top);
        for (const { stone, img, shadow } of this.stones) {
          const h = -stone.y / top;
          const lag = -s.velocity * 0.05 * h * h;
          const dx = lag * -stone.y * 0.35;
          img.setPosition(stone.x + dx, stone.y).setRotation(lag);
          shadow.setPosition(stone.x + dx + SHADOW.x, stone.y + SHADOW.y).setRotation(lag);
        }
      }

      /**
       * The firefly crosses the view along the boulder or through the air. Its lantern
       * blinks at BUG_HZ while the game runs, if flicker is on, as an SSVEP stimulus;
       * otherwise it glows and breathes slowly.
       */
      private drawBug(time: number, frame: number) {
        const c = current.current;
        const e = this.sim.event;
        if (this.bugFade > 0) {
          this.bugFade = Math.max(0, this.bugFade - frame / 0.4);
          this.bug.setAlpha(this.bugFade).setVisible(this.bugFade > 0);
        }
        const crossing = e?.kind === "bug" && !this.sim.fallen;
        const flickering = crossing && c.running && !!c.flicker && !c.reducedMotion;
        if (!flickering)
          this.endFlicker(
            time,
            !crossing
              ? this.sim.fallen
                ? "cairn_fell"
                : "bug_ended"
              : !c.running
                ? "paused"
                : !c.flicker
                  ? "setting_off"
                  : "reduced_motion",
          );
        if (!crossing) {
          if (this.bugFade <= 0) this.bug.setVisible(false);
          return;
        }
        if (flickering && !this.flick) {
          this.flick = { start: time, event: e };
          tracer.current?.flickerStarted(performance.timeOrigin + time, e);
        }
        this.bug.setVisible(true).setAlpha(1);
        const view = this.cameras.main.worldView;
        // Sized against the view, so a big firefly stays big as the camera pulls back for a tall cairn.
        const zoomOut = MAX_ZOOM / this.zoom;
        const size = ((30 + 65 * e.strength) / BUG.length) * zoomOut;
        const margin = BUG.length * size;
        const p = e.time / e.duration;
        const air = e.path === "air";
        let x0 = view.left - margin;
        let x1 = view.right + margin;
        if (!air) {
          // Walk on the photo's boulder, entering from the print's edge if the view is wider.
          x0 = Math.max(x0, M.ground[0][0] * SCENE - margin * 0.5);
          x1 = Math.min(x1, M.ground[M.ground.length - 1][0] * SCENE + margin * 0.5);
        }
        if (e.direction < 0) [x0, x1] = [x1, x0];
        const x = x0 + (x1 - x0) * p;
        let y: number;
        let rotation: number;
        if (air) {
          const r = (k: number) => stoneRandom(this.sim.seed, e.index, 30 + k);
          const height = 0.16 + 0.3 * r(1);
          const drift = (t: number) =>
            view.top + view.height * (height + 0.05 * Math.sin(2.2 * t + 6 * r(2))) + 6 * Math.sin(10.7 * t);
          y = drift(e.time);
          rotation = Math.atan2(drift(e.time + 0.05) - y, Math.abs(x1 - x0) * (0.05 / e.duration)) * 0.5 * e.direction;
          // Wings beat smoothly at 5 Hz, well away from the lantern's rate.
          this.bugWings.setVisible(true).setScale(1, 0.25 + 0.75 * Math.abs(Math.sin(Math.PI * 5 * e.time)));
          this.bugBody.setTexture("bug-1");
          this.bugShadow.setPosition(30, 90).setAlpha(0.16);
        } else {
          const bob = Math.abs(Math.sin((Math.abs(x - x0) / (margin * 0.12)) * Math.PI)) * 2 * size;
          y = groundAt(x) - BUG.feet * size - bob;
          rotation = Math.atan2(groundAt(x + 8) - groundAt(x - 8), 16);
          this.bugWings.setVisible(false);
          // Legs step with distance covered, not with a clock.
          this.bugBody.setTexture(Math.floor(Math.abs(x - x0) / (margin * 0.12)) % 2 ? "bug-1" : "bug-0");
          this.bugShadow.setPosition(4, 6).setAlpha(0.4);
        }
        this.bug.setPosition(x, y).setScale(e.direction * size, size).setRotation(rotation);
        const glowSize = ((40 + 100 * e.strength) * zoomOut) / 128 / size;
        const bright = 0.55 + 0.45 * e.strength;
        let lit: number;
        if (flickering && this.flick) {
          // Square wave from the frame clock. The 1/8-cycle offset keeps frame edges clear of the switch.
          lit = Math.floor((2 * BUG_HZ * (time - this.flick.start)) / 1000 + 0.125) % 2 === 0 ? 1 : 0;
        } else {
          lit = c.running ? 0.6 + 0.3 * Math.sin(2 * Math.PI * 0.8 * (time / 1000)) : 0.85;
        }
        this.bugLantern.setAlpha(lit);
        this.bugGlow.setScale(glowSize).setAlpha(lit * bright);
      }

      /** Close the current stretch of blinking and log it. */
      endFlicker(time: number, reason = "ended") {
        if (!this.flick) return;
        tracer.current?.flickerEnded(performance.timeOrigin + time, reason);
        const e = this.flick.event;
        const origin = performance.timeOrigin;
        if (time > this.flick.start)
          stimulus.current?.({
            start: Math.round(origin + this.flick.start),
            end: Math.round(origin + time),
            hz: BUG_HZ,
            strength: Math.round(e.strength * 100) / 100,
            path: e.path,
          });
        this.flick = null;
      }

      /** Streaks of wind, and leaves in the stronger gusts, blowing across the view. */
      private drawGust(frame: number) {
        const c = current.current;
        const e = this.sim.event;
        const view = this.cameras.main.worldView;
        const load = this.sim.fallen ? 0 : gustLoad(this.sim);
        const moving = c.running || this.sim.fallen;
        const dt = moving ? frame * (c.timeScale ?? 1) : 0;
        if (e?.kind === "gust" && load > 0.01 && c.running) {
          const dir = e.direction;
          const sparse = c.reducedMotion ? 0.3 : 1;
          const spawn = (leaf: boolean) => {
            const r = Math.random;
            const key = leaf ? `leaf-${r() < 0.5 ? 0 : 1}` : "streak";
            const span = view.width / 1200;
            const scale = leaf ? span * (0.5 + 0.4 * e.strength) : span * (0.5 + 0.9 * r()) * (0.6 + 0.7 * e.strength);
            const img = this.add
              .image(dir > 0 ? view.left - 300 * scale : view.right + 300 * scale, view.top + view.height * (0.08 + 0.84 * r()), key)
              .setScale(dir * scale, scale)
              .setAlpha(leaf ? 1 : (0.25 + 0.5 * load) * (0.6 + 0.4 * r()));
            this.wind.add(img);
            this.gusts.push({
              img,
              vx: dir * view.width * (0.9 + 0.6 * r()) * (0.75 + 0.5 * e.strength) * (leaf ? 0.6 : 1),
              wave: leaf ? 30 + 40 * r() : 8 * r(),
              phase: r() * 6,
              spin: leaf ? dir * (3 + 5 * r()) : 0,
              age: 0,
            });
          };
          this.streakDue += dt * (4 + 36 * load) * sparse;
          for (; this.streakDue >= 1; this.streakDue -= 1) spawn(false);
          if (e.strength > 0.35) {
            this.leafDue += dt * 3 * load * sparse;
            for (; this.leafDue >= 1; this.leafDue -= 1) spawn(true);
          }
        }
        this.gusts = this.gusts.filter((g) => {
          g.age += dt;
          const vy = g.wave * Math.cos(4 * g.age + g.phase);
          g.img.x += g.vx * dt;
          g.img.y += vy * dt;
          g.img.rotation += g.spin * dt;
          const gone = g.vx > 0 ? g.img.x > view.right + 400 : g.img.x < view.left - 400;
          if (gone || g.age > 6) g.img.destroy();
          return !(gone || g.age > 6);
        });
      }

      private stepCollapse(dt: number) {
        this.collapse += dt;
        const rest = restAngle(Math.sign(this.plankAngle || 1));
        this.plankVelocity += Math.sign(rest) * 7 * dt;
        this.plankAngle += this.plankVelocity * dt;
        if (Math.abs(this.plankAngle) >= Math.abs(rest)) {
          this.plankAngle = rest;
          this.plankVelocity = Math.abs(this.plankVelocity) > 0.4 ? -this.plankVelocity * 0.25 : 0;
        }
        for (const d of this.debris) {
          if (d.delay > 0) {
            d.delay -= dt;
            this.ride(d);
            if (d.delay <= 0) this.release(d);
            continue;
          }
          d.vy += GRAVITY * dt;
          d.img.x += d.vx * dt;
          d.img.y += d.vy * dt;
          d.img.rotation += d.spin * dt;
          const half = (M[`rock${d.stone.kind}`].h / 2) * STONE_SCALE * 0.7;
          if (d.bounces < 2 && d.vy > 0 && d.img.y + half > groundAt(d.img.x)) {
            d.img.y = groundAt(d.img.x) - half;
            d.vy = -d.vy * 0.32;
            d.vx *= 0.75;
            d.spin *= 0.55;
            d.bounces += 1;
          }
          d.shadow.setPosition(d.img.x + SHADOW.x, d.img.y + SHADOW.y).setRotation(d.img.rotation);
        }
      }

      private moveCamera(dt: number) {
        const cam = this.cameras.main;
        // After a fall the view settles back onto the plank and the scattered stones.
        const topLocal = this.sim.fallen ? -140 : Math.min(this.stack.top, this.landing?.top ?? 0);
        const topWorld = TIP.y + topLocal - 260;
        const bottom = PIVOT_BASE + 150;
        const span = bottom - topWorld;
        // Never wider than the photos: a tall cairn's base drops out of view instead.
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, H / span));
        const lean = Math.sin(this.sim.angle) * -topLocal * 0.25;
        const fx = TIP.x + lean;
        const fy = H / zoom >= span ? (bottom + topWorld) / 2 : topWorld + H / zoom / 2;
        const k = this.snapCamera ? 1 : 1 - Math.exp(-dt / (this.sim.fallen ? 1.4 : 0.9));
        this.snapCamera = false;
        this.zoom += (zoom - this.zoom) * k;
        this.focusX += (fx - this.focusX) * k;
        this.focusY += (fy - this.focusY) * k;
        const halfW = W / this.zoom / 2;
        const halfH = H / this.zoom / 2;
        this.focusX = Math.max(BOUNDS.left + halfW, Math.min(BOUNDS.right - halfW, this.focusX));
        this.focusY = Math.max(BOUNDS.top + halfH, Math.min(BOUNDS.bottom - halfH, this.focusY));
        cam.setZoom(this.zoom * density);
        cam.centerOn(this.focusX, this.focusY);
      }

      update(time: number, delta: number) {
        const c = current.current;
        if (this.resetId !== c.reset) {
          this.resetId = c.reset;
          this.newRound(time);
        }
        const d = c.debugEvent;
        if (d && d.nonce !== this.debugNonce) {
          this.debugNonce = d.nonce;
          if (!this.sim.fallen) {
            const forcedPrev = this.sim;
            this.sim = startEvent({ ...this.sim, event: null }, d.kind, d.strength, Math.random() < 0.5 ? 1 : -1, d.path);
            tracer.current?.forcedEffect(this.sim.event!.index);
            tracer.current?.step(forcedPrev, this.sim, performance.timeOrigin + time);
          }
        }
        const frame = Math.min(delta / 1000, 0.1);
        const dt = frame * (c.timeScale ?? 1);
        const before = this.sim;
        const tr = tracer.current;
        if (tr) {
          tr.ctx = {
            source: c.source ?? "unknown",
            score: c.usable ? c.score : null,
            usable: !!c.usable,
            running: c.running,
            blocker: c.blocker ?? null,
            flickerRequested: !!c.flicker,
            flickerEffective: this.flick !== null,
          };
        }
        if (c.running && !before.fallen) {
          let left = dt;
          // Browser time each bounded step represents (the frame ends at `time`).
          const frameStart = performance.timeOrigin + time - frame * 1000;
          while (left > 1e-6 && !this.sim.fallen) {
            const h = Math.min(left, 0.05);
            const prev = this.sim;
            this.sim = stepCairn(this.sim, h, c.score);
            if (this.sim.stones > prev.stones) this.placeStone();
            left -= h;
            tr?.step(prev, this.sim, frameStart + ((dt - left) / dt) * frame * 1000);
          }
          if (this.sim.fallen) this.startCollapse();
        }
        if (tr && (c.running || (this.sim.fallen && this.collapse < SETTLE_SECONDS)) && tr.started && researchLog.stateDue("cairn")) {
          tr.ctx.flickerEffective = this.flick !== null;
          tr.snapshot(this.sim);
        }
        if (this.sim.fallen) this.stepCollapse(frame);
        this.drawTower();
        this.moveCamera(frame);
        this.drawBug(time, frame);
        this.drawGust(frame);
        this.drawHand(frame);
        this.reported += delta;
        if (
          this.reported >= 100 ||
          this.sim.stones !== before.stones ||
          this.sim.fallen !== before.fallen ||
          this.sim.phase !== before.phase ||
          this.sim.event?.index !== before.event?.index
        ) {
          this.reported = 0;
          report.current({
            ...this.sim,
            collapse: this.collapse,
            settled: this.sim.fallen && this.collapse >= SETTLE_SECONDS,
          });
        }
      }
    }

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current!,
      width: Math.round(W * density),
      height: Math.round(H * density),
      backgroundColor: "#e8dcc3",
      scene: CairnScene,
      scale: {
        expandParent: false,
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    });
    instance.current = game;
    const observer = new ResizeObserver(() => {
      if (host.current && host.current.clientWidth > 0) game.scale.refresh();
    });
    if (host.current) observer.observe(host.current);
    return () => {
      observer.disconnect();
      live?.endFlicker(performance.now(), "stage_unmounted");
      instance.current = null;
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    const loop = instance.current?.loop;
    if (!loop) return;
    if (active) loop.wake();
    else loop.sleep();
  }, [active]);

  return (
    <div
      className="cairn-canvas"
      ref={host}
      role="img"
      aria-label="Photo collage: a hand stacks stones on a plank balanced on a pointed rock. Steady signal keeps the stack still; distraction makes it sway and fall. Now and then a firefly crosses or a gust blows."
    />
  );
}
