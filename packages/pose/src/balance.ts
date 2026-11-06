import { dist, pair, pt } from './geometry';
import { L, type PoseFrame } from './types';

export const BALANCE = { seconds: 20, liftThreshold: 0.05, settleMs: 1000 } as const;

export type BalanceSide = 'left' | 'right';

export interface BalanceResult {
  side: BalanceSide;
  /** Root-mean-square sway of the hip centre, as a percentage of leg length. Lower is steadier. */
  swayPct: number;
  /** Times the raised foot came down. */
  touches: number;
  seconds: number;
}

/** A 20-second single-leg stand, the low-impact alternative to jumping. `side` is the standing leg. */
export class BalanceTest {
  private floor: number | null = null;
  private leg = 0;
  private start: number | null = null;
  private readonly hips: { x: number; y: number }[] = [];
  private raised = false;
  private touchCount = 0;
  private lastT = 0;

  constructor(readonly side: BalanceSide) {}

  get seconds(): number {
    return this.start === null ? 0 : Math.max(0, (this.lastT - this.start) / 1000);
  }

  get started(): boolean {
    return this.start !== null;
  }

  get done(): boolean {
    return this.seconds >= BALANCE.seconds;
  }

  push(frame: PoseFrame): void {
    if (this.done) return;
    const hip = pair(frame, L.lHip, L.rHip);
    const stand = pt(frame, this.side === 'left' ? L.lAnkle : L.rAnkle);
    const free = pt(frame, this.side === 'left' ? L.rAnkle : L.lAnkle);
    if (!hip || !stand || !free) return;
    this.lastT = frame.t;
    this.leg = dist(hip, stand);
    // The floor is where the standing foot is; a raised foot sits above it.
    this.floor = this.floor === null ? stand.y : Math.max(this.floor, stand.y);
    const lifted = (this.floor - free.y) / this.leg > BALANCE.liftThreshold;
    if (lifted && this.start === null) this.start = frame.t;
    if (this.start === null) return;
    if (!lifted && this.raised) this.touchCount++;
    this.raised = lifted;
    if (frame.t - this.start > BALANCE.settleMs) this.hips.push(hip);
  }

  result(): BalanceResult {
    const n = this.hips.length;
    if (!n) return { side: this.side, swayPct: 0, touches: this.touchCount, seconds: this.seconds };
    const mx = this.hips.reduce((s, p) => s + p.x, 0) / n;
    const my = this.hips.reduce((s, p) => s + p.y, 0) / n;
    const rms = Math.sqrt(this.hips.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / n);
    return { side: this.side, swayPct: (rms / this.leg) * 100, touches: this.touchCount, seconds: this.seconds };
  }
}
