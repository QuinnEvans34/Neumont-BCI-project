// Pure helpers for shared game-session orchestration so lifecycle rules are testable.

export type ReferenceWatch = {
  /** Last observed non-null acquisition session ID. */
  session: string | null;
  /** Last observed calibrating flag for that session. */
  calibrating: boolean;
};

export const initialWatch = (): ReferenceWatch => ({
  session: null,
  calibrating: false,
});

/**
 * Observe fresh telemetry. Returns the next watch and whether games bound to the
 * previous comparison reference must be invalidated. Missing telemetry (an
 * outage) never counts as a change; only an observed different non-null session
 * or a transition into calibration (local or another viewer) does.
 */
export function observeReference(
  prev: ReferenceWatch,
  telemetry: { session_id: string | null; calibrating: boolean } | null,
): { watch: ReferenceWatch; invalidate: boolean } {
  if (!telemetry || !telemetry.session_id)
    return { watch: prev, invalidate: false };
  const session = telemetry.session_id;
  const calibrating = Boolean(telemetry.calibrating);
  const newSession = prev.session !== null && prev.session !== session;
  const recalibrating =
    !newSession && prev.session === session && calibrating && !prev.calibrating;
  return {
    watch: { session, calibrating },
    invalidate: newSession || recalibrating,
  };
}

export type TickGate = {
  selected: boolean; // this game is the active one
  onPlayPage: boolean;
  running: boolean; // user started/resumed and has not paused
  visible: boolean; // document visible
  usable: boolean; // connected, fresh, good quality, calibrated (isUsable)
  boundSession: string | null;
  telemetrySession: string | null | undefined;
};

/** A game may advance only when every gate passes. */
export function canTick(g: TickGate) {
  return (
    g.selected &&
    g.onPlayPage &&
    g.running &&
    g.visible &&
    g.usable &&
    g.boundSession !== null &&
    g.boundSession === g.telemetrySession
  );
}

/**
 * Why a game cannot tick right now, as a stable reason code for research logs
 * (null when it can). Checked in the order a participant would notice them.
 */
export function tickBlocker(g: TickGate): string | null {
  if (g.boundSession === null) return "not_started";
  // No fresh telemetry is an outage (input unusable), not a session change.
  if (g.telemetrySession === null || g.telemetrySession === undefined) return "input_unusable";
  if (g.boundSession !== g.telemetrySession) return "session_changed";
  if (!g.visible) return "tab_hidden";
  if (!g.selected || !g.onPlayPage) return "left_game";
  if (!g.usable) return "input_unusable";
  if (!g.running) return "paused_by_user";
  return null;
}
