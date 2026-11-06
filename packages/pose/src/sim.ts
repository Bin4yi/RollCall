import { JUMP } from './jump';
import { L, type Lm, type PoseFrame } from './types';
import type { PoseSession } from './format';

/**
 * Generates clearly labelled synthetic pose sessions, for tests and Judge Mode, until real recordings
 * exist. It's a stick figure with leg bones solved from hip and ankle positions, plus camera-like noise.
 * Never presented as a real person.
 */
const ASPECT = 0.75;
const THIGH = 0.16;
const SHIN = 0.16;
const TORSO = 0.18;
const NECK = 0.08;
const FLOOR = 0.92;
const UNIT_PER_M = (THIGH + SHIN) / JUMP.defaultLegMetres;
const STAND_HIP = FLOOR - (THIGH + SHIN) * 0.995;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

interface Xy {
  x: number;
  y: number;
}
type Part = keyof typeof L;
type Parts = Partial<Record<Part, Xy>>;

/** Two-bone solve: where the middle joint sits, bending towards `dir`. */
function solveJoint(top: Xy, end: Xy, bone: number, dir: number): Xy {
  const dx = end.x - top.x;
  const dy = end.y - top.y;
  const n = Math.hypot(dx, dy) || 1;
  const a = Math.min(n / 2, bone - 1e-5);
  const h = Math.sqrt(Math.max(0, bone * bone - a * a));
  return { x: top.x + (dx / n) * a + (dir * -dy * h) / n, y: top.y + (dy / n) * a + (dir * dx * h) / n };
}

function toFrame(t: number, parts: Parts, rand: () => number, noise: number, hide: readonly Part[] = []): PoseFrame {
  const lm: (Lm | undefined)[] = [];
  for (const [name, p] of Object.entries(parts) as [Part, Xy][]) {
    const j = () => (rand() - 0.5) * 2 * noise;
    lm[L[name]] = { x: (p.x + j()) / ASPECT, y: p.y + j(), v: hide.includes(name) ? 0.1 : 0.95 };
  }
  return { t, aspect: ASPECT, lm };
}

/** Facing the camera, hands on hips by default. Bent knees shorten the hip-to-ankle distance. */
function frontPose(hipY: number, ankleLift: number, cx: number, hands: 'hips' | 'out' = 'hips', rightLift = 0): Parts {
  const w = 0.045;
  const ankleL = { x: cx - w, y: FLOOR - ankleLift };
  const ankleR = { x: cx + w, y: FLOOR - ankleLift - rightLift };
  const sy = hipY - TORSO;
  const wrist = (s: number): Xy =>
    hands === 'hips' ? { x: cx + s * w * 1.4, y: hipY - 0.005 } : { x: cx + s * w * 3.4, y: sy - 0.02 };
  const elbow = (s: number): Xy =>
    hands === 'hips' ? { x: cx + s * w * 2.5, y: hipY - TORSO * 0.5 } : { x: cx + s * w * 2.6, y: sy + 0.04 };
  return {
    nose: { x: cx, y: sy - NECK },
    lShoulder: { x: cx - w * 1.5, y: sy },
    rShoulder: { x: cx + w * 1.5, y: sy },
    lElbow: elbow(-1),
    rElbow: elbow(1),
    lWrist: wrist(-1),
    rWrist: wrist(1),
    lHip: { x: cx - w * 0.9, y: hipY },
    rHip: { x: cx + w * 0.9, y: hipY },
    lKnee: { x: cx - w, y: (hipY + ankleL.y) / 2 },
    rKnee: { x: cx + w, y: (hipY + ankleR.y) / 2 },
    lAnkle: ankleL,
    rAnkle: ankleR,
    lHeel: { x: ankleL.x, y: ankleL.y + 0.01 },
    rHeel: { x: ankleR.x, y: ankleR.y + 0.01 },
    lFoot: { x: ankleL.x - 0.01, y: ankleL.y + 0.02 },
    rFoot: { x: ankleR.x + 0.01, y: ankleR.y + 0.02 },
  };
}

export interface JumpScript {
  flightS: number;
  /** Hip rise in metres. Defaults to what the flight time implies. */
  hipRiseM?: number;
  /** Knees bent on landing, which makes flight look longer than it was. */
  tucked?: boolean;
  handsOut?: boolean;
  feetCutOff?: boolean;
}

/** Stand, dip, push, flight, land, settle, for each scripted jump. */
export function simJumps(label: string, jumps: JumpScript[], opts: { fps?: number; seed?: number; rest?: number } = {}): PoseSession {
  const fps = opts.fps ?? 30;
  const rand = rng(opts.seed ?? 7);
  const cx = ASPECT / 2;
  const frames: PoseFrame[] = [];
  let t = 0;
  const emit = (hipY: number, lift: number, hands: 'hips' | 'out' = 'hips', hide: readonly Part[] = []) => {
    frames.push(toFrame(t, frontPose(hipY, lift, cx, hands), rand, 0.0012, hide));
    t += 1000 / fps;
  };
  const hold = (s: number) => {
    for (let i = 0; i < s * fps; i++) emit(STAND_HIP, 0);
  };
  hold(1.6);
  for (const j of jumps) {
    const hands = j.handsOut ? 'out' : 'hips';
    const dip = 0.11;
    for (let i = 0; i < 0.45 * fps; i++) emit(STAND_HIP + dip * ease(i / (0.45 * fps)), 0, hands);
    const push = Math.round(0.22 * fps);
    for (let i = 1; i <= push; i++) emit(STAND_HIP + dip * (1 - ease(i / push)), 0, hands);
    const T = j.flightS;
    const liftAt = (s: number, span: number) => 0.5 * JUMP.g * s * (span - s) * UNIT_PER_M;
    const hipPeakM = j.hipRiseM ?? (JUMP.g * T * T) / 8;
    const hipSpan = Math.sqrt((8 * hipPeakM) / JUMP.g);
    const offset = (T - hipSpan) / 2;
    const hide: Part[] = j.feetCutOff ? ['lAnkle', 'rAnkle'] : [];
    for (let s = 0; s < T; s += 1 / fps) {
      const hipLift = s > offset && s < offset + hipSpan ? liftAt(s - offset, hipSpan) : 0;
      // A tucked landing stays airborne with the hips already dropping and knees bent.
      const tuckDrop = j.tucked ? 0.1 * ease(s / T) : 0;
      emit(STAND_HIP - hipLift + tuckDrop, Math.max(liftAt(s, T), 0), hands, hide);
    }
    const land = j.tucked ? 0.1 : 0.05;
    // Legs are straight at touch-down, then the knees give and recover.
    for (let i = 0; i < 0.35 * fps; i++) emit(STAND_HIP + land * Math.sin(Math.PI * (i / (0.35 * fps))), 0, hands);
    hold(opts.rest ?? 3.5);
  }
  return { header: { pose: 1, label, synthetic: true, aspect: ASPECT, fps }, frames };
}

/** A single-leg stand on the left leg, with slow sway. */
export function simBalance(label: string, seconds: number, swayUnits: number, seed = 5): PoseSession {
  const fps = 30;
  const rand = rng(seed);
  const cx = ASPECT / 2;
  const frames: PoseFrame[] = [];
  const count = (seconds + 1.5) * fps;
  for (let i = 0; i < count; i++) {
    const t = (i * 1000) / fps;
    const up = i < 1.5 * fps ? 0 : 0.06;
    const parts = frontPose(STAND_HIP, 0, cx + (up ? swayUnits * Math.sin(t / 700) : 0), 'hips', up);
    parts.lAnkle = { x: cx - 0.045, y: FLOOR };
    frames.push(toFrame(t, parts, rand, 0.0008));
  }
  return { header: { pose: 1, label, synthetic: true, aspect: ASPECT, fps }, frames };
}

const MIRROR: [Part, Part][] = [
  ['lShoulder', 'rShoulder'],
  ['lElbow', 'rElbow'],
  ['lWrist', 'rWrist'],
  ['lHip', 'rHip'],
  ['lKnee', 'rKnee'],
  ['lAnkle', 'rAnkle'],
  ['lHeel', 'rHeel'],
  ['lFoot', 'rFoot'],
];

/** In a side view the far limb sits almost on top of the near one. */
function withFarSide(parts: Parts): Parts {
  const out: Parts = { ...parts };
  for (const [l, r] of MIRROR) {
    const p = out[l];
    if (p && !out[r]) out[r] = { x: p.x + 0.004, y: p.y };
  }
  return out;
}

/** Side view, facing right. */
function squatPose(kneeDeg: number, cx: number, lean: number): Parts {
  const ankle = { x: cx, y: FLOOR };
  const d = Math.sqrt(THIGH * THIGH + SHIN * SHIN - 2 * THIGH * SHIN * Math.cos((kneeDeg * Math.PI) / 180));
  const hip = { x: cx - 0.02, y: FLOOR - Math.sqrt(Math.max(d * d - 0.0004, 0)) };
  const kn = solveJoint(hip, ankle, THIGH, -1);
  const rad = (lean * Math.PI) / 180;
  const shoulder = { x: hip.x + Math.sin(rad) * TORSO, y: hip.y - Math.cos(rad) * TORSO };
  return withFarSide({
    nose: { x: shoulder.x + 0.03, y: shoulder.y - NECK },
    lShoulder: shoulder,
    lElbow: { x: shoulder.x + 0.05, y: shoulder.y + 0.08 },
    lWrist: { x: shoulder.x + 0.1, y: shoulder.y + 0.05 },
    lHip: hip,
    lKnee: kn,
    lAnkle: ankle,
    lHeel: { x: ankle.x - 0.015, y: ankle.y + 0.01 },
    lFoot: { x: ankle.x + 0.04, y: ankle.y + 0.015 },
  });
}

/** Face down, side view: feet at the left, one line up to the shoulders. Sag drops the hips. */
function pushupPose(elbowDeg: number, sagDeg: number): Parts {
  const ankle = { x: 0.08, y: 0.86 };
  const bone = 0.1;
  const armH = Math.sqrt(2 * bone * bone * (1 - Math.cos((elbowDeg * Math.PI) / 180)));
  const hand = { x: 0.62, y: 0.88 };
  const shoulder = { x: hand.x, y: hand.y - armH };
  const hip = { x: (ankle.x + shoulder.x) / 2, y: (ankle.y + shoulder.y) / 2 + sagDeg * 0.002 };
  return withFarSide({
    nose: { x: shoulder.x + 0.06, y: shoulder.y - 0.01 },
    lShoulder: shoulder,
    lElbow: solveJoint(shoulder, hand, bone, 1),
    lWrist: hand,
    lHip: hip,
    lKnee: { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2 },
    lAnkle: ankle,
    lHeel: { x: ankle.x - 0.01, y: ankle.y - 0.01 },
    lFoot: { x: ankle.x + 0.01, y: ankle.y + 0.015 },
  });
}

/** On the back with feet flat. Finds the hip height that gives the wanted hip angle. */
function bridgePose(hipDeg: number): Parts {
  const shoulder = { x: 0.1, y: 0.86 };
  const kneePt = { x: 0.5, y: 0.66 };
  const ankle = { x: 0.56, y: 0.87 };
  let hip = { x: 0.3, y: 0.9 };
  for (let y = 0.9; y > 0.76; y -= 0.0005) {
    const c = { x: 0.3, y };
    const ux = shoulder.x - c.x;
    const uy = shoulder.y - c.y;
    const vx = kneePt.x - c.x;
    const vy = kneePt.y - c.y;
    const a = (Math.acos((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))) * 180) / Math.PI;
    hip = c;
    if (a >= hipDeg) break;
  }
  return withFarSide({
    nose: { x: 0.04, y: 0.85 },
    lShoulder: shoulder,
    lElbow: { x: 0.2, y: 0.88 },
    lWrist: { x: 0.28, y: 0.88 },
    lHip: hip,
    lKnee: kneePt,
    lAnkle: ankle,
    lHeel: { x: ankle.x - 0.01, y: ankle.y + 0.01 },
    lFoot: { x: ankle.x + 0.03, y: ankle.y + 0.015 },
  });
}

/** Facing the camera, hands travelling from shoulders to overhead. */
function pressPose(elbowDeg: number): Parts {
  const cx = ASPECT / 2;
  const parts = frontPose(STAND_HIP, 0, cx);
  const w = 0.045 * 1.5;
  const bone = 0.09;
  const sy = STAND_HIP - TORSO;
  const reach = Math.sqrt(2 * bone * bone * (1 - Math.cos((elbowDeg * Math.PI) / 180)));
  const out = Math.sqrt(Math.max(0, bone * bone - (reach / 2) ** 2));
  parts.lWrist = { x: cx - w, y: sy - reach };
  parts.rWrist = { x: cx + w, y: sy - reach };
  parts.lElbow = { x: cx - w - out, y: sy - reach / 2 };
  parts.rElbow = { x: cx + w + out, y: sy - reach / 2 };
  return parts;
}

export type RepSim = 'squat' | 'pushup' | 'bridge' | 'press' | 'lunge';

export interface RepScript {
  /** Lifting-phase seconds per rep. A longer time is a slower rep. */
  lift: number[];
  lower?: number;
  turnAngle?: number;
  sag?: number;
}

const REP_RANGE: Record<RepSim, { start: number; turn: number; liftIs: 'return' | 'out' }> = {
  squat: { start: 172, turn: 92, liftIs: 'return' },
  lunge: { start: 170, turn: 96, liftIs: 'return' },
  pushup: { start: 165, turn: 82, liftIs: 'return' },
  bridge: { start: 125, turn: 174, liftIs: 'out' },
  press: { start: 85, turn: 172, liftIs: 'out' },
};

const POSE_FOR: Record<RepSim, (a: number, sag: number) => Parts> = {
  squat: (a) => squatPose(a, ASPECT / 2, 12 + (172 - a) * 0.22),
  lunge: (a) => squatPose(a, ASPECT / 2, 8),
  pushup: (a, sag) => pushupPose(a, sag),
  bridge: (a) => bridgePose(a),
  press: (a) => pressPose(a),
};

export function simReps(label: string, kind: RepSim, script: RepScript, seed = 9): PoseSession {
  const fps = 30;
  const rand = rng(seed);
  const range = REP_RANGE[kind];
  const pose = POSE_FOR[kind];
  const frames: PoseFrame[] = [];
  let t = 0;
  const emit = (a: number) => {
    frames.push(toFrame(t, pose(a, script.sag ?? 0), rand, 0.0006));
    t += 1000 / fps;
  };
  const turn = script.turnAngle ?? range.turn;
  for (let i = 0; i < 1.2 * fps; i++) emit(range.start);
  for (const lift of script.lift) {
    const lower = script.lower ?? 1;
    const goOut = range.liftIs === 'return' ? lower : lift;
    const goBack = range.liftIs === 'return' ? lift : lower;
    for (let i = 0; i < goOut * fps; i++) emit(lerp(range.start, turn, ease(i / (goOut * fps))));
    for (let i = 0; i < 0.12 * fps; i++) emit(turn);
    for (let i = 0; i < goBack * fps; i++) emit(lerp(turn, range.start, ease(i / (goBack * fps))));
    for (let i = 0; i < 0.5 * fps; i++) emit(range.start);
  }
  return { header: { pose: 1, label, synthetic: true, aspect: ASPECT, fps }, frames };
}

export function simPlank(label: string, seconds: number, sagFrom: number, seed = 3): PoseSession {
  const fps = 30;
  const rand = rng(seed);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const s = i / fps;
    const sag = s > sagFrom ? 30 * ease((s - sagFrom) / 4) : 0;
    frames.push(toFrame((i * 1000) / fps, pushupPose(165, sag), rand, 0.0006));
  }
  return { header: { pose: 1, label, synthetic: true, aspect: ASPECT, fps }, frames };
}

/** Feet out of the picture, for the framing guide. */
export function simBadFraming(label: string, seconds: number): PoseSession {
  const fps = 30;
  const rand = rng(21);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    frames.push(
      toFrame((i * 1000) / fps, frontPose(STAND_HIP, 0, ASPECT / 2), rand, 0.001, ['lAnkle', 'rAnkle', 'lFoot', 'rFoot', 'lHeel', 'rHeel']),
    );
  }
  return { header: { pose: 1, label, synthetic: true, aspect: ASPECT, fps }, frames };
}
