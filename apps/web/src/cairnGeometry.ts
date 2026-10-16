// Pure stacking geometry for Cairn, in plank-local world units: origin at the
// point where the plank rests on the pivot tip, x along the plank, y down.
// Stones settle Tetris-style onto the tower's measured top contour, so each
// photo cut-out rests on the real edge of the one below it.
import { stoneOffset, stoneRandom } from "./cairnSimulation";

export type SpriteInfo = {
  w: number;
  h: number;
  /** Object bounds inside the sprite (the paper margin lies outside). */
  object: [number, number, number, number];
  /** Per column band: first/last opaque object row, or null where empty. */
  top: (number | null)[];
  bottom: (number | null)[];
};

export type CairnManifest = {
  wood: SpriteInfo;
  pivot: { tip: [number, number]; base: number; left: number; right: number };
  /** World size of the photo; the image ships finer and is drawn at `scale`. */
  background: { w: number; h: number; scale?: number };
  hand: { w: number; h: number; tips: Record<string, [number, number][]> };
} & Record<`rock${number}`, SpriteInfo>;

/** Stone photos in the shipped manifest; the asset tool can add more. */
export const STONE_KINDS = 9;
export const STONE_SCALE = 0.8;
/** Paper margins overlap slightly, as layered cut-outs do. */
export const SINK = 3;
/** Horizontal jitter of each landing spot, world units. */
export const JITTER = 16;
const RESOLUTION = 4; // heightmap cell, world units
const HALF_SPAN = 900; // heightmap reaches this far either side of the pivot

export type PlacedStone = {
  index: number;
  kind: number; // 1..9
  flip: boolean;
  /** Sprite centre in plank-local coordinates. */
  x: number;
  y: number;
  /** Top of this stone's object outline, for camera framing. */
  top: number;
};

/** Which stone photo comes next (1..kinds): varied, never the same twice in a row. */
export function stoneKind(seed: number, index: number, kinds = STONE_KINDS) {
  let k = Math.floor(stoneRandom(seed, 0, 2) * kinds);
  for (let i = 1; i <= index; i++)
    k = (k + 1 + Math.floor(stoneRandom(seed, i, 2) * (kinds - 1))) % kinds;
  return k + 1;
}

/** Where the plank sprite's pivot contact sits inside the sprite. */
export function plankOrigin(wood: SpriteInfo) {
  const [x0, , x1] = wood.object;
  const cx = (x0 + x1) / 2;
  const n = wood.bottom.length;
  const col = Math.min(n - 1, Math.floor((cx / wood.w) * n));
  return { x: cx, y: wood.bottom[col] ?? wood.object[3] };
}

/** Column bands of a sprite as plank-local spans relative to the sprite centre. */
function bands(info: SpriteInfo, scale: number, flip: boolean) {
  const n = info.top.length;
  const out: { x0: number; x1: number; top: number; bottom: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = flip ? n - 1 - i : i;
    const t = info.top[j];
    const b = info.bottom[j];
    if (t === null || b === null) continue;
    out.push({
      x0: ((i / n) * info.w - info.w / 2) * scale,
      x1: (((i + 1) / n) * info.w - info.w / 2) * scale,
      top: (t - info.h / 2) * scale,
      bottom: (b + 1 - info.h / 2) * scale,
    });
  }
  return out;
}

export class Stack {
  /** Surface height (y, negative is up) for each heightmap cell. */
  private surface: Float64Array;
  private kinds: number;
  readonly stones: PlacedStone[] = [];

  constructor(
    private manifest: CairnManifest,
    private seed: number,
    /** Drawn size of the plank sprite. */
    plankScale = 1,
  ) {
    this.surface = new Float64Array(Math.ceil((2 * HALF_SPAN) / RESOLUTION)).fill(Infinity);
    this.kinds = Object.keys(manifest).filter((k) => /^rock\d+$/.test(k)).length;
    const wood = manifest.wood;
    const o = plankOrigin(wood);
    const dx = (wood.w / 2 - o.x) * plankScale;
    const dy = (wood.h / 2 - o.y) * plankScale;
    // The plank sprite is centred on its contact point horizontally.
    for (const b of bands(wood, plankScale, false)) this.raise(b.x0 + dx, b.x1 + dx, b.top + dy);
  }

  private cells(x0: number, x1: number) {
    const a = Math.max(0, Math.floor((x0 + HALF_SPAN) / RESOLUTION));
    const b = Math.min(this.surface.length - 1, Math.ceil((x1 + HALF_SPAN) / RESOLUTION) - 1);
    return [a, b] as const;
  }

  private raise(x0: number, x1: number, y: number) {
    const [a, b] = this.cells(x0, x1);
    for (let i = a; i <= b; i++) this.surface[i] = Math.min(this.surface[i], y);
  }

  /** Highest surface point under a span; Infinity where nothing is below. */
  private highest(x0: number, x1: number) {
    const [a, b] = this.cells(x0, x1);
    let y = Infinity;
    for (let i = a; i <= b; i++) y = Math.min(y, this.surface[i]);
    return y;
  }

  /** Top of the tower (smallest y) across its width. */
  get top() {
    let y = 0;
    for (const v of this.surface) if (v < y) y = v;
    return y;
  }

  /** Where stone `index` will come to rest, without placing it. */
  landing(index: number): PlacedStone {
    const kind = stoneKind(this.seed, index, this.kinds);
    const flip = stoneRandom(this.seed, index, 3) < 0.5;
    const info = this.manifest[`rock${kind}`];
    const prev = this.stones[this.stones.length - 1];
    // Aim over the stone below, pulled back toward the pivot, with a little jitter.
    const x = (prev ? prev.x * 0.5 : 0) + JITTER * stoneOffset(this.seed, index);
    let y = Infinity;
    let top = Infinity;
    for (const b of bands(info, STONE_SCALE, flip)) {
      const ground = this.highest(x + b.x0, x + b.x1);
      if (Number.isFinite(ground)) y = Math.min(y, ground - b.bottom);
    }
    if (!Number.isFinite(y)) y = this.top - (info.h / 2) * STONE_SCALE;
    y += SINK;
    for (const b of bands(info, STONE_SCALE, flip)) top = Math.min(top, y + b.top);
    return { index, kind, flip, x, y, top };
  }

  place(index: number): PlacedStone {
    const stone = this.landing(index);
    const info = this.manifest[`rock${stone.kind}`];
    for (const b of bands(info, STONE_SCALE, stone.flip))
      this.raise(stone.x + b.x0, stone.x + b.x1, stone.y + b.top);
    this.stones.push(stone);
    return stone;
  }
}
