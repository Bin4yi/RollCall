import type { ExerciseConfig } from './types';

export const bridge: ExerciseConfig = {
  id: 'bridge',
  name: 'Glute bridge',
  plural: 'glute bridges',
  view: 'side',
  kind: 'reps',
  lying: true,
  usesLegs: true,
  key: 'hip',
  start: 125,
  turn: 172,
  minRange: 0.55,
  depth: 0.85,
  lift: 'out',
  speedPoint: 'hip',
};
