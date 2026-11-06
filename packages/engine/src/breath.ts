import { cv } from './util';

/**
 * Finds breaths in the raw waveform. The SDK's `breathing.rate` is a 30 s average, far too slow for
 * a 20–35 s encounter, so the fast rate and regularity signals come from peak intervals here.
 * The trace is unitless, so thresholds adapt to its recent range.
 */
export class BreathAnalyzer {
  private buffer: number[] = [];
  private bufferMax = 0;
  private time = 0;
  private lastPeakAt: number | null = null;
  private candidate: { at: number; value: number } | null = null;
  private armed = false;
  /** Seconds between recent breath peaks, newest last. */
  readonly intervals: number[] = [];
  /** Peak-to-trough span over the recent window, in trace units. */
  amplitude = 0;
  /** Span over only the last few seconds, so a held breath shows up quickly. */
  recentAmplitude = 0;
  /** Number of breaths detected in total. */
  breaths = 0;
  private hz = 30;

  constructor(
    private readonly windowSeconds = 12,
    private readonly minIntervalSeconds = 1.2,
    private readonly maxIntervals = 8,
  ) {}

  /** Seconds of waveform currently held. */
  get buffered(): number {
    return this.buffer.length / this.hz;
  }

  /** Breaths per minute from recent intervals; null until two peaks have been seen. */
  get rate(): number | null {
    const recent = this.intervals.slice(-3);
    if (!recent.length) return null;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    // A long silence since the last peak also means slow breathing, without waiting for the next.
    const since = this.lastPeakAt === null ? 0 : this.time - this.lastPeakAt;
    return 60 / Math.max(mean, since);
  }

  /** Spec §7: variation of the last four breath intervals. */
  get irregularity(): number {
    return cv(this.intervals.slice(-4));
  }

  push(samples: number[], hz: number): void {
    const dt = 1 / hz;
    this.hz = hz;
    this.bufferMax = Math.ceil(this.windowSeconds * hz);
    for (const sample of samples) {
      this.time += dt;
      this.buffer.push(sample);
      if (this.buffer.length > this.bufferMax) this.buffer.shift();
      this.detect(sample);
    }
  }

  /** Clears state after a signal gap, so a dropout never reads as one very long breath. */
  reset(): void {
    this.buffer = [];
    this.lastPeakAt = null;
    this.candidate = null;
    this.armed = false;
    this.intervals.length = 0;
    this.amplitude = 0;
    this.recentAmplitude = 0;
  }

  private detect(sample: number): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of this.buffer) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.amplitude = hi - lo;
    // 4 s is short enough to catch a hold, and even 5 br/min still moves over 25% in that time.
    const recentCount = Math.ceil(4 * this.hz);
    let recentLo = Infinity;
    let recentHi = -Infinity;
    for (let i = Math.max(0, this.buffer.length - recentCount); i < this.buffer.length; i++) {
      const v = this.buffer[i]!;
      if (v < recentLo) recentLo = v;
      if (v > recentHi) recentHi = v;
    }
    this.recentAmplitude = recentHi - recentLo;
    if (this.amplitude <= 1e-6) return;
    const level = (sample - lo) / this.amplitude;

    // Hysteresis: dip below 35% arms the detector; the top of the next rise above 65% is a peak.
    if (level < 0.35) {
      if (this.candidate) this.commit();
      this.armed = true;
    } else if (this.armed && level > 0.65) {
      if (!this.candidate || sample > this.candidate.value) {
        this.candidate = { at: this.time, value: sample };
      }
    }
  }

  private commit(): void {
    const peak = this.candidate;
    this.candidate = null;
    this.armed = false;
    if (!peak) return;
    if (this.lastPeakAt !== null) {
      const interval = peak.at - this.lastPeakAt;
      if (interval < this.minIntervalSeconds) return;
      this.intervals.push(interval);
      if (this.intervals.length > this.maxIntervals) this.intervals.shift();
    }
    this.lastPeakAt = peak.at;
    this.breaths++;
  }
}
