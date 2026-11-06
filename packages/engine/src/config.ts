/** Shape of config/difficulty.json. All tunable numbers live there, not in code. */
export interface EngineConfig {
  tickHz: number;
  confidence: { pulse: number; breath: number };
  noiseWeights: { hr: number; brRate: number; brIrreg: number; motion: number; calm: number };
  noise: {
    hrTau: number;
    brTau: number;
    noiseTau: number;
    motionK: number;
    talkImpulse: number;
    talkHoldSeconds: number;
    talkDecaySeconds: number;
    flinchImpulse: number;
    flinchExpressionJump: number;
    flinchWindowSeconds: number;
    flinchMotionSpike: number;
    flinchDecaySeconds: number;
    breathHoldAmplitude: number;
    breathHoldSeconds: number;
    breathHoldFloor: number;
    faceLostPauseSeconds: number;
    moveNoise: number;
  };
  calibration: {
    minSeconds: number;
    maxSeconds: number;
    minPulseSamples: number;
    minBreathSamples: number;
    defaults: { hr: number; br: number };
  };
  listener: {
    listenSeconds: [number, number];
    patrolLegSeconds: [number, number];
    investigateSeconds: number;
    leaveSeconds: number;
    decisionWindowSeconds: number;
    suspicionDecay: number;
    exposedGainMultiplier: number;
  };
  director: {
    minGapSeconds: number;
    targetGapSeconds: [number, number];
    nearCatchSuspicion: number;
    nearCatchEaseSeconds: number;
    gentleGapMultiplier: number;
    escalationEncounters: number;
    searchSeconds: [number, number];
  };
  finale: {
    requiredBreaths: number;
    belowBaseline: number;
    maxIrregularity: number;
    timeoutSeconds: number;
    approachSeconds: number;
  };
  objectives: {
    tapeSeconds: number;
    fuseSeconds: number;
    moveSeconds: number;
    hideSeconds: number;
  };
  wellbeing: { pulseAboveBaseline: number; sustainedSeconds: number };
  difficulties: Record<DifficultyName, Difficulty>;
}

export type DifficultyName = 'calm' | 'standard' | 'iceCold';

export interface Difficulty {
  alertThreshold: number;
  searchThreshold: number;
  suspicionGain: number;
}
