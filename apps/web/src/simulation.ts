export type State = { x: number; velocity: number; angle: number; elapsed: number; centered: number; done: boolean };
export const ROUND_SECONDS = 60;
export const CENTER_ZONE = 0.15;
export const initialState = (): State => ({ x: 0.2, velocity: 0, angle: 0, elapsed: 0, centered: 0, done: false });
// Dimensionless, constrained rolling model; deliberately tunable game physics.
export function step(s: State, dt: number, score: number, steering: number): State {
  if (s.done || dt <= 0) return s;
  const h = Math.min(dt, 1 / 30, ROUND_SECONDS - s.elapsed);
  const t = s.elapsed + h;
  const assistance = Math.max(0, Math.min(1, score));
  const disturbance = (0.12 + 0.34 * (1 - assistance)) * Math.sin(t * 1.9);
  const angle = Math.max(-0.35, Math.min(0.35, -1.8 * s.x - 1.1 * s.velocity + disturbance + steering * 0.18));
  let velocity = s.velocity + (2.5 * Math.sin(angle) - 0.15 * s.velocity) * h;
  let x = s.x + velocity * h;
  if (Math.abs(x) > 0.95) { x = Math.sign(x) * 0.95; velocity *= -0.3; }
  return { x, velocity, angle, elapsed: t, centered: s.centered + (Math.abs(x) <= CENTER_ZONE ? h : 0), done: t >= ROUND_SECONDS };
}
