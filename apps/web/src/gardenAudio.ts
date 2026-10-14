// Procedural ambient sound for the Glowing Garden. Everything is synthesized
// with the Web Audio API: no audio files, no dependencies.
//
//  pad      a soft D-major (add9) chord; its warmth (filter) and volume swell with the glow
//  shimmer  high, airy partials that only appear as the glow rises above baseline
//  breath   filtered noise that rises and falls with the shared breath clock, like wind
//  chimes   bell tones when the garden reaches something new (lights, stages, bloom)
//
// Silence is the paused state: when the garden is not live (and not settling in)
// the master fades out so sound never suggests live feedback.

const PAD_NOTES = [146.83, 220.0, 293.66, 329.63, 369.99]; // D3 A3 D4 E4 F#4
const SHIMMER_NOTES = [659.25, 880.0, 1108.73]; // E5 A5 C#6
const CHIME_NOTES = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66, 1318.51]; // D-major pentatonic

export type AudioFrame = {
  /** Plays at all only when true (live, or settling in). */
  on: boolean;
  /** Display response 0..1 (glow). */
  response: number;
  /** Breath level 0..1 from the shared clock. */
  breath: number;
  /** User volume 0..1. */
  volume: number;
};

type Ctx = AudioContext;

function impulse(ctx: Ctx, seconds: number, decay: number) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

export class GardenAudio {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private padFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private shimmerGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private chimeBus!: GainNode;
  private output!: DynamicsCompressorNode;
  private nextSparkle = 0;
  private lastFrame: AudioFrame | null = null;

  get running() {
    return this.ctx?.state === "running";
  }

  /** Must be called from a user gesture (click/keypress) the first time. */
  async start() {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== "running")
      await this.ctx.resume().catch(() => {});
  }

  async suspend() {
    if (this.ctx && this.ctx.state === "running")
      await this.ctx.suspend().catch(() => {});
  }

  dispose() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private build() {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const now = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    this.master.connect(limiter).connect(ctx.destination);
    this.output = limiter;

    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 3.2, 2.6);
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.55;
    reverb.connect(reverbGain).connect(this.master);

    // Pad: two slightly detuned voices per note, each breathing slowly in level.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 500;
    this.padFilter.Q.value = 0.4;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.06;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.master);
    const padSend = ctx.createGain();
    padSend.gain.value = 0.35;
    this.padGain.connect(padSend).connect(reverb);
    PAD_NOTES.forEach((f, i) => {
      for (const [type, cents] of [
        ["sine", -4],
        ["triangle", 5],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = cents;
        const voice = ctx.createGain();
        voice.gain.value = (type === "sine" ? 0.16 : 0.07) / (1 + i * 0.25);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.04 + i * 0.013;
        const depth = ctx.createGain();
        depth.gain.value = voice.gain.value * 0.45;
        lfo.connect(depth).connect(voice.gain);
        osc.connect(voice).connect(this.padFilter);
        osc.start(now);
        lfo.start(now + i * 0.7);
      }
    });

    // Shimmer: quiet high partials that fade in with the glow.
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    this.shimmerGain.connect(reverb);
    this.shimmerGain.connect(this.master);
    SHIMMER_NOTES.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11 + i * 0.05;
      const depth = ctx.createGain();
      depth.gain.value = 0.045;
      lfo.connect(depth).connect(g.gain);
      osc.connect(g).connect(this.shimmerGain);
      osc.start(now);
      lfo.start(now);
    });

    // Breath / wind: looping pink-ish noise through a moving band-pass.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      data[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 450;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    const windSend = ctx.createGain();
    windSend.gain.value = 0.3;
    this.windGain.connect(windSend).connect(reverb);
    src.start(now);

    this.chimeBus = ctx.createGain();
    this.chimeBus.gain.value = 1;
    this.chimeBus.connect(this.master);
    const chimeSend = ctx.createGain();
    chimeSend.gain.value = 0.8;
    this.chimeBus.connect(chimeSend).connect(reverb);
  }

  /** Development helper: a MediaStream of the final mix (used to record demos). */
  tap(): MediaStream | null {
    if (!this.ctx) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.output.connect(dest);
    return dest.stream;
  }

  /** Called ~10 times a second from the render loop. */
  update(f: AudioFrame) {
    this.lastFrame = f;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const r = Math.max(0, Math.min(1, f.response));
    const lift = Math.max(0, (r - 0.45) / 0.55);
    this.master.gain.setTargetAtTime(
      f.on ? 1.8 * f.volume : 0,
      t,
      f.on ? 0.9 : 0.5,
    );
    this.padFilter.frequency.setTargetAtTime(380 + 2600 * r * r, t, 0.6);
    this.padGain.gain.setTargetAtTime(0.045 + 0.085 * r, t, 0.6);
    this.shimmerGain.gain.setTargetAtTime(0.32 * lift ** 1.6, t, 0.8);
    this.windGain.gain.setTargetAtTime(0.025 + 0.11 * f.breath, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(320 + 620 * f.breath, t, 0.3);
    // Occasional soft sparkle while the glow is high.
    if (f.on && r > 0.68 && t > this.nextSparkle) {
      if (this.nextSparkle > 0)
        this.chime(4 + Math.floor(Math.random() * 3), 0.25);
      this.nextSparkle = t + 5 + Math.random() * 7;
    }
  }

  /** A single bell tone. `note` indexes the pentatonic scale; strength 0..1. */
  chime(note: number, strength = 0.6, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.lastFrame?.on) return;
    const f = CHIME_NOTES[Math.max(0, Math.min(CHIME_NOTES.length - 1, note))];
    const t = ctx.currentTime + 0.02 + delay;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.11 * strength, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    out.connect(this.chimeBus);
    for (const [ratio, level] of [
      [1, 1],
      [2.76, 0.28],
      [5.4, 0.08],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 3.8);
    }
  }

  /** A rising three-note arpeggio for reaching a new stage. */
  milestone(stage: number) {
    const base = [0, 1, 2][Math.max(0, Math.min(2, stage))];
    [base, base + 2, base + 4].forEach((n, i) =>
      this.chime(n, 0.75 - i * 0.12, i * 0.28),
    );
  }
}
