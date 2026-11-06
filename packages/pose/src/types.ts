/** One landmark in MediaPipe's normalised image coordinates. y points down. v is visibility, 0..1. */
export interface Lm {
  x: number;
  y: number;
  v: number;
}

/** One camera frame's pose. Stays on the phone: only numbers derived from it are ever saved. */
export interface PoseFrame {
  /** Milliseconds, from performance.now() live, from the file in replay. */
  t: number;
  /** Image width over height, so x and y can be compared in one unit. */
  aspect: number;
  /** Indexed by MediaPipe landmark id. Undefined when absent. */
  lm: (Lm | undefined)[];
}

/** MediaPipe Pose Landmarker ids. See docs/MEDIAPIPE_NOTES.md. */
export const L = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lFoot: 31,
  rFoot: 32,
} as const;

/** The landmarks Roll Call uses, and the order they're stored in .pose.jsonl files. */
export const BODY: readonly number[] = Object.values(L);

/** Below this a landmark is treated as not seen. It's ignored, never guessed. */
export const VISIBILITY_GATE = 0.5;
