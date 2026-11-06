import type { SignalBus, SignalSource, SourceStatus } from './bus';
import type { VitalsFrame } from './schema';

/** Small seeded PRNG (mulberry32) so simulated and generated sessions are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything the simulated body is doing right now. Scripts and the keyboard both write this. */
export interface BodyState {
  pulseBpm: number;
  breathBpm: number;
  /** 0 = metronomic, 1 = very uneven breath intervals. */
  breathJitter: number;
  breathAmplitude: number;
  talking: boolean;
  facePresent: boolean;
  /** Head movement speed; 0 = still. */
  headMotion: number;
  /** 0..1 fear/surprise expression level. */
  fear: number;
  /** 0..1 measurement confidence, standing in for lighting and framing quality. */
  signalQuality: number;
  qualityReason?: string;
  qualityCode?: number;
  rmssd: number;
  baevsky: number;
}

export const restingBody = (): BodyState => ({
  pulseBpm: 70,
  breathBpm: 14,
  breathJitter: 0.04,
  breathAmplitude: 1,
  talking: false,
  facePresent: true,
  headMotion: 0.002,
  fear: 0,
  signalQuality: 0.9,
  rmssd: 52,
  baevsky: 85,
});

const TRACE_HZ = 30;

/**
 * Synthesises frames in the same shape as the SDK normaliser: 10 Hz frames with pleth and
 * breath waveform samples. Rates carry the SDK's documented window lag (12 s pulse, 30 s breath)
 * and zero confidence until that window fills, so Sim mode exposes the real timing problems.
 */
export class BodySynth {
  readonly body: BodyState = restingBody();
  private readonly rng: () => number;
  private t = 0;
  private plethPhase = 0;
  private breathPhase = 0;
  private breathRateNow = 14;
  private pulseWindow = 70;
  private breathWindow = 14;
  private headX = 0.5;
  private headY = 0.45;
  private carry = 0;

  constructor(seed: number) {
    this.rng = makeRng(seed);
  }

  /** Advance exactly one 100 ms frame. */
  step(source: VitalsFrame['source']): VitalsFrame {
    const dt = 0.1;
    this.t += 100;
    const b = this.body;
    const elapsed = this.t / 1000;

    const present = b.facePresent;
    const pleth: number[] = [];
    const trace: number[] = [];
    const count = Math.round(TRACE_HZ * dt + this.carry);
    this.carry = TRACE_HZ * dt + this.carry - count;
    for (let i = 0; i < count; i++) {
      const dtSample = 1 / TRACE_HZ;
      this.plethPhase += (b.pulseBpm / 60) * dtSample;
      const beat = this.plethPhase % 1;
      const wave =
        Math.exp(-((beat - 0.2) ** 2) / 0.012) + 0.45 * Math.exp(-((beat - 0.5) ** 2) / 0.02);
      pleth.push(wave + (this.rng() - 0.5) * 0.04 * (1.2 - b.signalQuality));

      // New breath: re-roll the rate so jitter shows up as uneven peak intervals.
      const before = this.breathPhase;
      this.breathPhase += (this.breathRateNow / 60) * dtSample;
      if (Math.floor(this.breathPhase) !== Math.floor(before)) {
        this.breathRateNow = Math.max(
          3,
          b.breathBpm * (1 + (this.rng() - 0.5) * 2 * b.breathJitter),
        );
      }
      const breath = -Math.cos(2 * Math.PI * this.breathPhase) * b.breathAmplitude;
      trace.push(breath + (this.rng() - 0.5) * 0.02);
    }

    // Window lag matching the SDK's rolling averages, approximated as first-order filters.
    this.pulseWindow += (b.pulseBpm - this.pulseWindow) * (dt / 6);
    this.breathWindow += (b.breathBpm - this.breathWindow) * (dt / 15);

    this.headX += (this.rng() - 0.5) * b.headMotion * 2;
    this.headY += (this.rng() - 0.5) * b.headMotion * 2;
    this.headX += (0.5 - this.headX) * 0.05;
    this.headY += (0.45 - this.headY) * 0.05;

    const quality = present ? b.signalQuality : 0;
    const pulseConf = elapsed < 12 ? 0 : quality;
    const breathConf = elapsed < 30 ? 0 : quality;

    const frame: VitalsFrame = {
      t: this.t,
      source,
      facePresent: present,
      quality: present
        ? quality >= 0.45
          ? { ok: true }
          : {
              ok: false,
              reason: b.qualityReason ?? 'Increase light on face.',
              code: b.qualityCode ?? 5,
            }
        : { ok: false, reason: 'No face found.', code: 1 },
      talking: present && b.talking,
      blink: present && this.rng() < 0.03,
    };
    if (!present) return frame;

    frame.pulse = { bpm: round(this.pulseWindow, 1), conf: pulseConf };
    frame.pleth = {
      samples: pleth.map((v) => round(v, 3)),
      hz: TRACE_HZ,
      stable: pulseConf >= 0.4,
    };
    frame.breath = {
      bpm: round(this.breathWindow, 1),
      conf: breathConf,
      amplitude: round(b.breathAmplitude, 3),
      apnea: b.breathAmplitude < 0.1 && breathConf > 0,
    };
    frame.breathTrace = {
      samples: trace.map((v) => round(v, 3)),
      hz: TRACE_HZ,
      stable: breathConf >= 0.45,
    };
    const nn = 60000 / Math.max(30, this.pulseWindow);
    frame.hrv = {
      rmssd: round(b.rmssd, 1),
      sdnn: round(b.rmssd * 1.25, 1),
      meanNn: round(nn, 1),
      baevsky: round(b.baevsky, 1),
      conf: elapsed < 60 ? 0 : quality,
    };
    frame.expression = { neutral: round(1 - b.fear, 2), fear: round(b.fear, 2), surprise: 0 };
    frame.head = { x: round(this.headX, 4), y: round(this.headY, 4), scale: 0.3 };
    return frame;
  }
}

function round(v: number, places: number): number {
  const m = 10 ** places;
  return Math.round(v * m) / m;
}

/** Simulated source driven by a BodyState that callers can change while it runs. */
export class SimSource implements SignalSource {
  readonly kind = 'sim' as const;
  readonly label = 'SIM';
  status: SourceStatus = 'idle';
  private bus: SignalBus | null = null;
  private readonly synth: BodySynth;
  private carry = 0;

  constructor(seed = 1, initial: Partial<BodyState> = {}) {
    this.synth = new BodySynth(seed);
    Object.assign(this.synth.body, initial);
  }

  get body(): BodyState {
    return this.synth.body;
  }

  start(bus: SignalBus): void {
    this.bus = bus;
    this.status = 'streaming';
  }

  advance(dtMs: number): void {
    if (!this.bus) return;
    this.carry += dtMs;
    while (this.carry >= 100) {
      this.carry -= 100;
      this.bus.publish(this.synth.step('sim'));
    }
  }

  stop(): void {
    this.bus = null;
    this.status = 'idle';
  }
}
