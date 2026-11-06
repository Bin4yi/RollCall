import type { Lm, PoseFrame } from './types';

/**
 * One Euro filter (Casiez, Roussel and Vogel, CHI 2012): smooths hard when still and follows quickly
 * when moving. Tuned quick, because jump timing can't afford lag.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(
    private readonly minCutoff = 3,
    private readonly beta = 8,
    private readonly dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  next(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    const rate = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rate - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Smooths every landmark. Low-visibility points pass through, so the gate can still reject them. */
export class PoseSmoother {
  private readonly filters = new Map<number, [OneEuro, OneEuro]>();

  next(frame: PoseFrame): PoseFrame {
    const lm: (Lm | undefined)[] = frame.lm.map((m, id) => {
      if (!m) return undefined;
      let pair = this.filters.get(id);
      if (!pair) {
        pair = [new OneEuro(), new OneEuro()];
        this.filters.set(id, pair);
      }
      return { x: pair[0].next(m.x, frame.t), y: pair[1].next(m.y, frame.t), v: m.v };
    });
    return { ...frame, lm };
  }
}
