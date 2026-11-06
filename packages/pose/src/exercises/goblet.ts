import type { ExerciseConfig } from './types';

/** Hands hold a weight at the chest or a bar on the back, so only legs and hips are tracked. */
export const goblet: ExerciseConfig = {
  id: 'goblet',
  name: 'Goblet or barbell squat',
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
  trunkLeanMax: 45,
  kneesCaveRatio: 0.7,
};
