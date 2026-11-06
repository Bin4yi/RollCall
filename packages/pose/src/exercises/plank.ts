import type { ExerciseConfig } from './types';

export const plank: ExerciseConfig = {
  id: 'plank',
  name: 'Plank',
  plural: 'planks',
  view: 'side',
  kind: 'hold',
  lying: true,
  usesLegs: false,
  key: 'body',
  start: 175,
  turn: 150,
  minRange: 0,
  depth: 0,
  lift: 'return',
  speedPoint: 'hip',
  holdMin: 145,
  hipSagMin: 160,
};
