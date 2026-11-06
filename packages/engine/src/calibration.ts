import type { VitalsFrame } from '@hush/signals';
import { BreathAnalyzer } from './breath';
import type { EngineConfig } from './config';
import { median } from './util';

/** A player's own resting values. Everything in the game is measured relative to this. */
export interface Baseline {
  hr: number;
  br: number;
  /** Breath waveform span in trace units. */
  breathAmplitude: number;
  /** Typical per-second head movement while sitting still. */
  jitter: number;
  /** False if the timeout hit before a real baseline formed, so defaults were used. */
  measured: boolean;
}

export type CalibrationPhase = 'waiting' | 'collecting' | 'done';

export class Calibration {
  private pulse: number[] = [];
  private breath: number[] = [];
  private amplitudes: number[] = [];
  private headSpeeds: number[] = [];
  private lastHead: { t: number; x: number; y: number } | null = null;
  private readonly analyzer = new BreathAnalyzer();
  private elapsed = 0;
  private qualityOk = false;
  phase: CalibrationPhase = 'waiting';
  /** The SDK's own hint when the signal is poor; show it directly per the SDK docs. */
  hint: string | undefined;
  baseline: Baseline | null = null;

  constructor(private readonly config: EngineConfig) {}

  /** 0..1 for the UI. Tracks the slower of the two signals, since both are needed. */
  get progress(): number {
    if (this.phase === 'done') return 1;
    const c = this.config.calibration;
    return Math.min(
      this.pulse.length / c.minPulseSamples,
      this.breath.length / c.minBreathSamples,
      this.elapsed / c.minSeconds,
    );
  }

  get signalWeak(): boolean {
    return !this.qualityOk;
  }

  ingest(frame: VitalsFrame): void {
    if (this.phase === 'done') return;
    this.qualityOk = !!frame.facePresent && frame.quality?.ok !== false;
    this.hint = frame.quality?.ok === false ? frame.quality.reason : undefined;

    const c = this.config.confidence;
    if (this.qualityOk && frame.pulse && frame.pulse.conf >= c.pulse) {
      this.pulse.push(frame.pulse.bpm);
    }
    if (this.qualityOk && frame.breath && frame.breath.conf >= c.breath) {
      this.breath.push(frame.breath.bpm);
      if (frame.breath.amplitude !== undefined) this.amplitudes.push(frame.breath.amplitude);
    }
    if (frame.breathTrace) this.analyzer.push(frame.breathTrace.samples, frame.breathTrace.hz);
    if (this.qualityOk && frame.head) {
      const last = this.lastHead;
      if (last && frame.t > last.t) {
        const dt = (frame.t - last.t) / 1000;
        this.headSpeeds.push(Math.hypot(frame.head.x - last.x, frame.head.y - last.y) / dt);
      }
      this.lastHead = { t: frame.t, x: frame.head.x, y: frame.head.y };
    }
    if (this.pulse.length || this.breath.length) this.phase = 'collecting';
  }

  tick(dtSeconds: number): void {
    if (this.phase === 'done') return;
    this.elapsed += dtSeconds;
    const c = this.config.calibration;
    const ready =
      this.elapsed >= c.minSeconds &&
      this.pulse.length >= c.minPulseSamples &&
      this.breath.length >= c.minBreathSamples;
    if (ready) this.finish(true);
    // Never trap a player: after the limit, carry on with defaults rather than fail them.
    else if (this.elapsed >= c.maxSeconds) this.finish(false);
  }

  private finish(measured: boolean): void {
    const d = this.config.calibration.defaults;
    this.baseline = {
      hr: this.pulse.length ? median(this.pulse) : d.hr,
      br: this.breath.length ? median(this.breath) : d.br,
      // The SDK amplitude and the waveform span have different units; flat-breath detection only
      // ever compares like with like, using the waveform span.
      breathAmplitude: this.analyzer.amplitude > 0 ? this.analyzer.amplitude : 1,
      jitter: Math.max(0.002, median(this.headSpeeds)),
      measured,
    };
    this.phase = 'done';
  }
}
