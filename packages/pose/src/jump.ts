import { dist, median, mid, pair, pt, type Pt } from './geometry';
import { L, type PoseFrame } from './types';

export const JUMP = {
  g: 9.81,
  /** Seconds of standing still used to learn the standing level. */
  standSeconds: 0.8,
  /** How far the feet must rise to count as off the floor, as a share of leg length. */
  liftThreshold: 0.035,
  /** Hip drop that counts as the dip. */
  dipThreshold: 0.06,
  minAirFrames: 4,
  /** Longer than this isn't a real jump from standing. */
  maxFlightMs: 1000,
  minFlightMs: 150,
  /** Wrist further than this from the hip means the hands came off, as a share of leg length. */
  handsOff: 0.42,
  /** Knee angle at landing this far below take-off means tucked, which fakes extra flight. */
  tuckDegrees: 25,
  /** Share by which flight-time height and hip-rise height may differ. */
  maxDisagreement: 0.45,
  /** Used if the camera gives no real-world leg length. Only affects the cross-check. */
  defaultLegMetres: 0.85,
  targetJumps: 3,
  maxAttempts: 6,
} as const;

export type JumpProblem = 'knees-tucked' | 'hands-off-hips' | 'out-of-frame' | 'too-few-frames' | 'methods-disagree';

export const JUMP_PROBLEM_TEXT: Record<JumpProblem, string> = {
  'knees-tucked': 'Land with straighter legs, then we’ll take another.',
  'hands-off-hips': 'Keep your hands on your hips for this one. Go again.',
  'out-of-frame': 'You went out of the picture. Step back a little and go again.',
  'too-few-frames': 'I couldn’t see enough of that one. Go again.',
  'methods-disagree': 'That one looked odd to me. Let’s take another.',
};

export interface JumpResult {
  flightMs: number;
  /** g·t²/8. An estimate, shown only as a change against the person's own usual. */
  heightM: number;
  /** The cross-check: hip rise from take-off to the top, in metres from leg length. */
  hipRiseM: number;
  kneeAtTakeoff: number;
  kneeAtLanding: number;
  airFrames: number;
  /** Measured frame rate around this jump. */
  fps: number;
  valid: boolean;
  problem?: JumpProblem;
}

export type JumpPhase = 'standing' | 'ready' | 'dip' | 'air' | 'settling';

interface Read {
  t: number;
  hip: Pt;
  lift: number;
  ext: number;
  handsOff: boolean;
}

/**
 * In the front view a bending knee points at the camera, so a 2D knee angle barely changes. Hip-to-ankle
 * distance does shrink, and with two equal leg bones it gives the angle: distance = leg · sin(angle/2).
 */
export const kneeFromExtension = (ext: number): number =>
  (2 * Math.asin(Math.max(0, Math.min(1, ext))) * 180) / Math.PI;

/** Finds countermovement jumps in a stream of frames. Pure and deterministic: same frames, same jumps. */
export class JumpDetector {
  phase: JumpPhase = 'standing';
  private standAnkle = { l: 0, r: 0 };
  private standHip = 0;
  private leg = 0;
  private samples: { t: number; la: number; ra: number; hip: number; leg: number }[] = [];
  private prev: Read | null = null;
  private takeoffT = 0;
  private takeoffExt = 1;
  private takeoffHip = 0;
  private apexHip = Infinity;
  private airFrames = 0;
  private lostInAir = false;
  private hands = false;
  private settleUntil = 0;
  private recentT: number[] = [];

  constructor(private readonly legMetres: number = JUMP.defaultLegMetres) {}

  private read(frame: PoseFrame): Read | null {
    const hip = pair(frame, L.lHip, L.rHip);
    const la = pt(frame, L.lAnkle);
    const ra = pt(frame, L.rAnkle);
    if (!hip || !la || !ra || !this.leg) return null;
    const lift = Math.min(this.standAnkle.l - la.y, this.standAnkle.r - ra.y) / this.leg;
    const lw = pt(frame, L.lWrist);
    const rw = pt(frame, L.rWrist);
    const limit = JUMP.handsOff * this.leg;
    const handsOff = (lw !== null && dist(lw, hip) > limit) || (rw !== null && dist(rw, hip) > limit);
    return { t: frame.t, hip, lift, ext: dist(hip, mid(la, ra)) / this.leg, handsOff };
  }

  private learn(frame: PoseFrame): void {
    const hip = pair(frame, L.lHip, L.rHip);
    const la = pt(frame, L.lAnkle);
    const ra = pt(frame, L.rAnkle);
    if (!hip || !la || !ra) {
      this.samples = [];
      return;
    }
    this.samples.push({ t: frame.t, la: la.y, ra: ra.y, hip: hip.y, leg: dist(hip, mid(la, ra)) });
    if (frame.t - this.samples[0]!.t < JUMP.standSeconds * 1000) return;
    const legNow = median(this.samples.map((s) => s.leg));
    const hipYs = this.samples.map((s) => s.hip);
    // Not still yet: drop the oldest and keep waiting.
    if (Math.max(...hipYs) - Math.min(...hipYs) > 0.05 * legNow) {
      this.samples.shift();
      return;
    }
    this.standAnkle = { l: median(this.samples.map((s) => s.la)), r: median(this.samples.map((s) => s.ra)) };
    this.standHip = median(hipYs);
    this.leg = legNow;
    this.samples = [];
    this.phase = 'ready';
  }

  private finish(landedAt: number, landExt: number): JumpResult {
    const flightMs = landedAt - this.takeoffT;
    const seconds = flightMs / 1000;
    const heightM = (JUMP.g * seconds * seconds) / 8;
    const hipRiseM = ((this.takeoffHip - this.apexHip) / this.leg) * this.legMetres;
    const kneeAtTakeoff = kneeFromExtension(this.takeoffExt);
    const kneeAtLanding = kneeFromExtension(landExt);
    const span = this.recentT.length > 1 ? this.recentT.at(-1)! - this.recentT[0]! : 0;
    const fps = span > 0 ? ((this.recentT.length - 1) * 1000) / span : 0;
    let problem: JumpProblem | undefined;
    if (this.lostInAir) problem = 'out-of-frame';
    else if (this.airFrames < JUMP.minAirFrames || flightMs < JUMP.minFlightMs || flightMs > JUMP.maxFlightMs) {
      problem = 'too-few-frames';
    } else if (kneeAtLanding < kneeAtTakeoff - JUMP.tuckDegrees) problem = 'knees-tucked';
    else if (this.hands) problem = 'hands-off-hips';
    else if (Math.abs(heightM - hipRiseM) / Math.max(heightM, hipRiseM, 1e-6) > JUMP.maxDisagreement) {
      problem = 'methods-disagree';
    }
    return {
      flightMs,
      heightM,
      hipRiseM,
      kneeAtTakeoff,
      kneeAtLanding,
      airFrames: this.airFrames,
      fps,
      valid: !problem,
      ...(problem ? { problem } : {}),
    };
  }

  /** Returns a jump on the frame its landing is confirmed. */
  push(frame: PoseFrame): JumpResult | null {
    this.recentT.push(frame.t);
    if (this.recentT.length > 90) this.recentT.shift();
    if (this.phase === 'standing') {
      this.learn(frame);
      return null;
    }
    const now = this.read(frame);
    if (!now) {
      // Feet gone from view mid-dip means the take-off itself was missed.
      if (this.phase === 'dip') {
        this.takeoffT = frame.t;
        this.takeoffExt = 1;
        this.takeoffHip = this.standHip;
        this.apexHip = this.standHip;
        this.airFrames = 0;
        this.phase = 'air';
      }
      if (this.phase !== 'air') return null;
      this.lostInAir = true;
      // Gone from view without landing: don't wait forever.
      if (frame.t - this.takeoffT > JUMP.maxFlightMs * 1.5) {
        const result = this.finish(frame.t, this.takeoffExt);
        this.prev = null;
        this.phase = 'settling';
        this.settleUntil = frame.t + 1200;
        return result;
      }
      return null;
    }
    const prev = this.prev;
    this.prev = now;
    const threshold = JUMP.liftThreshold;

    if (this.phase === 'settling') {
      if (frame.t >= this.settleUntil) {
        this.hands = false;
        this.phase = 'ready';
      }
      return null;
    }
    if (now.handsOff && this.phase !== 'ready') this.hands = true;
    if (this.phase === 'ready' && (now.hip.y - this.standHip) / this.leg > JUMP.dipThreshold) {
      this.phase = 'dip';
      this.hands = now.handsOff;
    }
    if ((this.phase === 'ready' || this.phase === 'dip') && prev && now.lift > threshold && prev.lift <= threshold) {
      // Between frames: estimate the moment the feet crossed the line, rather than rounding to a frame.
      const share = (threshold - prev.lift) / (now.lift - prev.lift);
      this.takeoffT = prev.t + share * (now.t - prev.t);
      this.takeoffExt = prev.ext;
      this.takeoffHip = prev.hip.y;
      this.apexHip = now.hip.y;
      this.airFrames = 1;
      this.lostInAir = false;
      this.phase = 'air';
      return null;
    }
    if (this.phase === 'air') {
      this.apexHip = Math.min(this.apexHip, now.hip.y);
      if (now.lift > threshold) {
        this.airFrames++;
        return null;
      }
      const from = prev ?? now;
      const span = from.lift - now.lift;
      const share = span > 0 ? (from.lift - threshold) / span : 1;
      // Knees normally give just after touch-down, so the last frame in the air is the fair one to judge.
      const result = this.finish(from.t + share * (now.t - from.t), from.ext);
      this.phase = 'settling';
      this.settleUntil = frame.t + 1200;
      return result;
    }
    return null;
  }
}

/** Best of up to three valid jumps. Rejected jumps are kept too, but never count. */
export class LegsCheck {
  readonly jumps: JumpResult[] = [];
  private readonly detector: JumpDetector;

  constructor(legMetres?: number) {
    this.detector = new JumpDetector(legMetres);
  }

  get phase(): JumpPhase {
    return this.detector.phase;
  }

  get valid(): JumpResult[] {
    return this.jumps.filter((j) => j.valid);
  }

  get done(): boolean {
    return this.valid.length >= JUMP.targetJumps || this.jumps.length >= JUMP.maxAttempts;
  }

  get best(): JumpResult | null {
    return this.valid.reduce<JumpResult | null>((b, j) => (!b || j.heightM > b.heightM ? j : b), null);
  }

  push(frame: PoseFrame): JumpResult | null {
    if (this.done) return null;
    const jump = this.detector.push(frame);
    if (jump) this.jumps.push(jump);
    return jump;
  }
}

/**
 * How much one frame of timing error moves the height. Height goes with flight time squared, so its
 * relative error is about twice the time error. At 30 fps and 0.45 s of flight, one frame is about 15%.
 */
export const frameError = (fps: number, flightSeconds: number): number => 2 * (1 / fps / flightSeconds);
