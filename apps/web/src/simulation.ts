export type State = { x: number; velocity: number; angle: number; elapsed: number; centered: number; done: boolean; fell: boolean };
export const ROUND_SECONDS = 60;
export const CENTER_ZONE = 0.15;
export const initialState = (): State => ({ x: 0.2, velocity: 0, angle: 0, elapsed: 0, centered: 0, done: false, fell: false });
// Tunable rolling model. Leaving either end is a round-ending loss.
export function step(s: State, dt: number, score: number): State {
  if (s.done || dt <= 0) return s;
  const h = Math.min(dt, 1 / 30, ROUND_SECONDS - s.elapsed);
  const t = s.elapsed + h;
  const assistance = Math.max(0, Math.min(1, score));
  const disturbance = (0.08 + 0.4 * (1 - assistance)) * Math.sin(t * 0.7);
  const angle = Math.max(-0.35, Math.min(0.35, -(0.18 + 1.62 * assistance) * s.x - (0.1 + assistance) * s.velocity + disturbance));
  const velocity = s.velocity + (2.5 * Math.sin(angle) - 0.15 * s.velocity) * h;
  const x = s.x + velocity * h;
  const fell = Math.abs(x) >= 1;
  return { x, velocity, angle, elapsed: t, centered: s.centered + (Math.abs(x) <= CENTER_ZONE ? h : 0), done: fell || t >= ROUND_SECONDS, fell };
}
