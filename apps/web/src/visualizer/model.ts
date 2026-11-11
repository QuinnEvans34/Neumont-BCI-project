import { useEffect, useRef } from "react";
import type { Telemetry } from "../SignalPanel";
import type { InputFrame } from "../input";

export type Row = Record<string, unknown>;
export type Point = [number, number | null];
export type Run = {
  id: string; kind: "raw" | "research" | "experiment"; label: string;
  sources: string[]; games: string[]; state: string; participant_id?: string;
  condition?: string; started_at?: string; duration_s?: number; samples?: number;
  problem?: string; export_url?: string;
};
export type Channel = {
  channel: number; label: string; windows: number; included_pct: number | null;
  std_uv: number | null; ptp_uv: number | null; relative_alpha: number | null;
  reasons: Record<string, number>;
};
export type Event = { t: number; type: string; game?: string; reason?: string };
export type Analysis = {
  run: Run; start: number; end: number;
  summary: {
    duration_s: number; samples: number; windows: number | null;
    accepted_pct: number | null; mean_alpha: number | null; mean_score: number | null;
    score_above_pct: number | null; rounds: number | null; events: number; losses: number;
    timestamp_gaps?: number; backwards_timestamps?: number;
  };
  channels: Channel[]; series: Record<string, Point[]>;
  distribution: number[]; distribution_metric: string;
  events: Event[]; event_counts: Record<string, number>; rounds: Row[]; calibrations: Row[];
  tables: { name: string; count: number | null }[]; notes: string[]; metadata?: Row;
  eeg: { t: number; ch: (number | null)[] }[]; eeg_stride: number; eeg_samples_in_range: number;
  spectrum: { points: Point[]; channel_windows: number; method: string };
  selection: { events: Event[]; eeg_time_basis: string };
};

export const COLORS = ["#8ff1d0", "#b9a2ff", "#f2c96e", "#79bcff"];
export const keyOf = (r: Run) => `${r.kind}:${r.id}`;
export const value = (v: unknown, digits = 2): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";
export const percent = (v: number | null | undefined) => v == null ? "—" : `${value(v, 1)}%`;
export function elapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export const pretty = (s: string) => s.replaceAll("_", " ");

export type LivePoint = {
  t: number; score: number | null; alpha: number | null; target: number | null;
  included: number; usable: boolean; rate: number | null;
};
export type LiveData = { session: string | null; started: number; points: LivePoint[] };

/** Keep a bounded five-minute view while navigating games; never write EEG here. */
export function useLiveData(frame: InputFrame | null, telemetry: Telemetry | null, usable: boolean) {
  const buffer = useRef<LiveData>({ session: null, started: 0, points: [] });
  const last = useRef(-1);
  useEffect(() => {
    if (!telemetry && buffer.current.points.length) {
      const previous = buffer.current.points[buffer.current.points.length - 1];
      if (previous.usable) buffer.current.points.push({ t: Date.now() / 1000 - buffer.current.started, score: null,
        alpha: null, target: null, included: 0, usable: false, rate: null });
    }
    if (!frame || !telemetry?.session_id || frame.sequence === last.current && buffer.current.session === telemetry.session_id) return;
    const wall = frame.timestamp_ms / 1000;
    if (buffer.current.session !== telemetry.session_id) {
      buffer.current = { session: telemetry.session_id, started: wall, points: [] };
    }
    last.current = frame.sequence;
    const t = wall - buffer.current.started;
    const previous = buffer.current.points[buffer.current.points.length - 1];
    if (previous && t - previous.t > 2) buffer.current.points.push({ t: previous.t + .001, score: null,
      alpha: null, target: null, included: 0, usable: false, rate: null });
    buffer.current.points.push({
      t, score: usable ? frame.score : null, alpha: telemetry.relative_alpha,
      target: telemetry.signal_chain?.mapped_target ?? null,
      included: telemetry.channels.filter((c) => c.included).length, usable,
      rate: telemetry.measured_rate_hz,
    });
    buffer.current.points = buffer.current.points.filter((p) => p.t >= t - 300).slice(-1500);
  }, [frame, telemetry, usable]);
  return buffer;
}

export function histogram(points: (number | null)[]) {
  const counts = Array<number>(10).fill(0);
  for (const p of points) if (p !== null && Number.isFinite(p)) counts[Math.min(9, Math.max(0, Math.floor(p * 10)))]++;
  return counts;
}

export function chartPoints(points: Point[], duration: number, normalized: boolean): Point[] {
  return points.map(([t, v]) => [normalized ? 100 * t / Math.max(.001, duration) : t, v]);
}
