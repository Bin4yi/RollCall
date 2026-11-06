import { BodySynth, type VitalsFrame } from '@rollcall/signals';
import { describe, expect, it } from 'vitest';
import { CheckinSession, framingHint, type CheckinProgress } from '../src';

function run(
  session: CheckinSession,
  seconds: number,
  shape: (frame: VitalsFrame, t: number) => VitalsFrame = (f) => f,
  synth = new BodySynth(3),
): CheckinProgress {
  let progress = session.progress();
  for (let i = 0; i < seconds * 10; i++) {
    const frame = synth.step('sim');
    progress = session.ingest(shape(frame, frame.t / 1000));
  }
  return progress;
}

describe('CheckinSession', () => {
  it('finishes after 75 good seconds with all readings', () => {
    const session = new CheckinSession();
    const p = run(session, 80);
    expect(p.phase).toBe('done');
    const r = session.result();
    expect(r.completed).toBe(true);
    expect(r.pulse?.value).toBeCloseTo(70, 0);
    expect(r.breath?.value).toBeCloseTo(14, 0);
    expect(r.rmssd?.value).toBe(52);
    expect(r.stress?.value).toBe(85);
    expect(r.sdnn).toBeDefined();
    expect(r.meanNn).toBeDefined();
  });

  it('a settle check takes 60 seconds', () => {
    const session = new CheckinSession('settle');
    expect(run(session, 65).phase).toBe('done');
    expect(session.progress().target).toBe(60);
  });

  it('waits for good framing before it starts counting', () => {
    const session = new CheckinSession();
    const bad = (f: VitalsFrame): VitalsFrame => ({
      ...f,
      quality: { ok: false, reason: 'Place more of the chest in view.', code: 7 },
    });
    const p = run(session, 10, bad);
    expect(p.phase).toBe('framing');
    expect(p.seconds).toBe(0);
    expect(p.hint?.text).toMatch(/upper chest/);
    expect(p.hint?.pose).toBe('phone');
  });

  it('pauses for talking, with a grace period, and then carries on', () => {
    const session = new CheckinSession();
    const synth = new BodySynth(3);
    run(session, 20, undefined, synth);
    const before = session.progress().seconds;
    const talking = run(session, 5, (f) => ({ ...f, talking: true }), synth);
    expect(talking.pause).toBe('talking');
    expect(talking.seconds).toBeLessThan(before + 1.5);
    expect(talking.hint?.pose).toBe('shh');
    const after = run(session, 5, undefined, synth);
    expect(after.pause).toBeNull();
    expect(after.seconds).toBeGreaterThan(talking.seconds + 4);
  });

  it('pauses when moving and when the face is lost', () => {
    const synth = new BodySynth(3);
    const session = new CheckinSession();
    run(session, 10, undefined, synth);
    expect(
      run(session, 1, (f) => ({ ...f, quality: { ok: false, code: 12, reason: 'x' } }), synth).pause,
    ).toBe('moving');
    expect(run(session, 1, (f) => ({ ...f, facePresent: false }), synth).pause).toBe('no-face');
  });

  it('starts again from framing when the SDK restarts, keeping no old readings', () => {
    const session = new CheckinSession();
    const synth = new BodySynth(3);
    run(session, 40, undefined, synth);
    expect(session.progress().seconds).toBeGreaterThan(30);
    session.restart();
    expect(session.progress().phase).toBe('framing');
    expect(session.progress().seconds).toBe(0);
    expect(session.result().pulse).toBeUndefined();
    expect(run(session, 80, undefined, synth).phase).toBe('done');
  });

  it('times out instead of running forever', () => {
    const session = new CheckinSession();
    const p = run(session, 185, (f) => ({ ...f, facePresent: false }));
    expect(p.phase).toBe('timed-out');
    expect(session.result().completed).toBe(false);
  });

  it('reports nothing it could not read: low confidence is "not read", never invented', () => {
    const session = new CheckinSession();
    run(session, 80, (f) => ({
      ...f,
      pulse: f.pulse && { ...f.pulse, conf: 0.2 },
      breath: f.breath && { ...f.breath, conf: 0.2 },
      hrv: f.hrv && { ...f.hrv, conf: 0.2 },
    }));
    const r = session.result();
    expect(r.completed).toBe(true);
    expect(r.pulse).toBeUndefined();
    expect(r.breath).toBeUndefined();
    expect(r.rmssd).toBeUndefined();
    expect(r.stress).toBeUndefined();
  });

  it('never reports pulse above the validated range', () => {
    const session = new CheckinSession();
    run(session, 80, (f) => ({ ...f, pulse: { bpm: 135, conf: 0.9 } }));
    const r = session.result();
    expect(r.pulse).toBeUndefined();
    expect(r.pulseOutOfRange).toBe(true);
  });

  it('readings taken while talking do not count', () => {
    const session = new CheckinSession();
    const synth = new BodySynth(4);
    run(session, 50, (f) => ({ ...f, talking: true, pulse: { bpm: 100, conf: 0.9 } }), synth);
    expect(session.result().pulse).toBeUndefined();
  });
});

describe('framingHint', () => {
  it('maps SDK codes to friendly words', () => {
    expect(framingHint(5)?.pose).toBe('lamp');
    expect(framingHint(0)).toBeNull();
    expect(framingHint(undefined)).toBeNull();
  });
  it('falls back to the SDK hint for codes it does not know', () => {
    expect(framingHint(99, 'New hint')?.text).toBe('New hint');
  });
});
