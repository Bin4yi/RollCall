import type { VitalsFrame } from '@hush/signals';
import { BreathAnalyzer } from './breath';
import type { Baseline } from './calibration';
import type { EngineConfig } from './config';
import { clamp, Ema } from './util';

/** Every term, every tick, for the debug overlay and the After-Action Report. */
export interface NoiseBreakdown {
  hrElev: number;
  brRate: number;
  brIrreg: number;
  calm: number;
  motion: number;
  talkImp: number;
  flinchImp: number;
  holdFloor: number;
  moveImp: number;
  noiseRaw: number;
  noise: number;
  hrEma: number | null;
  brEma: number | null;
  /** Which measurement drove brEma: the fast waveform, or the SDK's 30 s rate as fallback. */
  brSource: 'trace' | 'rate' | 'none';
  signalWeak: boolean;
  weakHint?: string;
  faceLost: boolean;
  /** True once the face has been gone long enough that the Listener must wait. */
  listenerPaused: boolean;
  breatheReminder: boolean;
}

/**
 * Remembers a term's last trusted value. While confidence is low the term may fall but never rise,
 * so bad lighting can never make the player louder.
 */
class Gate {
  private lastTrusted = 0;

  apply(value: number, trusted: boolean): number {
    if (trusted) {
      this.lastTrusted = value;
      return value;
    }
    return Math.min(value, this.lastTrusted);
  }
}

const FACE_LOST_DECAY_PER_S = 0.5;
/** ValidationCode.kExcessiveMotion from the SDK API reference. */
const EXCESSIVE_MOTION = 12;

export class NoiseModel {
  private readonly hrEma: Ema;
  private readonly brEma: Ema;
  private readonly noiseEma: Ema;
  readonly breath = new BreathAnalyzer();
  private readonly gates = {
    hr: new Gate(),
    brRate: new Gate(),
    brIrreg: new Gate(),
    motion: new Gate(),
  };

  private latest: VitalsFrame = { t: 0, source: 'sim' };
  private pendingHead: { t: number; x: number; y: number } | null = null;
  private headVelocity = 0;
  private talkHeld = 0;
  private talkLatched = false;
  private talkImp = 0;
  private flinchImp = 0;
  private moveImp = 0;
  private flatFor = 0;
  private faceLostFor = 0;
  private expressionHistory: { t: number; level: number }[] = [];
  private time = 0;
  private breathTrusted = false;
  private flinchTrigger = false;

  last: NoiseBreakdown;

  constructor(
    private readonly config: EngineConfig,
    private readonly baseline: Baseline,
  ) {
    const n = config.noise;
    this.hrEma = new Ema(n.hrTau);
    this.brEma = new Ema(n.brTau);
    this.noiseEma = new Ema(n.noiseTau);
    this.last = this.compute(0);
  }

  ingest(frame: VitalsFrame): void {
    // Sparse frames omit fields, so merge rather than overwrite (waveforms are consumed below).
    this.latest = { ...this.latest, ...frame };
    const quality = frame.quality?.ok !== false;
    this.breathTrusted = quality && !!frame.breathTrace?.stable;

    if (frame.breathTrace) {
      if (this.breathTrusted) this.breath.push(frame.breathTrace.samples, frame.breathTrace.hz);
      // A dropout must not read as one very long breath when the signal returns.
      else this.breath.reset();
    }

    if (frame.facePresent === false) {
      // Without a face there's no movement evidence; don't let the last speed linger.
      this.pendingHead = null;
      this.headVelocity = 0;
    }
    if (frame.head) {
      const prev = this.pendingHead;
      if (prev && frame.t > prev.t) {
        const dt = (frame.t - prev.t) / 1000;
        this.headVelocity = Math.hypot(frame.head.x - prev.x, frame.head.y - prev.y) / dt;
      }
      this.pendingHead = { t: frame.t, x: frame.head.x, y: frame.head.y };
    }
    if (frame.expression) {
      const level = Math.max(frame.expression.fear ?? 0, frame.expression.surprise ?? 0);
      const window = this.config.noise.flinchWindowSeconds * 1000;
      this.expressionHistory.push({ t: frame.t, level });
      this.expressionHistory = this.expressionHistory.filter((e) => frame.t - e.t <= window);
      const oldest = this.expressionHistory[0]?.level ?? level;
      if (level - oldest >= this.config.noise.flinchExpressionJump) this.flinchTrigger = true;
    }
  }

  /** Small bump when the player walks between rooms. */
  addMoveNoise(): void {
    this.moveImp = this.config.noise.moveNoise;
  }

  tick(dt: number): NoiseBreakdown {
    this.time += dt;
    this.last = this.compute(dt);
    return this.last;
  }

  private compute(dt: number): NoiseBreakdown {
    const f = this.latest;
    const n = this.config.noise;
    const w = this.config.noiseWeights;
    const c = this.config.confidence;
    const base = this.baseline;

    const facePresent = f.facePresent !== false;
    this.faceLostFor = facePresent ? 0 : this.faceLostFor + dt;
    const qualityOk = f.quality?.ok !== false && facePresent;

    // Pulse: slow pressure term. Lag is expected and documented (12 s SDK window).
    const pulseTrusted = qualityOk && !!f.pulse && f.pulse.conf >= c.pulse;
    if (pulseTrusted && f.pulse) this.hrEma.update(f.pulse.bpm, dt);
    const hrEma = this.hrEma.value;
    const hrElevRaw =
      hrEma === null ? 0 : clamp((hrEma - base.hr) / Math.max(8, 0.15 * base.hr), 0, 2);
    const hrElev = this.gates.hr.apply(hrElevRaw, pulseTrusted);

    // Breathing: fast term from waveform peaks; SDK 30 s average only as a fallback.
    const traceRate = this.breathTrusted ? this.breath.rate : null;
    const rateTrusted = qualityOk && !!f.breath && f.breath.conf >= c.breath;
    let brSource: NoiseBreakdown['brSource'] = 'none';
    if (traceRate !== null) {
      this.brEma.update(traceRate, dt);
      brSource = 'trace';
    } else if (rateTrusted && f.breath) {
      this.brEma.update(f.breath.bpm, dt);
      brSource = 'rate';
    }
    const brTrusted = brSource !== 'none';
    const brEma = this.brEma.value;
    const brRateRaw =
      brEma === null ? 0 : clamp((brEma - base.br) / Math.max(3, 0.25 * base.br), 0, 2);
    const brRate = this.gates.brRate.apply(brRateRaw, brTrusted);

    const irregular = this.breath.irregularity;
    const brIrreg = this.gates.brIrreg.apply(
      clamp(irregular / 0.35, 0, 1.5),
      this.breathTrusted && this.breath.intervals.length >= 3,
    );

    // Breath-holding must never pay off. Only trusted flat traces count, so a lost signal never
    // triggers this and the rule can't punish poor lighting.
    const flat =
      (this.breathTrusted &&
        this.breath.buffered >= 4 &&
        this.breath.recentAmplitude < n.breathHoldAmplitude * base.breathAmplitude) ||
      (rateTrusted && f.breath?.apnea === true);

    // Calm bonus: slower than baseline AND regular. Long exhale counts when the SDK provides it.
    // The bonus requires real trusted evidence, so a dead signal can't earn it either.
    const ie = f.breath?.ieRatio;
    const calm =
      !flat &&
      brTrusted &&
      brEma !== null &&
      brEma <= 0.85 * base.br &&
      this.breathTrusted &&
      this.breath.intervals.length >= 2 &&
      brIrreg < 0.43 && // cv < 0.15 expressed in this term's units (0.15 / 0.35)
      (ie === undefined || ie <= 1.1)
        ? 1
        : 0;

    const motionRaw = clamp(this.headVelocity / (base.jitter * n.motionK), 0, 2);
    // Landmarks get jumpy in poor light, so motion needs good quality too. The exception is the
    // SDK itself reporting excessive motion, which is exactly what this term measures.
    const motionTrusted = facePresent && (qualityOk || f.quality?.code === EXCESSIVE_MOTION);
    const motion = this.gates.motion.apply(motionRaw, motionTrusted);

    // Talking: fires once per utterance after being held long enough, then decays.
    if (f.talking && qualityOk) {
      this.talkHeld += dt;
      if (this.talkHeld >= n.talkHoldSeconds && !this.talkLatched) {
        this.talkImp = n.talkImpulse;
        this.talkLatched = true;
      }
    } else {
      this.talkHeld = 0;
      this.talkLatched = false;
    }
    this.talkImp = Math.max(0, this.talkImp - (n.talkImpulse / n.talkDecaySeconds) * dt);

    if ((this.flinchTrigger && qualityOk) || motion >= n.flinchMotionSpike) {
      this.flinchImp = n.flinchImpulse;
    }
    this.flinchTrigger = false;
    this.flinchImp = Math.max(0, this.flinchImp - (n.flinchImpulse / n.flinchDecaySeconds) * dt);
    this.moveImp = Math.max(0, this.moveImp - n.moveNoise * dt);

    this.flatFor = flat ? this.flatFor + dt : 0;
    const holding = this.flatFor > n.breathHoldSeconds;
    const holdFloor = holding ? n.breathHoldFloor : 0;

    const noiseRaw =
      w.hr * hrElev +
      w.brRate * brRate +
      w.brIrreg * brIrreg +
      w.motion * motion +
      this.talkImp +
      this.flinchImp +
      this.moveImp -
      w.calm * calm;

    let target = Math.max(noiseRaw, holdFloor);
    // Hard guard for the core fairness rule. Per-term gates aren't enough on their own: a calm
    // player whose signal drops would lose the calm bonus and get louder.
    const lowTrust = !qualityOk && f.quality?.code !== EXCESSIVE_MOTION;
    if (lowTrust && this.noiseEma.value !== null) target = Math.min(target, this.noiseEma.value);
    // With no face there is no evidence, so noise relaxes rather than holding a stale value.
    const noise = facePresent
      ? clamp(this.noiseEma.update(target, dt), 0, 1.5)
      : clamp(
          this.noiseEma.update(Math.max(0, (this.noiseEma.value ?? 0) - FACE_LOST_DECAY_PER_S), dt),
          0,
          1.5,
        );

    return {
      hrElev,
      brRate,
      brIrreg,
      calm,
      motion,
      talkImp: this.talkImp,
      flinchImp: this.flinchImp,
      holdFloor,
      moveImp: this.moveImp,
      noiseRaw,
      noise,
      hrEma,
      brEma,
      brSource,
      signalWeak: !qualityOk || (!pulseTrusted && !brTrusted && this.time > 1),
      weakHint: f.quality?.ok === false ? f.quality.reason : undefined,
      faceLost: !facePresent,
      listenerPaused: this.faceLostFor > n.faceLostPauseSeconds,
      breatheReminder: holding,
    };
  }
}
