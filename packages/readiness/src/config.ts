/** Every tunable number in the readiness model. */
export const METRICS = ['pulse', 'rmssd', 'stress', 'breath', 'sleep', 'feel'] as const;
export type Metric = (typeof METRICS)[number];

export const READINESS = {
  baselineDays: 14,
  /** Good check-ins needed before an athlete gets a status sun. */
  learningCheckins: 5,
  weights: { pulse: 0.3, rmssd: 0.25, stress: 0.15, breath: 0.15, sleep: 0.1, feel: 0.05 },
  /** MAD floors, in each metric's working units, so a very steady person's z-scores can't explode. */
  madFloor: { pulse: 2, rmssd: 0.08, stress: 12, breath: 1, sleep: 0.5, feel: 0.5 },
  /** A single metric can't dominate beyond this. */
  maxDeviation: 4,
  watch: { combined: 1, single: 2 },
  checkIn: { combined: 2, watchDays: 3 },
  /** Hysteresis: a status holds until the score falls this far below its entry threshold. */
  holdMargin: 0.25,
  /** How far off a metric must be before it's named as a reason. */
  reasonMin: 1,
  maxReasons: 3,
  /** Consecutive days of feel 1/5 before the coach sees the gentle nudge. */
  lowFeelDays: 3,
} as const;

/** Minimum confidence (0..1) for a reading to count. Matches the SDK's documented `stable` gates. */
export const CONFIDENCE = { pulse: 0.4, breath: 0.45, hrv: 0.5 } as const;

/** The SDK's documented validated range for pulse. Anything outside is "not read today". */
export const PULSE_RANGE = { min: 40, max: 110 } as const;

export const CHECKIN = {
  morningSeconds: 75,
  settleSeconds: 60,
  /** Give up politely if conditions never settle. */
  maxWallSeconds: 180,
  /** Talking this briefly doesn't pause anything. */
  talkGraceSeconds: 1,
  /** Measurement summary uses this many most recent seconds. */
  summarySeconds: 30,
  /** Framing must hold this long before the check-in starts. */
  framingHoldSeconds: 2,
} as const;
