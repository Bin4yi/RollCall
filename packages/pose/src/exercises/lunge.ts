import type { ExerciseConfig } from './types';

export const lunge: ExerciseConfig = {
  id: 'lunge',
  name: 'Lunge',
  plural: 'lunges',
  view: 'side',
  kind: 'reps',
  lying: false,
  usesLegs: true,
  key: 'front-knee',
  start: 170,
  turn: 100,
  minRange: 0.55,
  depth: 0.85,
  lift: 'return',
  speedPoint: 'hip',
  trunkLeanMax: 30,
};
