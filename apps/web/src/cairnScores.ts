// Per-browser Cairn scores, mode and flicker choice, and the log of flicker
// stimuli. Stored in localStorage purely as a convenience: every read/write is
// guarded, and play works without storage.
import { useCallback, useState } from "react";
import type { CairnEvent, CairnMode, FallCause } from "./cairnSimulation";

export type CairnEnding = FallCause | "ended";
export type CairnRound = {
  at: string; // ISO start time
  mode: CairnMode;
  source: string; // live | replay | synthetic
  stones: number;
  seconds: number; // active play time
  steady: number; // fraction of active time the tower was steady
  ending: CairnEnding;
};
/** One stretch of a bug's lantern blinking on screen, for lining up with EEG. */
export type CairnStimulus = {
  /** Unix epoch milliseconds of the first and after the last blinking frame. */
  start: number;
  end: number;
  hz: number;
  /** Bug size and brightness, 0..1. */
  strength: number;
  path: CairnEvent["path"];
  mode: CairnMode;
  source: string;
};
export type CairnRecord = {
  mode: CairnMode;
  /** Opt-in: bugs' lanterns blink for SSVEP. Off by default. */
  flicker: boolean;
  /** Best stone count per `${source}:${mode}`, so recordings never set a headset record. */
  best: Record<string, number>;
  rounds: CairnRound[];
  stimuli: CairnStimulus[];
};

const KEY = "cairn:record:v1";
export const ROUND_LIMIT = 100;
export const STIMULUS_LIMIT = 1000;
export const MODES: CairnMode[] = ["calm", "go"];
const ENDINGS: CairnEnding[] = ["sway", "drop", "ended"];

export const emptyRecord = (): CairnRecord => ({
  mode: "calm",
  flicker: false,
  best: {},
  rounds: [],
  stimuli: [],
});
export const bestKey = (source: string, mode: CairnMode) => `${source}:${mode}`;

const count = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
const seconds = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

function sanitizeRound(raw: unknown): CairnRound | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const stones = count(r.stones);
  const secs = seconds(r.seconds);
  const steady = seconds(r.steady);
  if (
    typeof r.at !== "string" ||
    !MODES.includes(r.mode as CairnMode) ||
    typeof r.source !== "string" ||
    !ENDINGS.includes(r.ending as CairnEnding) ||
    stones === null ||
    secs === null ||
    steady === null
  )
    return null;
  return {
    at: r.at,
    mode: r.mode as CairnMode,
    source: r.source,
    stones,
    seconds: secs,
    steady: Math.min(1, steady),
    ending: r.ending as CairnEnding,
  };
}

export function sanitizeRecord(raw: unknown): CairnRecord {
  const d = emptyRecord();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const best: Record<string, number> = {};
  if (r.best && typeof r.best === "object")
    for (const [k, v] of Object.entries(r.best)) {
      const n = count(v);
      if (n !== null) best[k] = n;
    }
  const rounds = Array.isArray(r.rounds)
    ? r.rounds.map(sanitizeRound).filter((x): x is CairnRound => x !== null).slice(-ROUND_LIMIT)
    : [];
  const stimuli = Array.isArray(r.stimuli)
    ? r.stimuli.map(sanitizeStimulus).filter((x): x is CairnStimulus => x !== null).slice(-STIMULUS_LIMIT)
    : [];
  return {
    mode: MODES.includes(r.mode as CairnMode) ? (r.mode as CairnMode) : d.mode,
    flicker: r.flicker === true,
    best,
    rounds,
    stimuli,
  };
}

function sanitizeStimulus(raw: unknown): CairnStimulus | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const start = seconds(s.start);
  const end = seconds(s.end);
  const hz = seconds(s.hz);
  const strength = seconds(s.strength);
  if (
    start === null ||
    end === null ||
    end < start ||
    hz === null ||
    strength === null ||
    (s.path !== "ground" && s.path !== "air") ||
    !MODES.includes(s.mode as CairnMode) ||
    typeof s.source !== "string"
  )
    return null;
  return {
    start,
    end,
    hz,
    strength: Math.min(1, strength),
    path: s.path,
    mode: s.mode as CairnMode,
    source: s.source,
  };
}

export function addStimulus(record: CairnRecord, s: CairnStimulus): CairnRecord {
  return { ...record, stimuli: [...record.stimuli, s].slice(-STIMULUS_LIMIT) };
}

/** The flicker log as CSV, one row per blinking stretch, in Unix seconds like BrainFlow timestamps. */
export function stimulusCsv(stimuli: CairnStimulus[]) {
  const rows = stimuli.map((s) =>
    [
      (s.start / 1000).toFixed(3),
      (s.end / 1000).toFixed(3),
      ((s.end - s.start) / 1000).toFixed(3),
      s.hz,
      s.strength,
      s.path,
      s.mode,
      s.source,
      new Date(s.start).toISOString(),
    ].join(","),
  );
  return ["onset_unix_s,offset_unix_s,duration_s,hz,strength,path,mode,source,onset_iso", ...rows].join("\n") + "\n";
}

/** Add a finished round; the best only ever rises. Rounds with no stones are not logged. */
export function addRound(record: CairnRecord, round: CairnRound): CairnRecord {
  if (round.stones <= 0) return record;
  const key = bestKey(round.source, round.mode);
  return {
    ...record,
    best: { ...record.best, [key]: Math.max(record.best[key] ?? 0, round.stones) },
    rounds: [...record.rounds, round].slice(-ROUND_LIMIT),
  };
}

function load(): CairnRecord {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeRecord(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyRecord();
  }
}

function save(record: CairnRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable: keep the in-memory record */
  }
}

export function useCairnRecord() {
  const [record, setRecord] = useState(load);
  const update = useCallback((change: (r: CairnRecord) => CairnRecord) => {
    setRecord((r) => {
      const next = change(r);
      save(next);
      return next;
    });
  }, []);
  return [record, update] as const;
}
