export type InputFrame = {
  version: 1; sequence: number; timestamp_ms: number;
  source: 'synthetic' | 'live' | 'replay' | 'simulated_eeg';
  score: number; quality: 'good' | 'poor'; calibrated: boolean;
};
export function parseFrame(value: unknown): InputFrame | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Record<string, unknown>;
  if (f.version !== 1 || !Number.isInteger(f.sequence) || (f.sequence as number) < 0 ||
      typeof f.timestamp_ms !== 'number' || !Number.isFinite(f.timestamp_ms) ||
      !['synthetic', 'live', 'replay', 'simulated_eeg'].includes(String(f.source)) ||
      typeof f.score !== 'number' || !Number.isFinite(f.score) || f.score < 0 || f.score > 1 ||
      !['good', 'poor'].includes(String(f.quality)) || typeof f.calibrated !== 'boolean') return null;
  return f as InputFrame;
}
export function isUsable(f: InputFrame | null, receivedAt: number, now: number, wallNow = Date.now()) {
  return Boolean(f && f.quality === 'good' && f.calibrated && now - receivedAt <= 2000 && wallNow - f.timestamp_ms <= 2000 && f.timestamp_ms - wallNow <= 2000);
}
