// Per-browser Garden preferences and the facilitator's tuning log.
// Stored in localStorage purely as a convenience: every read/write is guarded,
// and the app works identically when storage is unavailable.
import { useCallback, useState } from "react";
import { BLOOM_SECONDS, PACE_MAX, PACE_MIN } from "./gardenSimulation";

export type GardenPrefs = {
  sound: boolean;
  volume: number; // 0..1
  guide: boolean; // breathing guide ring + labels
  settleIn: boolean; // 30-second arrival before each new plant
  pace: number; // full-signal seconds to bloom
  targetMinutes: number; // facilitator's desired typical bloom time
};

export const DEFAULT_PREFS: GardenPrefs = {
  sound: false,
  volume: 0.6,
  guide: true,
  settleIn: true,
  pace: BLOOM_SECONDS,
  targetMinutes: 5,
};

const PREFS_KEY = "glowing-garden:prefs:v1";
const LOG_KEY = "glowing-garden:log:v1";
export const LOG_LIMIT = 200;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(lo, Math.min(hi, v))
    : fallback;
const bool = (v: unknown, fallback: boolean) =>
  typeof v === "boolean" ? v : fallback;

export function sanitizePrefs(
  raw: Partial<Record<keyof GardenPrefs, unknown>> | null,
): GardenPrefs {
  const d = DEFAULT_PREFS;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    sound: bool(raw.sound, d.sound),
    volume: num(raw.volume, 0, 1, d.volume),
    guide: bool(raw.guide, d.guide),
    settleIn: bool(raw.settleIn, d.settleIn),
    pace: num(raw.pace, PACE_MIN, PACE_MAX, d.pace),
    targetMinutes: num(raw.targetMinutes, 1, 30, d.targetMinutes),
  };
}

export function usePrefs(): [
  GardenPrefs,
  (patch: Partial<GardenPrefs>) => void,
] {
  const [prefs, setPrefs] = useState(() => sanitizePrefs(read(PREFS_KEY)));
  const update = useCallback((patch: Partial<GardenPrefs>) => {
    setPrefs((p) => {
      const next = sanitizePrefs({ ...p, ...patch });
      write(PREFS_KEY, next);
      return next;
    });
  }, []);
  return [prefs, update];
}

export type PlantLog = {
  id: string;
  startedAt: string; // ISO time the plant started growing
  source: string; // live | replay | synthetic
  pace: number;
  active: number;
  above: number;
  scoreSum: number;
  driveSum: number;
  growth: number;
  reached: [number | null, number | null, number | null];
  note: string;
};

export function loadLog(): PlantLog[] {
  const raw = read<PlantLog[]>(LOG_KEY);
  return Array.isArray(raw)
    ? raw.filter((e) => e && typeof e.active === "number").slice(-LOG_LIMIT)
    : [];
}
export function saveLog(log: PlantLog[]) {
  write(LOG_KEY, log.slice(-LOG_LIMIT));
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function logToCsv(log: PlantLog[]) {
  const header = [
    "plant",
    "started_at",
    "source",
    "pace_s",
    "active_s",
    "above_baseline_pct",
    "mean_score",
    "mean_drive",
    "growth_pct",
    "growing_at_s",
    "blooming_at_s",
    "full_bloom_at_s",
    "note",
  ];
  const rows = log.map((e, i) => [
    i + 1,
    e.startedAt,
    e.source,
    e.pace,
    e.active.toFixed(1),
    e.active ? ((100 * e.above) / e.active).toFixed(1) : "",
    e.active ? (e.scoreSum / e.active).toFixed(3) : "",
    e.active ? (e.driveSum / e.active).toFixed(3) : "",
    (100 * e.growth).toFixed(1),
    ...e.reached.map((t) => (t === null ? "" : t.toFixed(1))),
    e.note,
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
