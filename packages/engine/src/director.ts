import { makeRng } from '@hush/signals';
import type { EngineConfig } from './config';

/** Paces encounters: spaced out, escalating gently, easing off after a near-catch. */
export class Director {
  private lastEnd = 0;
  private time = 0;
  private gap: number;
  private ease = 0;
  private busy = false;
  encountersFinished = 0;
  private readonly rng: () => number;
  private readonly multiplier: number;

  constructor(
    private readonly config: EngineConfig,
    seed: number,
    gentle: boolean,
  ) {
    this.rng = makeRng(seed ^ 0x5eed);
    this.multiplier = gentle ? config.director.gentleGapMultiplier : 1;
    this.gap = this.nextGap();
  }

  private nextGap(): number {
    const [lo, hi] = this.config.director.targetGapSeconds;
    return (lo + (hi - lo) * this.rng()) * this.multiplier;
  }

  private get sinceLast(): number {
    return this.time - this.lastEnd;
  }

  /** Noise may draw the Listener over. */
  get mayEngage(): boolean {
    return (
      !this.busy &&
      this.sinceLast >= this.config.director.minGapSeconds * this.multiplier + this.ease
    );
  }

  /** The Listener should come over regardless of noise. */
  get mustEngage(): boolean {
    return !this.busy && this.sinceLast >= this.gap + this.ease;
  }

  /** 0 at the start of a run, 1 once the run has fully escalated. */
  get intensity(): number {
    return Math.min(1, this.encountersFinished / this.config.director.escalationEncounters);
  }

  get searchSeconds(): number {
    const [lo, hi] = this.config.director.searchSeconds;
    return lo + (hi - lo) * this.intensity;
  }

  get gainMultiplier(): number {
    return 1 + 0.25 * this.intensity;
  }

  tick(dt: number): void {
    this.time += dt;
  }

  /** An investigation or search is under way, which blocks stacking another. */
  onEngaged(): void {
    this.busy = true;
  }

  /** The encounter is over (or it searched an empty room, with `peak` 0). */
  onFinished(peak: number, wasEncounter: boolean): void {
    this.busy = false;
    this.lastEnd = this.time;
    this.gap = this.nextGap();
    if (wasEncounter) this.encountersFinished++;
    this.ease =
      peak >= this.config.director.nearCatchSuspicion
        ? this.config.director.nearCatchEaseSeconds
        : 0;
  }
}
