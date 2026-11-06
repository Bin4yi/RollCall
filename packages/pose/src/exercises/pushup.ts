import type { ExerciseConfig } from './types';

export const pushup: ExerciseConfig = {
  id: 'pushup',
  name: 'Push-up',
  plural: 'push-ups',
  view: 'side',
  kind: 'reps',
  lying: true,
  usesLegs: false,
  key: 'elbow',
  start: 165,
  turn: 85,
  minRange: 0.55,
  depth: 0.85,
  lift: 'return',
  speedPoint: 'shoulder',
  hipSagMin: 155,
};
