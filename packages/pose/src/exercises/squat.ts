import type { ExerciseConfig } from './types';

/** Either view works: side for depth and lean, front adds the knee-tracking check. */
export const squat: ExerciseConfig = {
  id: 'squat',
  name: 'Bodyweight squat',
  plural: 'squats',
  view: 'side',
  kind: 'reps',
  lying: false,
  usesLegs: true,
  key: 'knee',
  start: 172,
  turn: 95,
  minRange: 0.55,
  depth: 0.85,
  lift: 'return',
  speedPoint: 'hip',
  trunkLeanMax: 50,
  kneesCaveRatio: 0.7,
};
