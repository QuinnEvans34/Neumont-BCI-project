// Owner-side experiment session: start, 500 ms heartbeat, batched events and
// frames, clock sync and idempotent stop. One instance per experiment page.
import { useCallback, useEffect, useRef, useState } from "react";
import { browserNow, estimateClock, type ClockSample } from "./timing";

export const API = "http://127.0.0.1:8000";
export const HEARTBEAT_MS = 500;
const EVENT_FLUSH_MS = 250;
const CLOCK_RESYNC_MS = 30_000;

export type Owned = { id: string; token: string };
export type SessionEvent = { type: string } & Record<string, unknown>;

async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d: { msg?: string }) => d.msg).join("; ")
      : data.detail;
    throw Object.assign(new Error(detail ?? `Request failed (${r.status})`), {
      status: r.status,
    });
  }
  return data;
}

/** Ten quick ping/pongs; keeps the lowest-RTT estimate. */
export async function syncClock(rounds = 10) {
  const samples: ClockSample[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = browserNow();
    const r = await fetch(`${API}/api/experiments/clock`, {
      cache: "no-store",
    });
    const t1 = browserNow();
    const { server_wall_ms } = await r.json();
    samples.push({ t0, t1, server: server_wall_ms });
  }
  return estimateClock(samples);
}

export function useExperimentSession(onLost: (reason: string) => void) {
  const [owned, setOwned] = useState<Owned | null>(null);
  const ownedRef = useRef<Owned | null>(null);
  const queue = useRef<Record<string, unknown>[]>([]);
  const nextId = useRef(1);
  const lost = useRef(onLost);
  lost.current = onLost;
  const sending = useRef<Promise<unknown>>(Promise.resolve());
  const deliveryError = useRef<string | null>(null);
  const stopping = useRef<ReturnType<typeof post> | null>(null);

  const flush = useCallback(() => {
    const o = ownedRef.current;
    if (!o || !queue.current.length) return sending.current;
    const pending = queue.current.splice(0);
    // Serialize batches so event ids always arrive in order.
    sending.current = sending.current
      .then(async () => {
        for (let i = 0; i < pending.length; i += 200)
          await post(`/api/experiments/${o.id}/events`, {
            token: o.token,
            events: pending.slice(i, i + 200),
          });
      })
      .catch((e) => {
        deliveryError.current = `Event delivery failed: ${e.message}`;
        if (ownedRef.current === o)
          lost.current(deliveryError.current);
      });
    return sending.current;
  }, []);

  /** Queue an event stamped with the browser time it happened (or `at`). */
  const log = useCallback(
    (event: SessionEvent, opts: { at?: number; urgent?: boolean } = {}) => {
      if (!ownedRef.current) return;
      queue.current.push({
        id: nextId.current++,
        t_browser_ms: opts.at ?? browserNow(),
        ...event,
      });
      if (opts.urgent) void flush();
    },
    [flush],
  );

  const sendFrames = useCallback(
    (trialId: string, profileHz: number, frames: number[][]) => {
      const o = ownedRef.current;
      if (!o) return Promise.resolve();
      sending.current = sending.current.then(() =>
        post(`/api/experiments/${o.id}/frames`, {
          token: o.token,
          trial_id: trialId,
          profile_hz: profileHz,
          frames,
        }),
      ).catch((e) => {
        deliveryError.current = `Frame log failed: ${e.message}`;
        if (ownedRef.current === o) lost.current(deliveryError.current);
      });
      return sending.current;
    },
    [],
  );

  const start = useCallback(async (config: Record<string, unknown>) => {
    const clock = await syncClock();
    if (!clock) throw new Error("Could not reach the backend clock");
    const r = await post("/api/experiments/start", { ...config, clock });
    const o = { id: r.id as string, token: r.token as string };
    ownedRef.current = o;
    nextId.current = 1;
    queue.current = [];
    deliveryError.current = null;
    stopping.current = null;
    setOwned(o);
    return { owned: o, clock, experiment: r.experiment };
  }, []);

  const stop = useCallback(
    async (reason: string, completed = false) => {
      if (stopping.current) return stopping.current;
      const o = ownedRef.current;
      if (!o) return null;
      stopping.current = (async () => {
        await flush();
        ownedRef.current = null;
        setOwned(null);
        try {
          return await post(`/api/experiments/${o.id}/stop`, {
            token: o.token,
            reason: deliveryError.current ?? reason,
            completed: completed && !deliveryError.current,
          });
        } catch {
          return null; // already ended server-side (idempotent from the user's view)
        }
      })();
      return stopping.current;
    },
    [flush],
  );

  const freezeThresholds = useCallback(async () => {
    const o = ownedRef.current;
    if (!o) throw new Error("No active session");
    await flush();
    return post(`/api/experiments/${o.id}/thresholds`, { token: o.token });
  }, [flush]);

  // Heartbeat, periodic event flush and clock re-sync while owned.
  useEffect(() => {
    if (!owned) return;
    let alive = true;
    const beat = setInterval(() => {
      post(`/api/experiments/${owned.id}/heartbeat`, {
        token: owned.token,
      }).catch((e) => {
        if (alive && ownedRef.current === owned) {
          ownedRef.current = null;
          setOwned(null);
          lost.current(
            e.status === 404
              ? "The session ended on the server"
              : `Heartbeat failed: ${e.message}`,
          );
        }
      });
    }, HEARTBEAT_MS);
    const flusher = setInterval(() => void flush(), EVENT_FLUSH_MS);
    const resync = setInterval(async () => {
      const c = await syncClock(5).catch(() => null);
      if (c && alive) log({ type: "clock", ...c });
    }, CLOCK_RESYNC_MS);
    return () => {
      alive = false;
      clearInterval(beat);
      clearInterval(flusher);
      clearInterval(resync);
    };
  }, [owned, flush, log]);

  // Leaving the page (unmount) always stops an owned session.
  useEffect(
    () => () => {
      if (stopping.current) return; // an explicit stop is already draining and closing
      const o = ownedRef.current;
      if (o) {
        const drained = flush();
        ownedRef.current = null;
        void drained.then(() => post(`/api/experiments/${o.id}/stop`, {
          token: o.token,
          reason: "Left the experiment page",
        })).catch(() => {});
      }
    },
    [flush],
  );

  return { owned, start, stop, log, flush, sendFrames, freezeThresholds };
}

export async function setSimulatedGaze(
  gaze_hz: number | null,
  gaze_side: "left" | "right" | null = null,
) {
  return post("/api/simulation", { gaze_hz, gaze_side }).catch(() => null);
}

export const exportUrl = (id: string) => `${API}/api/experiments/${id}/export`;
