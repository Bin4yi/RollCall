import type { PoseSession } from './format';
import { simBadFraming, simBalance, simJumps, simPlank, simReps } from './sim';
import type { PoseFrame } from './types';
import { L } from './types';

const even = (n: number, s = 0.8): number[] => Array.from({ length: n }, () => s);

/**
 * The synthetic sessions, by name. Written to apps/web/public/poses by `pnpm poses:gen` for replay, and
 * generated on the spot for sim mode. Flight times are chosen so jumps_tired's best is about 9% below the
 * usual seeded for the demo's Amara.
 */
export const POSE_LIBRARY: Record<string, () => PoseSession> = {
  jumps_tired: () => simJumps('jumps_tired', [{ flightS: 0.505 }, { flightS: 0.522 }, { flightS: 0.512 }], { seed: 31 }),
  jumps_fresh: () => simJumps('jumps_fresh', [{ flightS: 0.54 }, { flightS: 0.552 }, { flightS: 0.546 }], { seed: 32 }),
  jumps_tucked: () =>
    simJumps('jumps_tucked', [{ flightS: 0.68, hipRiseM: 0.2, tucked: true }, { flightS: 0.54 }, { flightS: 0.53 }, { flightS: 0.54 }], { seed: 33 }),
  balance_steady: () => simBalance('balance_steady', 21, 0.003, 34),
  squats_good: () => simReps('squats_good', 'squat', { lift: even(10) }, 35),
  // Rep speed falls steadily, as it does towards the end of a hard set.
  squats_slowing: () => simReps('squats_slowing', 'squat', { lift: [0.7, 0.7, 0.72, 0.76, 0.82, 0.92, 1.05, 1.2] }, 36),
  pushups: () => simReps('pushups', 'pushup', { lift: [0.6, 0.6, 0.62, 0.65, 0.7, 0.78, 0.9] }, 37),
  lunges: () => simReps('lunges', 'lunge', { lift: even(8) }, 38),
  bridges: () => simReps('bridges', 'bridge', { lift: even(8) }, 39),
  presses: () => simReps('presses', 'press', { lift: [0.7, 0.7, 0.72, 0.76, 0.84, 0.95] }, 40),
  plank: () => simPlank('plank', 40, 28, 41),
  bad_framing: () => simBadFraming('bad_framing', 5),
};

/** Which session each exercise replays. */
export const EXERCISE_SESSION: Record<string, string> = {
  squat: 'squats_slowing',
  goblet: 'squats_good',
  lunge: 'lunges',
  pushup: 'pushups',
  bridge: 'bridges',
  press: 'presses',
  plank: 'plank',
};

const SIDE_PAIRS: [number, number][] = [
  [L.lShoulder, L.rShoulder],
  [L.lElbow, L.rElbow],
  [L.lWrist, L.rWrist],
  [L.lHip, L.rHip],
  [L.lKnee, L.rKnee],
  [L.lAnkle, L.rAnkle],
  [L.lHeel, L.rHeel],
  [L.lFoot, L.rFoot],
];

/** The same frame with left and right swapped, so one balance recording covers both legs in replay. */
export function swapSides(frame: PoseFrame): PoseFrame {
  const lm = [...frame.lm];
  for (const [a, b] of SIDE_PAIRS) {
    lm[a] = frame.lm[b];
    lm[b] = frame.lm[a];
  }
  return { ...frame, lm };
}
