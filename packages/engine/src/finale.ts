import type { BreathAnalyzer } from './breath';
import type { EngineConfig } from './config';
import { cv } from './util';

/** 12 s between breaths is 5 br/min, the bottom of the SDK's validated breathing range. */
const MAX_VALID_INTERVAL = 12.5;

/**
 * The acoustic lock opens on a run of slow, regular breaths measured from the live waveform.
 * Each breath has to actually happen, so holding your breath can never open it.
 */
export class AcousticLock {
  streak = 0;
  private seenBreaths: number;
  private streakIntervals: number[] = [];

  constructor(
    private readonly config: EngineConfig,
    private readonly analyzer: BreathAnalyzer,
    private readonly baselineBr: number,
  ) {
    this.seenBreaths = analyzer.breaths;
  }

  get required(): number {
    return this.config.finale.requiredBreaths;
  }

  get open(): boolean {
    return this.streak >= this.required;
  }

  update(): void {
    if (this.open || this.analyzer.breaths === this.seenBreaths) return;
    this.seenBreaths = this.analyzer.breaths;
    const interval = this.analyzer.intervals.at(-1);
    if (interval === undefined) return;

    const maxRate = this.baselineBr * this.config.finale.belowBaseline;
    const slowEnough = 60 / interval <= maxRate && interval <= MAX_VALID_INTERVAL;
    if (!slowEnough) {
      this.streak = 0;
      this.streakIntervals = [];
      return;
    }
    this.streakIntervals.push(interval);
    if (cv(this.streakIntervals) > this.config.finale.maxIrregularity) {
      // Restart from this breath rather than throwing away a good one.
      this.streakIntervals = [interval];
    }
    this.streak = this.streakIntervals.length;
  }
}
