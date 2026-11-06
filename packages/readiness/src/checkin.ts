import type { VitalsFrame } from '@rollcall/signals';
import { CHECKIN, CONFIDENCE, PULSE_RANGE } from './config';
import { median } from './model';

export type CheckinKind = 'morning' | 'settle';
export type PauseReason = 'talking' | 'moving' | 'framing' | 'no-face' | 'no-signal';

export interface CheckinProgress {
  phase: 'framing' | 'measuring' | 'done' | 'timed-out';
  /** Seconds of good measurement so far, and the target. */
  seconds: number;
  target: number;
  pause: PauseReason | null;
  hint: FramingHint | null;
}

export interface FramingHint {
  /** SDK ValidationCode, or -1 for one of ours. */
  code: number;
  text: string;
  /** Which Rollo illustration fits. */
  pose: 'lamp' | 'phone' | 'still' | 'shh' | 'wave';
}

/**
 * Friendly wording for each SDK ValidationCode (values from the SDK's index.d.ts). Unknown codes use
 * the SDK's own hint, which its docs say is written to be shown as-is.
 */
const HINTS: Record<number, Omit<FramingHint, 'code'>> = {
  1: { text: "I can't see you yet. Face the camera.", pose: 'phone' },
  2: { text: 'Just you in the picture, please.', pose: 'phone' },
  3: { text: 'Move yourself to the middle of the picture.', pose: 'phone' },
  4: { text: 'Prop the phone at arm’s length.', pose: 'phone' },
  5: { text: 'Find some light in front of you.', pose: 'lamp' },
  6: { text: 'A little too bright. Turn away from the window.', pose: 'lamp' },
  7: { text: 'Lean back so your upper chest is in view.', pose: 'phone' },
  10: { text: 'Hold on, the camera is adjusting.', pose: 'still' },
  11: { text: 'More light would help the camera keep up.', pose: 'lamp' },
  12: { text: 'Sit still for me. Nearly there.', pose: 'still' },
  13: { text: 'A little too close. Move the phone back.', pose: 'phone' },
  14: { text: 'A little too far. Move the phone closer.', pose: 'phone' },
  15: { text: 'Tilt the phone up a little.', pose: 'phone' },
  16: { text: 'Tilt the phone down a little, or sit up taller.', pose: 'phone' },
  17: { text: 'Look straight at the phone.', pose: 'phone' },
};

export function framingHint(code: number | undefined, sdkHint?: string): FramingHint | null {
  if (code === undefined || code === 0) return null;
  const known = HINTS[code];
  return known
    ? { code, ...known }
    : { code, text: sdkHint || 'Sit still, facing the camera.', pose: 'phone' };
}

export interface MeasuredValue {
  value: number;
  conf: number;
}

export interface CheckinResult {
  kind: CheckinKind;
  durationSeconds: number;
  /** A metric is absent when it wasn't read with enough confidence. Never invented. */
  pulse?: MeasuredValue;
  breath?: MeasuredValue;
  rmssd?: MeasuredValue;
  sdnn?: MeasuredValue;
  meanNn?: MeasuredValue;
  stress?: MeasuredValue;
  /** Pulse was confidently read but outside the SDK's validated range, so it isn't reported. */
  pulseOutOfRange: boolean;
  completed: boolean;
}

/**
 * The check-in state machine. Feed it every frame; it works out when framing is good, counts only
 * good seconds (pausing politely for talking or moving), and summarises trusted readings at the end.
 * Pure, so replays and tests behave exactly like live sessions.
 */
export class CheckinSession {
  private phase: CheckinProgress['phase'] = 'framing';
  private good = 0;
  private framingOk = 0;
  private wall = 0;
  private talkRun = 0;
  private lastT: number | null = null;
  private pause: PauseReason | null = null;
  private hint: FramingHint | null = null;
  private readonly target: number;
  private readonly pulses: { at: number; bpm: number; conf: number }[] = [];
  private readonly breaths: { at: number; bpm: number; conf: number }[] = [];
  private latestHrv: NonNullable<VitalsFrame['hrv']> | null = null;
  private outOfRange = false;

  constructor(readonly kind: CheckinKind = 'morning') {
    this.target = kind === 'settle' ? CHECKIN.settleSeconds : CHECKIN.morningSeconds;
  }

  /**
   * The SDK restarted, so its measurement windows are gone. Back to framing with a clean slate:
   * every reading must have a full, unbroken window behind it.
   */
  restart(): void {
    if (this.phase === 'done' || this.phase === 'timed-out') return;
    this.phase = 'framing';
    this.good = 0;
    this.framingOk = 0;
    this.talkRun = 0;
    this.pulses.length = 0;
    this.breaths.length = 0;
    this.latestHrv = null;
    this.outOfRange = false;
  }

  ingest(frame: VitalsFrame): CheckinProgress {
    const dt = this.lastT === null ? 0 : Math.max(0, (frame.t - this.lastT) / 1000);
    this.lastT = frame.t;
    this.wall += dt;
    if (this.phase === 'done' || this.phase === 'timed-out') return this.progress();

    this.collect(frame);
    const blocked = this.blockReason(frame, dt);
    this.pause = blocked;
    this.hint =
      blocked === 'talking'
        ? { code: -1, text: 'Just breathe normally. No need to talk.', pose: 'shh' }
        : frame.quality && !frame.quality.ok
          ? framingHint(frame.quality.code, frame.quality.reason)
          : null;

    if (this.phase === 'framing') {
      this.framingOk = blocked ? 0 : this.framingOk + dt;
      if (this.framingOk >= CHECKIN.framingHoldSeconds) this.phase = 'measuring';
    } else if (!blocked) {
      this.good += dt;
      if (this.good >= this.target) this.phase = 'done';
    }
    if (this.phase !== 'done' && this.wall >= CHECKIN.maxWallSeconds) this.phase = 'timed-out';
    return this.progress();
  }

  private blockReason(frame: VitalsFrame, dt: number): PauseReason | null {
    if (frame.facePresent === false) return 'no-face';
    if (frame.quality && !frame.quality.ok) return frame.quality.code === 12 ? 'moving' : 'framing';
    this.talkRun = frame.talking ? this.talkRun + dt : 0;
    if (this.talkRun > CHECKIN.talkGraceSeconds) return 'talking';
    return null;
  }

  private collect(frame: VitalsFrame): void {
    const at = this.wall;
    const trusted = frame.quality?.ok !== false && !frame.talking;
    if (frame.pulse && trusted && frame.pulse.conf >= CONFIDENCE.pulse) {
      const { bpm, conf } = frame.pulse;
      if (bpm >= PULSE_RANGE.min && bpm <= PULSE_RANGE.max) this.pulses.push({ at, bpm, conf });
      else this.outOfRange = true;
    }
    if (frame.breath && trusted && frame.breath.conf >= CONFIDENCE.breath) {
      this.breaths.push({ at, bpm: frame.breath.bpm, conf: frame.breath.conf });
    }
    if (frame.hrv && trusted && frame.hrv.conf >= CONFIDENCE.hrv) this.latestHrv = frame.hrv;
  }

  progress(): CheckinProgress {
    return {
      phase: this.phase,
      seconds: Math.min(this.good, this.target),
      target: this.target,
      pause: this.phase === 'measuring' || this.phase === 'framing' ? this.pause : null,
      hint: this.phase === 'measuring' || this.phase === 'framing' ? this.hint : null,
    };
  }

  result(): CheckinResult {
    const summarise = (
      samples: { at: number; bpm: number; conf: number }[],
    ): MeasuredValue | undefined => {
      const recent = samples.filter((s) => s.at >= this.wall - CHECKIN.summarySeconds);
      if (!recent.length) return undefined;
      return { value: median(recent.map((s) => s.bpm)), conf: median(recent.map((s) => s.conf)) };
    };
    const hrv = this.latestHrv;
    const fromHrv = (value: number | undefined): MeasuredValue | undefined =>
      hrv && value !== undefined ? { value, conf: hrv.conf } : undefined;
    const pulse = summarise(this.pulses);
    return {
      kind: this.kind,
      durationSeconds: Math.round(this.wall),
      pulse,
      breath: summarise(this.breaths),
      rmssd: fromHrv(hrv?.rmssd),
      sdnn: fromHrv(hrv?.sdnn),
      meanNn: fromHrv(hrv?.meanNn),
      stress: fromHrv(hrv?.baevsky),
      pulseOutOfRange: this.outOfRange && !pulse,
      completed: this.phase === 'done',
    };
  }
}
