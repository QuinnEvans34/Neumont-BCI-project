export type InputFrame = {
  version: 1; sequence: number; timestamp_ms: number;
  source: 'synthetic' | 'live' | 'replay';
  score: number; quality: 'good' | 'poor'; calibrated: boolean;
};
export function parseFrame(value: unknown): InputFrame | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Record<string, unknown>;
  if (f.version !== 1 || !Number.isInteger(f.sequence) || (f.sequence as number) < 0 ||
      typeof f.timestamp_ms !== 'number' || !Number.isFinite(f.timestamp_ms) ||
      !['synthetic', 'live', 'replay'].includes(String(f.source)) ||
      typeof f.score !== 'number' || !Number.isFinite(f.score) || f.score < 0 || f.score > 1 ||
      !['good', 'poor'].includes(String(f.quality)) || typeof f.calibrated !== 'boolean') return null;
  return f as InputFrame;
}
export function isUsable(f: InputFrame | null, receivedAt: number, now: number) {
  return Boolean(f && f.quality === 'good' && f.calibrated && now - receivedAt <= 2000);
}
