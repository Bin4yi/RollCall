import { angle, fromVertical, pair, pt, type Pt } from './geometry';
import { L, type PoseFrame } from './types';
import type { ExerciseConfig, KeyAngle, SpeedPoint } from './exercises/types';

export const TRAIN = {
  /** Default fatigue stop: suggest ending the set when rep speed falls this far from the set's fastest. */
  fatigueDrop: 0.2,
  /** Don't call a fatigue stop off fewer reps than this. */
  fatigueMinReps: 3,
  leaveStart: 0.25,
  backAtStart: 0.2,
  turnBack: 0.1,
  liftEnd: 0.8,
  tempoCv: 0.35,
  tempoMinReps: 4,
} as const;

export type FormFlag = 'depth' | 'knees-caving' | 'trunk-lean' | 'hips-sagging' | 'uneven-tempo';

/** Short, gentle, and never scolding. */
export const FORM_CUE: Record<FormFlag, string> = {
  depth: 'A little deeper if it feels good.',
  'knees-caving': 'Let your knees track over your toes.',
  'trunk-lean': 'Chest up a touch.',
  'hips-sagging': 'Lift your hips a little.',
  'uneven-tempo': 'Find a steady rhythm.',
};

export interface Rep {
  n: number;
  durationMs: number;
  /** Lifting-phase speed in torso lengths per second. Relative only. */
  speed: number;
  /** How far below this set's fastest rep, 0..1. */
  drop: number;
  /** 0..1 of the way from start to turn. */
  depth: number;
  flags: FormFlag[];
}

export interface SetSummary {
  exercise: string;
  reps: number;
  /** Partial reps that didn't reach the minimum range. */
  partials: number;
  fastest: number;
  slowest: number;
  /** Largest fall from the fastest rep. */
  speedDrop: number;
  avgDepth: number;
  flagCounts: Partial<Record<FormFlag, number>>;
  stopSuggestedAt: number | null;
  durationMs: number;
}

function side(frame: PoseFrame, ids: [number, number, number]): number | null {
  const a = pt(frame, ids[0]);
  const b = pt(frame, ids[1]);
  const c = pt(frame, ids[2]);
  return a && b && c ? angle(a, b, c) : null;
}

/** The key joint angle, averaged across the sides that were seen. Null means ignore this frame. */
export function keyAngle(frame: PoseFrame, key: KeyAngle): number | null {
  const both = (l: [number, number, number], r: [number, number, number], pick: 'avg' | 'min' = 'avg') => {
    const a = side(frame, l);
    const b = side(frame, r);
    if (a === null) return b;
    if (b === null) return a;
    return pick === 'min' ? Math.min(a, b) : (a + b) / 2;
  };
  switch (key) {
    case 'knee':
      return both([L.lHip, L.lKnee, L.lAnkle], [L.rHip, L.rKnee, L.rAnkle]);
    case 'front-knee':
      return both([L.lHip, L.lKnee, L.lAnkle], [L.rHip, L.rKnee, L.rAnkle], 'min');
    case 'hip':
      return both([L.lShoulder, L.lHip, L.lKnee], [L.rShoulder, L.rHip, L.rKnee]);
    case 'elbow':
      return both([L.lShoulder, L.lElbow, L.lWrist], [L.rShoulder, L.rElbow, L.rWrist]);
    case 'body':
      return both([L.lShoulder, L.lHip, L.lAnkle], [L.rShoulder, L.rHip, L.rAnkle]);
  }
}

const POINTS: Record<SpeedPoint, [number, number]> = {
  hip: [L.lHip, L.rHip],
  shoulder: [L.lShoulder, L.rShoulder],
  wrist: [L.lWrist, L.rWrist],
};

const bodySize = (frame: PoseFrame): number | null => {
  const s = pair(frame, L.lShoulder, L.rShoulder);
  const h = pair(frame, L.lHip, L.rHip);
  return s && h ? Math.hypot(s.x - h.x, s.y - h.y) : null;
};

type RepPhase = 'start' | 'out' | 'back';
interface Mark {
  t: number;
  p: Pt;
}

/** A state machine on the key angle, with hysteresis and a minimum range so half-reps don't count. */
export class RepCounter {
  readonly reps: Rep[] = [];
  partials = 0;
  stopSuggested = false;
  stopSuggestedAt: number | null = null;
  latestCue: FormFlag | null = null;
  private phase: RepPhase = 'start';
  private peak = 0;
  private repStartT = 0;
  /** Where the lifting phase began, and for 'out' lifts where it ended. */
  private liftFrom: Mark | null = null;
  private liftTo: Mark | null = null;
  private reachedTop = false;
  private flags = new Set<FormFlag>();
  private size = 0;
  private firstT: number | null = null;
  private lastT = 0;

  constructor(
    readonly exercise: ExerciseConfig,
    private readonly fatigueDrop: number = TRAIN.fatigueDrop,
  ) {}

  private progress(a: number): number {
    return (a - this.exercise.start) / (this.exercise.turn - this.exercise.start);
  }

  private formChecks(frame: PoseFrame): void {
    const e = this.exercise;
    if (e.trunkLeanMax !== undefined) {
      const s = pair(frame, L.lShoulder, L.rShoulder);
      const h = pair(frame, L.lHip, L.rHip);
      if (s && h && fromVertical(s, h) > e.trunkLeanMax) this.flags.add('trunk-lean');
    }
    if (e.hipSagMin !== undefined) {
      const body = keyAngle(frame, 'body');
      if (body !== null && body < e.hipSagMin) this.flags.add('hips-sagging');
    }
    if (e.kneesCaveRatio !== undefined) {
      const lk = pt(frame, L.lKnee);
      const rk = pt(frame, L.rKnee);
      const la = pt(frame, L.lAnkle);
      const ra = pt(frame, L.rAnkle);
      // Only meaningful facing the camera, where the feet are visibly apart.
      if (lk && rk && la && ra) {
        const feet = Math.abs(la.x - ra.x);
        if (feet > 0.03 && Math.abs(lk.x - rk.x) / feet < e.kneesCaveRatio) this.flags.add('knees-caving');
      }
    }
  }

  private complete(endT: number, lift: { from: Mark | null; to: Mark | null }): Rep | null {
    const e = this.exercise;
    const depth = this.peak;
    if (depth < e.minRange) {
      this.partials++;
      return null;
    }
    if (depth < e.depth) this.flags.add('depth');
    const speed =
      lift.from && lift.to && this.size
        ? Math.abs(lift.to.p.y - lift.from.p.y) / Math.max((lift.to.t - lift.from.t) / 1000, 1e-3) / this.size
        : 0;
    const fastest = Math.max(speed, ...this.reps.map((r) => r.speed));
    const durations = [...this.reps.map((r) => r.durationMs), endT - this.repStartT];
    if (durations.length >= TRAIN.tempoMinReps) {
      const mean = durations.reduce((s, v) => s + v, 0) / durations.length;
      const sd = Math.sqrt(durations.reduce((s, v) => s + (v - mean) ** 2, 0) / durations.length);
      if (mean > 0 && sd / mean > TRAIN.tempoCv) this.flags.add('uneven-tempo');
    }
    const rep: Rep = {
      n: this.reps.length + 1,
      durationMs: endT - this.repStartT,
      speed,
      drop: fastest > 0 ? 1 - speed / fastest : 0,
      depth,
      flags: [...this.flags],
    };
    this.reps.push(rep);
    this.latestCue = rep.flags[0] ?? null;
    if (!this.stopSuggested && this.reps.length >= TRAIN.fatigueMinReps && rep.drop >= this.fatigueDrop) {
      this.stopSuggested = true;
      this.stopSuggestedAt = rep.n;
    }
    return rep;
  }

  /** Returns a rep on the frame it's completed. Frames with too little visible are ignored. */
  push(frame: PoseFrame): Rep | null {
    const e = this.exercise;
    const a = keyAngle(frame, e.key);
    if (a === null) return null;
    if (this.firstT === null) this.firstT = frame.t;
    this.lastT = frame.t;
    const size = bodySize(frame);
    if (size) this.size = size;
    const p = this.progress(a);
    const [li, ri] = POINTS[e.speedPoint];
    const point = pair(frame, li, ri);
    const mark: Mark | null = point ? { t: frame.t, p: point } : null;

    if (this.phase === 'start') {
      if (p > TRAIN.leaveStart) {
        this.phase = 'out';
        this.peak = p;
        this.repStartT = frame.t;
        this.flags = new Set();
        this.liftFrom = e.lift === 'out' ? mark : null;
        this.liftTo = null;
        this.reachedTop = false;
      }
      return null;
    }
    this.formChecks(frame);
    if (this.phase === 'out') {
      if (p >= this.peak) {
        this.peak = p;
        // Timing stops short of the turn, where the pause and the jitter would swamp a short lift.
        if (e.lift === 'out' && mark && !(this.liftTo && this.reachedTop)) {
          this.liftTo = mark;
          this.reachedTop = p >= TRAIN.liftEnd;
        }
      } else if (p < this.peak - TRAIN.turnBack) {
        this.phase = 'back';
        if (e.lift === 'return') this.liftFrom = mark ?? this.liftFrom;
      }
      return null;
    }
    if (p > this.peak) {
      this.phase = 'out';
      this.peak = p;
      return null;
    }
    if (p < TRAIN.backAtStart) {
      this.phase = 'start';
      return this.complete(frame.t, {
        from: this.liftFrom,
        to: e.lift === 'return' ? mark : this.liftTo,
      });
    }
    return null;
  }

  summary(): SetSummary {
    const speeds = this.reps.map((r) => r.speed);
    const flagCounts: SetSummary['flagCounts'] = {};
    for (const r of this.reps) for (const f of r.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
    return {
      exercise: this.exercise.id,
      reps: this.reps.length,
      partials: this.partials,
      fastest: speeds.length ? Math.max(...speeds) : 0,
      slowest: speeds.length ? Math.min(...speeds) : 0,
      speedDrop: this.reps.reduce((m, r) => Math.max(m, r.drop), 0),
      avgDepth: this.reps.length ? this.reps.reduce((s, r) => s + r.depth, 0) / this.reps.length : 0,
      flagCounts,
      stopSuggestedAt: this.stopSuggestedAt,
      durationMs: this.firstT === null ? 0 : this.lastT - this.firstT,
    };
  }
}

export interface HoldSummary {
  exercise: string;
  holdSeconds: number;
  sagShare: number;
}

/** Plank: seconds held in position, and how much of that the hips were sagging. */
export class HoldTimer {
  private held = 0;
  private sag = 0;
  private last: number | null = null;
  holding = false;
  sagging = false;

  constructor(readonly exercise: ExerciseConfig) {}

  push(frame: PoseFrame): void {
    const a = keyAngle(frame, 'body');
    if (a === null) {
      this.last = null;
      this.holding = false;
      return;
    }
    const dt = this.last === null ? 0 : Math.max(0, (frame.t - this.last) / 1000);
    this.last = frame.t;
    this.holding = a >= (this.exercise.holdMin ?? 145);
    this.sagging = this.holding && a < (this.exercise.hipSagMin ?? 160);
    if (this.holding) {
      this.held += dt;
      if (this.sagging) this.sag += dt;
    }
  }

  get seconds(): number {
    return this.held;
  }

  summary(): HoldSummary {
    return { exercise: this.exercise.id, holdSeconds: this.held, sagShare: this.held ? this.sag / this.held : 0 };
  }
}
