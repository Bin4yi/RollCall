import type { View } from '../framing';

export type KeyAngle = 'knee' | 'front-knee' | 'hip' | 'elbow' | 'body';
export type SpeedPoint = 'hip' | 'shoulder' | 'wrist';

export interface ExerciseConfig {
  id: string;
  name: string;
  /** How it reads in a sentence: "Turn a bit to the side for squats". */
  plural: string;
  view: View;
  kind: 'reps' | 'hold';
  /** Lying exercises skip the standing-height framing checks. */
  lying: boolean;
  usesLegs: boolean;
  key: KeyAngle;
  /** Key angle at the starting position, and where the rep turns round. */
  start: number;
  turn: number;
  /** Share of start-to-turn needed for a rep to count, so half-reps don't. */
  minRange: number;
  /** Share of start-to-turn that reaches full depth. Between minRange and this, a rep counts with a cue. */
  depth: number;
  /** Lifting phase: 'return' when it's the way back to the start, 'out' when it's the way to the turn. */
  lift: 'return' | 'out';
  speedPoint: SpeedPoint;
  /** Form checks, each optional. Knees caving needs the front view. */
  kneesCaveRatio?: number;
  trunkLeanMax?: number;
  hipSagMin?: number;
  /** Hold exercises: body angle that counts as holding. */
  holdMin?: number;
}
