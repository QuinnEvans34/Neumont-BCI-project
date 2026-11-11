// The requested square wave is sampled on display frames. Fractional periods
// distribute longer/shorter on/off runs; callback timing is logged separately.
export function circleOn(frame: number, frequencyHz: number, profileHz: number) {
  return Math.floor(frame * 2 * frequencyHz / profileHz + 1e-9) % 2 === 0;
}

export type CircleSettings = { frequency_hz: number; color: string };
export type CircleSegment = {
  id: string;
  settings: CircleSettings;
  frame: number;
  rows: number[][];
  first: number;
  last: number;
  lastOn: boolean;
  rises: number[];
  worstInterval: number;
};

export function observedFrequency(rises: number[]) {
  if (rises.length < 2) return null;
  return (rises.length - 1) * 1000 / (rises[rises.length - 1] - rises[0]);
}
