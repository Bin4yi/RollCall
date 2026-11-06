import type { ExerciseConfig } from './types';

export const press: ExerciseConfig = {
  id: 'press',
  name: 'Overhead press',
  plural: 'overhead presses',
  view: 'front',
  kind: 'reps',
  lying: false,
  usesLegs: false,
  key: 'elbow',
  start: 85,
  turn: 170,
  minRange: 0.55,
  depth: 0.85,
  lift: 'out',
  speedPoint: 'wrist',
};
