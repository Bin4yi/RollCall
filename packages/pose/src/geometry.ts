import { VISIBILITY_GATE, type PoseFrame } from './types';

export interface Pt {
  x: number;
  y: number;
}

/** A landmark in height units, or null if it didn't pass the visibility gate. */
export function pt(frame: PoseFrame, id: number): Pt | null {
  const m = frame.lm[id];
  if (!m || m.v < VISIBILITY_GATE) return null;
  return { x: m.x * frame.aspect, y: m.y };
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Midpoint of a left/right pair, or whichever one side was seen. */
export function pair(frame: PoseFrame, left: number, right: number): Pt | null {
  const a = pt(frame, left);
  const b = pt(frame, right);
  return a && b ? mid(a, b) : (a ?? b);
}

/** Angle at b, in degrees. */
export function angle(a: Pt, b: Pt, c: Pt): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (n === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))) * 180) / Math.PI;
}

/** Degrees away from straight up, for trunk lean. */
export function fromVertical(top: Pt, bottom: Pt): number {
  return (Math.atan2(Math.abs(top.x - bottom.x), Math.abs(bottom.y - top.y)) * 180) / Math.PI;
}

export function median(values: readonly number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}
