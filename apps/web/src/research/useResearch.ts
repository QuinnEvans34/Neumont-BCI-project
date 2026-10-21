// Owner side of a research recording: start, heartbeat, ordered item delivery,
// periodic clock sync and stop. Only the tab that started a recording owns it;
// every other tab sees it read-only through telemetry.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { estimateClock } from "../experiments/timing";
import { API, browserNow, research, uuid, type Owned } from "./logger";

export const HEARTBEAT_MS = 1000;
export const FLUSH_MS = 250;
export const CLOCK_SYNC_MS = 30000;

export type ResearchConfig = {
  storage_format: "csv" | "sqlite" | "both";
  destination_id: string;
  condition: string;
  electrodes: string[];
  reference: string;
  notes: string;
};

export const DEFAULT_CONFIG: ResearchConfig = {
  storage_format: "csv",
  destination_id: "default",
  condition: "",
  electrodes: ["", "", "", "", "", "", "", ""],
  reference: "",
  notes: "",
};

/** Server-side recording status (from telemetry.research). */
export type ResearchStatus = {
  id: string;
  participant_id: string;
  condition: string | null;
  storage_format: string;
  destination_id: string;
  state: "recording" | "finalizing" | "saved" | "incomplete" | "failed" | "recovered_incomplete";
  reason: string | null;
  started_at: string;
  duration_s: number;
  counts: Record<string, number>;
  rows_written: number;
  backlog: number;
  rows_flushed: number;
  samples_written: number;
  samples_flushed: number;
  browser_ack: number;
  receiving_eeg: boolean;
  acquisition_id: string | null;
  writer_error: string | null;
  losses: number;
  heartbeat_age_s: number | null;
  saved: boolean;
  games: string[];
  electrodes: string[];
};

export type Destination = {
  id: string;
  name: string;
  available: boolean;
  is_default?: boolean;
  problem?: string | null;
  free_bytes?: number | null;
  path?: string;
};

const CONFIG_KEY = "bci-research:config:v1";
const MODE_KEY = "bci-research:mode:v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is a convenience only */
  }
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = (data as { detail?: unknown }).detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join("; ") : `HTTP ${r.status}`);
  }
  return data as T;
}

export async function researchClock(rounds = 8) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = browserNow();
    const { server_wall_ms } = await api<{ server_wall_ms: number }>("/api/research/clock");
    const t1 = browserNow();
    samples.push({ t0, t1, server: server_wall_ms });
  }
  return estimateClock(samples);
}

export function useResearchMode() {
  const [mode, setMode] = useState(() => load(MODE_KEY, { on: false }).on);
  return [
    mode,
    (on: boolean) => {
      setMode(on);
      save(MODE_KEY, { on });
    },
  ] as const;
}

export function useLoggerStatus() {
  return useSyncExternalStore(
    (fn) => research.subscribe(fn),
    () => statusKey(),
    () => statusKey(),
  );
}
let cachedKey = "";
let cached = research.status();
function statusKey() {
  const s = research.status();
  const k = JSON.stringify(s);
  if (k !== cachedKey) {
    cachedKey = k;
    cached = s;
  }
  return cached;
}

export function useResearch() {
  const [config, setConfigState] = useState<ResearchConfig>(() => load(CONFIG_KEY, DEFAULT_CONFIG));
  const [owned, setOwned] = useState<(Owned & { participant: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  const ownedRef = useRef(owned);
  ownedRef.current = owned;

  const setConfig = useCallback((patch: Partial<ResearchConfig>) => {
    setConfigState((c) => {
      const n = { ...c, ...patch };
      save(CONFIG_KEY, n);
      return n;
    });
  }, []);

  useEffect(() => {
    research.onFatal = (reason) => {
      setLost(reason);
      const o = ownedRef.current;
      if (o) setLastSaved(o.id);
      research.end();
      setOwned(null);
    };
  }, []);

  // Owner timers: heartbeat, ordered delivery and periodic clock sync. The tick
  // comes from a tiny Web Worker because browsers throttle main-thread timers in
  // hidden tabs (to once a minute after a while), which would look like owner loss.
  useEffect(() => {
    if (!owned) return;
    let stopped = false;
    let last = { beat: 0, sync: performance.now() };
    const tick = () => {
      const now = performance.now();
      void research.flush();
      if (now - last.beat >= HEARTBEAT_MS - 50) {
        last = { ...last, beat: now };
        api(`/api/research/recordings/${owned.id}/heartbeat`, { token: owned.token }).catch((e) => {
          if (/not active|own the recording|unknown recording/i.test(String(e))) research.onFatal(String(e.message ?? e));
        });
      }
      if (now - last.sync >= CLOCK_SYNC_MS) {
        last = { ...last, sync: now };
        researchClock(5)
          .then((c) => {
            if (c && !stopped) research.clock(c);
          })
          .catch(() => {
            /* the next attempt retries; alignment uses the last estimate */
          });
      }
    };
    const onVisibility = () =>
      research.event("owner_visibility", { reason: document.visibilityState, payload: { visible: document.visibilityState === "visible" } });
    document.addEventListener("visibilitychange", onVisibility);
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      const url = URL.createObjectURL(
        new Blob([`setInterval(() => postMessage(0), ${FLUSH_MS});`], { type: "text/javascript" }),
      );
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = tick;
    } catch {
      timer = setInterval(tick, FLUSH_MS);
    }
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      worker?.terminate();
      if (timer) clearInterval(timer);
    };
  }, [owned]);

  const start = useCallback(
    async (participant: string) => {
      setBusy(true);
      setError("");
      setLost(null);
      try {
        const clock = await researchClock();
        if (!clock) throw new Error("Could not reach the backend clock");
        const r = await api<{ id: string; token: string }>("/api/research/recordings", {
          participant_id: participant,
          ...config,
          idempotency_key: uuid(),
        });
        const o = { id: r.id, token: r.token, participant };
        research.begin({ id: o.id, token: o.token });
        research.clock(clock);
        setOwned(o);
        void research.flush();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [config],
  );

  const marker = useCallback((label: string) => {
    return research.event("marker", { reason: label || "operator marker", payload: { label } });
  }, []);

  const stop = useCallback(async () => {
    const o = ownedRef.current;
    if (!o) return;
    setBusy(true);
    setError("");
    try {
      research.event("stop_requested", { reason: "Stopped by operator" });
      // Deliver what is queued (bounded: Stop must not hang on a dead backend).
      for (let i = 0; i < 20 && research.status().queued > 0; i++) {
        await research.flush();
        if (research.status().queued > 0) await new Promise((r) => setTimeout(r, 100));
      }
      const unsent = research.status().queued;
      await api(`/api/research/recordings/${o.id}/stop`, {
        token: o.token,
        unsent_items: unsent,
        reason: unsent ? `Stopped by operator; ${unsent} browser items were not delivered` : "Stopped by operator",
      });
      research.end();
      setOwned(null);
      setLastSaved(o.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { config, setConfig, owned, start, stop, marker, error, setError, busy, lastSaved, setLastSaved, lost };
}
