import { bridge } from './bridge';
import { goblet } from './goblet';
import { lunge } from './lunge';
import { plank } from './plank';
import { press } from './press';
import { pushup } from './pushup';
import { squat } from './squat';
import type { ExerciseConfig } from './types';

export type { ExerciseConfig, KeyAngle, SpeedPoint } from './types';

export const EXERCISES: ExerciseConfig[] = [squat, goblet, lunge, pushup, bridge, press, plank];

export const exerciseById = (id: string): ExerciseConfig | undefined => EXERCISES.find((e) => e.id === id);

/** Exercises to offer for today's session. Rest days offer nothing. */
export function exercisesForPlan(title: string, intensity: string, swappedToUpper = false): ExerciseConfig[] {
  if (intensity === 'rest') return [];
  if (swappedToUpper || /upper|bench|press|push/i.test(title)) return [pushup, press, plank];
  if (/squat|heavy|lift|clean|snatch/i.test(title)) return [goblet, squat, lunge, plank];
  return [squat, lunge, pushup, bridge, press, plank];
}
