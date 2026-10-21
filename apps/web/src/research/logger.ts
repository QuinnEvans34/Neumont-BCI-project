// Research / Dev Mode browser logger: one module-level instance shared by the
// app shell and both games. It is a no-op unless this tab owns an active
// recording. Items (events, state snapshots, clock estimates) get a strictly
// increasing sequence number, are kept until the server acknowledges them, and
// are re-sent on failure; the server ignores sequences it already persisted, so
// retries and React StrictMode double effects can never double-count.

export const API = "http://127.0.0.1:8000";
export const STATE_INTERVAL_MS = 50; // ~20 Hz snapshots while a game runs
export const MAX_QUEUE = 20000;
const BATCH = 400;

export type InputRef = { acquisition_id: string | null; sequence: number | null };
export type Owned = { id: string; token: string };
type Item = Record<string, unknown> & { seq: number; kind: "event" | "state" | "clock" };

export const browserNow = () => performance.timeOrigin + performance.now();

export function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}

export type LoggerStatus = {
  owned: boolean;
  queued: number;
  sent: number;
  acked: number;
  failures: number;
  lastError: string | null;
  failed: boolean;
};

class ResearchLog {
  owned: Owned | null = null;
  /** The input frame the games are currently using (set by the app on every frame). */
  input: InputRef = { acquisition_id: null, sequence: null };
  private seq = 0;
  private acked = 0;
  private queue: Item[] = [];
  private sending = false;
  private failures = 0;
  private lastError: string | null = null;
  private failed = false;
  private lastState = new Map<string, number>();
  private listeners = new Set<() => void>();
  private beginListeners = new Set<() => void>();
  onFatal: (reason: string) => void = () => {};
  /** Recent events from this tab, newest last, for the live timeline. */
  recent: { type: string; t: number; game: string | null; reason: string | null }[] = [];

  get active() {
    return this.owned !== null && !this.failed;
  }

  begin(owned: Owned) {
    this.owned = owned;
    this.seq = 0;
    this.acked = 0;
    this.queue = [];
    this.failures = 0;
    this.lastError = null;
    this.failed = false;
    this.lastState.clear();
    this.recent = [];
    this.notify();
    // Games describe anything already in progress (partial_start) and their settings.
    this.beginListeners.forEach((f) => {
      try {
        f();
      } catch {
        /* a game's snapshot must never block the recording */
      }
    });
  }

  /** Called whenever this tab starts owning a recording. */
  onBegin(fn: () => void) {
    this.beginListeners.add(fn);
    return () => void this.beginListeners.delete(fn);
  }

  end() {
    this.owned = null;
    this.queue = [];
    this.notify();
  }

  status(): LoggerStatus {
    return {
      owned: this.owned !== null,
      queued: this.queue.length,
      sent: this.seq,
      acked: this.acked,
      failures: this.failures,
      lastError: this.lastError,
      failed: this.failed,
    };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((f) => f());
  }

  private push(item: Omit<Item, "seq">) {
    if (!this.active) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.failed = true;
      this.lastError = "Browser event queue overflowed; the backend did not acknowledge in time";
      this.onFatal(this.lastError);
      this.notify();
      return;
    }
    this.queue.push({ ...item, seq: ++this.seq } as Item);
  }

  /** A discrete event at the authoritative time `t` (defaults to now). Returns its id. */
  event(
    type: string,
    f: {
      game?: string;
      round_id?: string | null;
      active_s?: number | null;
      input?: InputRef;
      reason?: string | null;
      payload?: Record<string, unknown>;
      t?: number;
      event_id?: string;
    } = {},
  ) {
    if (!this.active) return null;
    const id = f.event_id ?? uuid();
    this.recent.push({ type, t: f.t ?? browserNow(), game: f.game ?? null, reason: f.reason ?? null });
    if (this.recent.length > 60) this.recent.splice(0, this.recent.length - 60);
    this.push({
      kind: "event",
      event_id: id,
      type,
      game: f.game ?? null,
      round_id: f.round_id ?? null,
      t_browser_ms: f.t ?? browserNow(),
      active_s: f.active_s ?? null,
      input: f.input ?? this.input,
      reason: f.reason ?? null,
      payload: f.payload ?? {},
    });
    return id;
  }

  /** True if a ~20 Hz snapshot is due for this game (always true for transitions). */
  stateDue(game: string, now = performance.now()) {
    if (!this.active) return false;
    const last = this.lastState.get(game) ?? -Infinity;
    if (now - last < STATE_INTERVAL_MS) return false;
    this.lastState.set(game, now);
    return true;
  }

  state(row: Record<string, unknown>, stateKind: "snapshot" | "transition" | "start" | "stop" = "snapshot") {
    if (!this.active) return;
    this.push({
      kind: "state",
      state_kind: stateKind,
      t_browser_ms: browserNow(),
      acquisition_id: this.input.acquisition_id,
      input_sequence: this.input.sequence,
      ...row,
    });
  }

  clock(c: { offset_ms: number; rtt_ms: number; samples: number; spread_ms: number }) {
    this.push({ kind: "clock", t_browser_ms: browserNow(), method: "min-RTT of ping/pong", ...c });
  }

  /** Send queued items in order; keep them until acknowledged. */
  async flush() {
    const o = this.owned;
    if (!o || this.sending || !this.queue.length) return;
    this.sending = true;
    const batch = this.queue.slice(0, BATCH);
    try {
      const r = await fetch(`${API}/api/research/recordings/${o.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: o.token, items: batch }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 404 || r.status === 403) {
          this.failed = true;
          this.onFatal(data.detail ?? "The recording ended on the server");
        }
        throw new Error(data.detail ?? `HTTP ${r.status}`);
      }
      if (this.owned !== o) return;
      this.acked = data.ack;
      this.queue = this.queue.filter((i) => i.seq > data.ack);
      this.failures = 0;
      this.lastError = null;
    } catch (e) {
      this.failures += 1;
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.sending = false;
      this.notify();
    }
  }
}

export const research = new ResearchLog();
