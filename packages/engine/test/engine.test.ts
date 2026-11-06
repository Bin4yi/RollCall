import { describe, expect, it } from 'vitest';
import {
  AcousticLock,
  autopilot,
  BreathAnalyzer,
  Calibration,
  Director,
  Ema,
  Listener,
  NoiseModel,
  Run,
  type Baseline,
  type EngineConfig,
  type ListenerContext,
  type NoiseBreakdown,
} from '../src';
import { config, DT, liveSynth, synthFrames } from './helpers';
import type { VitalsFrame } from '@hush/signals';

const baseline: Baseline = { hr: 70, br: 14, breathAmplitude: 2, jitter: 0.02, measured: true };

function drive(
  frames: VitalsFrame[],
  base = baseline,
): { model: NoiseModel; trail: NoiseBreakdown[] } {
  const model = new NoiseModel(config, base);
  const trail: NoiseBreakdown[] = [];
  for (const f of frames) {
    model.ingest(f);
    trail.push(model.tick(DT));
  }
  return { model, trail };
}
const warm = (extra: number) => 32 + extra;
const after = <T>(trail: T[], seconds: number) => trail.slice(seconds * 10);
const max = (xs: number[]) => Math.max(...xs);

describe('Ema', () => {
  it('moves 63% of the way in one time constant, at any tick rate', () => {
    for (const dt of [0.01, 0.1, 0.5]) {
      const e = new Ema(2);
      e.update(0, dt);
      let v = 0;
      for (let i = 0; i < 2 / dt; i++) v = e.update(1, dt);
      expect(v).toBeCloseTo(0.632, 1);
    }
  });
});

describe('BreathAnalyzer', () => {
  const wave = (bpm: number, seconds: number, hz = 30) =>
    Array.from({ length: seconds * hz }, (_, i) => Math.sin((2 * Math.PI * bpm * i) / hz / 60));

  it.each([6, 12, 14, 30])('recovers %i breaths/min from the waveform', (bpm) => {
    const a = new BreathAnalyzer();
    a.push(wave(bpm, 60), 30);
    expect(a.rate).toBeCloseTo(bpm, 0);
    expect(a.irregularity).toBeLessThan(0.05);
  });

  it('reacts to a change within a few breaths, unlike the 30 s SDK average', () => {
    const a = new BreathAnalyzer();
    a.push(wave(20, 30), 30);
    expect(a.rate).toBeGreaterThan(17);
    a.push(wave(7, 22), 30);
    expect(a.rate).toBeLessThan(10);
  });

  it('detects uneven breathing', () => {
    const a = new BreathAnalyzer();
    let phase = 0;
    const samples: number[] = [];
    for (const bpm of [10, 25, 9, 30, 11, 24, 10]) {
      const breathSamples = Math.round((60 / bpm) * 30);
      for (let i = 0; i < breathSamples; i++) {
        phase += (2 * Math.PI) / breathSamples;
        samples.push(Math.sin(phase));
      }
    }
    a.push(samples, 30);
    expect(a.irregularity).toBeGreaterThan(0.2);
  });

  it('forgets everything on reset, so a gap is not one long breath', () => {
    const a = new BreathAnalyzer();
    a.push(wave(14, 20), 30);
    a.reset();
    expect(a.rate).toBeNull();
    expect(a.intervals).toHaveLength(0);
  });
});

describe('Calibration', () => {
  it('builds the baseline from confident samples only', () => {
    const c = new Calibration(config);
    const frames = synthFrames(40, (b) => {
      b.pulseBpm = 64;
      b.breathBpm = 12;
    });
    expect(c.phase).toBe('waiting');
    for (const f of frames) {
      c.ingest(f);
      c.tick(DT);
      if (c.phase === 'done') break;
    }
    expect(c.phase).toBe('done');
    expect(c.baseline?.measured).toBe(true);
    expect(c.baseline?.hr).toBeGreaterThan(62);
    expect(c.baseline?.hr).toBeLessThan(70);
    expect(c.baseline?.breathAmplitude).toBeGreaterThan(1);
  });

  it('never traps the player when the light is bad: falls back to defaults', () => {
    const c = new Calibration(config);
    const frames = synthFrames(80, (b) => {
      b.signalQuality = 0.1;
      b.qualityReason = 'Too dark';
    });
    for (const f of frames) {
      c.ingest(f);
      c.tick(DT);
    }
    expect(c.signalWeak).toBe(true);
    expect(c.hint).toBe('Too dark');
    expect(c.baseline).toMatchObject({ hr: 72, br: 14, measured: false });
  });
});

describe('NoiseModel terms', () => {
  it('stays quiet at rest', () => {
    const { trail } = drive(synthFrames(warm(30)));
    expect(max(after(trail, warm(5)).map((t) => t.noise))).toBeLessThan(0.3);
  });

  it('hrElev rises with pulse, slowly', () => {
    const { trail } = drive(
      synthFrames(warm(30), (b, s) => {
        b.pulseBpm = s > 32 ? 95 : 70;
      }),
    );
    expect(trail[33 * 10]!.hrElev).toBeLessThan(0.3);
    expect(trail.at(-1)!.hrElev).toBeGreaterThan(1.5);
    expect(trail.at(-1)!.noise).toBeGreaterThan(0.5);
  });

  it('brRate uses the fast waveform: reacts well inside an encounter', () => {
    const { trail } = drive(
      synthFrames(warm(16), (b, s) => {
        b.breathBpm = s > 32 ? 28 : 14;
      }),
    );
    expect(trail.at(-1)!.brSource).toBe('trace');
    expect(trail.at(-1)!.brRate).toBeGreaterThan(1);
  });

  it('falls back to the SDK rate when no waveform is available', () => {
    const frames = synthFrames(warm(5)).map(({ breathTrace: _drop, ...f }) => f);
    const { trail } = drive(frames);
    expect(trail.at(-1)!.brSource).toBe('rate');
  });

  it('brIrreg rises for uneven breathing', () => {
    const { trail } = drive(
      synthFrames(warm(40), (b) => {
        b.breathJitter = 0.5;
      }),
    );
    expect(max(after(trail, warm(15)).map((t) => t.brIrreg))).toBeGreaterThan(0.3);
  });

  it('calm bonus requires slow, regular breathing', () => {
    const slow = drive(
      synthFrames(warm(35), (b, s) => {
        b.breathBpm = s > 32 ? 7 : 14;
      }),
    ).trail;
    expect(slow.at(-1)!.calm).toBe(1);
    const normal = drive(synthFrames(warm(35))).trail;
    expect(normal.at(-1)!.calm).toBe(0);
  });

  it('motion rises with head movement', () => {
    const { trail } = drive(
      synthFrames(warm(5), (b, s) => {
        b.headMotion = s > 32 ? 0.05 : 0.002;
      }),
    );
    expect(trail.at(-1)!.motion).toBeGreaterThan(1);
  });

  it('talking fires once after being held, then decays', () => {
    const { trail } = drive(
      synthFrames(warm(6), (b, s) => {
        b.talking = s >= 32 && s < 33;
      }),
    );
    expect(trail[32 * 10 + 1]!.talkImp).toBe(0);
    expect(max(trail.map((t) => t.talkImp))).toBeGreaterThan(0.4);
    expect(trail.at(-1)!.talkImp).toBe(0);
  });

  it('a very short sound does not count as talking', () => {
    const { trail } = drive(
      synthFrames(warm(3), (b, s) => {
        b.talking = s >= 32 && s < 32.2;
      }),
    );
    expect(max(trail.map((t) => t.talkImp))).toBe(0);
  });

  it('flinch fires on a sudden fear jump', () => {
    const { trail } = drive(
      synthFrames(warm(4), (b, s) => {
        b.fear = s >= 32 && s < 32.4 ? 0.8 : 0;
      }),
    );
    expect(max(trail.map((t) => t.flinchImp))).toBeGreaterThan(0.3);
  });

  it('a slowly building expression does not count as a flinch', () => {
    const { trail } = drive(
      synthFrames(warm(10), (b, s) => {
        b.fear = s > 32 ? Math.min(0.8, (s - 32) * 0.1) : 0;
      }),
    );
    expect(max(trail.map((t) => t.flinchImp))).toBe(0);
  });

  it('is deterministic', () => {
    const run = () => drive(synthFrames(warm(10))).trail.map((t) => t.noise);
    expect(run()).toEqual(run());
  });
});

describe('Fairness rules', () => {
  const bad = (b: { signalQuality: number; qualityReason?: string }) => {
    b.signalQuality = 0.15;
    b.qualityReason = 'Too dark';
  };

  it('low confidence never increases noise, even with terrible readings behind it', () => {
    const frames = synthFrames(warm(40), (b, s) => {
      if (s > 40) {
        bad(b);
        b.pulseBpm = 150;
        b.breathBpm = 35;
        b.breathJitter = 0.5;
        b.headMotion = 0.05;
        b.talking = true;
        b.fear = s % 2 > 1 ? 0.9 : 0;
      }
    });
    const { trail } = drive(frames);
    const before = trail[40 * 10]!.noise;
    const during = after(trail, 41).map((t) => t.noise);
    expect(max(during)).toBeLessThanOrEqual(before + 1e-9);
    expect(trail.at(-1)!.signalWeak).toBe(true);
    expect(trail.at(-1)!.weakHint).toBe('Too dark');
  });

  it('losing the face: noise relaxes and the Listener pauses after 3 s', () => {
    const { trail } = drive(
      synthFrames(warm(10), (b, s) => {
        if (s > 34) b.facePresent = false;
      }),
    );
    expect(trail[34 * 10 + 20]!.listenerPaused).toBe(false);
    expect(trail.at(-1)!.listenerPaused).toBe(true);
    expect(trail.at(-1)!.noise).toBeLessThan(0.05);
  });

  it('breath-holding raises the noise floor and is never better than slow breathing', () => {
    const hold = drive(
      synthFrames(warm(30), (b, s) => {
        if (s > 34) b.breathAmplitude = 0.01;
      }),
    ).trail;
    const slow = drive(
      synthFrames(warm(30), (b, s) => {
        if (s > 34) b.breathBpm = 7;
      }),
    ).trail;
    const end = hold.at(-1)!;
    expect(end.breatheReminder).toBe(true);
    expect(end.holdFloor).toBeGreaterThan(0);
    expect(end.calm).toBe(0);
    expect(end.noise).toBeGreaterThan(slow.at(-1)!.noise);
  });

  it('the SDK apnea flag also triggers the reminder', () => {
    const frames = synthFrames(warm(20)).map((f) =>
      f.breath ? { ...f, breath: { ...f.breath, apnea: f.t > 34_000 } } : f,
    );
    expect(drive(frames).trail.at(-1)!.breatheReminder).toBe(true);
  });

  it('a lost signal is never mistaken for breath-holding', () => {
    const { trail } = drive(
      synthFrames(warm(30), (b, s) => {
        if (s > 34) {
          bad(b);
          b.breathAmplitude = 0.01;
        }
      }),
    );
    expect(trail.at(-1)!.breatheReminder).toBe(false);
    expect(trail.at(-1)!.holdFloor).toBe(0);
  });

  it('a calm player losing their signal does not get louder', () => {
    const { trail } = drive(
      synthFrames(warm(50), (b, s) => {
        b.breathBpm = s > 32 ? 7 : 14;
        if (s > 60) bad(b);
      }),
    );
    expect(trail[60 * 10]!.calm).toBe(1);
    const before = trail[60 * 10]!.noise;
    expect(max(after(trail, 61).map((t) => t.noise))).toBeLessThanOrEqual(before + 1e-9);
  });

  it('SDK-reported excessive motion still counts despite failing quality', () => {
    const frames = synthFrames(warm(5), (b, s) => {
      b.headMotion = s > 32 ? 0.05 : 0.002;
    }).map((f) =>
      f.t > 32_000 ? { ...f, quality: { ok: false, code: 12, reason: 'Hold still' } } : f,
    );
    expect(drive(frames).trail.at(-1)!.motion).toBeGreaterThan(1);
    expect(drive(frames).trail.at(-1)!.noise).toBeGreaterThan(0.2);
  });

  it('a dead signal cannot earn the calm bonus', () => {
    const { trail } = drive(
      synthFrames(warm(30), (b, s) => {
        if (s > 34) {
          bad(b);
          b.breathBpm = 6;
        }
      }),
    );
    expect(trail.at(-1)!.calm).toBe(0);
  });
});

const ctx = (over: Partial<ListenerContext> = {}): ListenerContext => ({
  dt: DT,
  noise: 0,
  playerRoom: 'desk',
  playerHidden: true,
  paused: false,
  searchThreshold: 0.5,
  alertThreshold: 0.45,
  suspicionGain: 0.4,
  mayEngage: false,
  mustEngage: false,
  searchSeconds: 20,
  gainMultiplier: 1,
  ...over,
});
function until(l: Listener, c: ListenerContext, state: string, seconds = 120) {
  const events = [];
  for (let i = 0; i < seconds * 10 && l.state !== state; i++) events.push(...l.tick(c));
  return events;
}

describe('Listener FSM', () => {
  it('stays dormant until woken', () => {
    const l = new Listener(config, 1);
    expect(l.tick(ctx({ noise: 2, mustEngage: true }))).toEqual([]);
    expect(l.state).toBe('DORMANT');
  });

  it('patrols and listens, and goes back to patrol when quiet', () => {
    const l = new Listener(config, 1);
    l.wake();
    expect(l.state).toBe('PATROL');
    until(l, ctx(), 'LISTEN');
    until(l, ctx(), 'PATROL');
    expect(l.state).toBe('PATROL');
  });

  it('investigates when it hears noise, only if the Director allows', () => {
    const quiet = new Listener(config, 1);
    quiet.wake();
    until(quiet, ctx({ noise: 1 }), 'LISTEN');
    until(quiet, ctx({ noise: 1, mayEngage: false }), 'PATROL', 20);
    expect(quiet.state).toBe('PATROL');

    const l = new Listener(config, 1);
    l.wake();
    until(l, ctx({ noise: 1 }), 'LISTEN');
    until(l, ctx({ noise: 1, mayEngage: true }), 'INVESTIGATE', 20);
    expect(l.state).toBe('INVESTIGATE');
  });

  it('the Director can force an investigation', () => {
    const l = new Listener(config, 1);
    l.wake();
    until(l, ctx(), 'LISTEN');
    until(l, ctx({ mustEngage: true }), 'INVESTIGATE', 20);
    expect(l.state).toBe('INVESTIGATE');
  });

  const toSearch = (noise = 0) => {
    const l = new Listener(config, 2);
    l.wake();
    until(l, ctx({ mustEngage: true }), 'SEARCH');
    expect(l.state).toBe('SEARCH');
    return { l, c: ctx({ noise }) };
  };

  it('survive: quiet player outlasts the timer', () => {
    const { l, c } = toSearch();
    const events = until(l, c, 'LEAVE');
    expect(events.at(-1)?.kind).toBe('encounter_survived');
    until(l, c, 'PATROL');
    expect(l.state).toBe('PATROL');
  });

  it('caught: suspicion reaches 1 under sustained noise, leaning in first', () => {
    const { l, c } = toSearch(1.3);
    const events = until(l, c, 'LEAVE');
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('leaned_in');
    expect(kinds.at(-1)).toBe('caught');
    expect(kinds.indexOf('leaned_in')).toBeLessThan(kinds.indexOf('caught'));
  });

  it('suspicion decays once the player quietens', () => {
    const { l } = toSearch();
    for (let i = 0; i < 30; i++) l.tick(ctx({ noise: 1 }));
    const peak = l.suspicion;
    expect(peak).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) l.tick(ctx({ noise: 0 }));
    expect(l.suspicion).toBeLessThan(peak);
    expect(l.peakSuspicion).toBe(peak);
  });

  it('being in the open raises suspicion faster', () => {
    const hidden = toSearch().l;
    const open = toSearch().l;
    for (let i = 0; i < 30; i++) {
      hidden.tick(ctx({ noise: 1, playerHidden: true }));
      open.tick(ctx({ noise: 1, playerHidden: false }));
    }
    expect(open.suspicion).toBeGreaterThan(hidden.suspicion * 1.5);
  });

  it('pauses everything when told to', () => {
    const { l } = toSearch();
    const timer = l.timer;
    for (let i = 0; i < 50; i++) l.tick(ctx({ noise: 2, paused: true }));
    expect(l.timer).toBe(timer);
    expect(l.suspicion).toBe(0);
  });

  it('searches an empty room if the player slips away after making noise', () => {
    const l = new Listener(config, 2);
    l.wake();
    until(l, ctx({ noise: 1, mayEngage: true }), 'INVESTIGATE');
    const events = until(l, ctx({ playerRoom: 'archive' }), 'LEAVE');
    expect(events.map((e) => e.kind)).toContain('searched_empty');
  });

  it('a Director visit follows the player', () => {
    const l = new Listener(config, 2);
    l.wake();
    until(l, ctx({ mustEngage: true }), 'INVESTIGATE');
    until(l, ctx({ playerRoom: 'archive' }), 'SEARCH', 15);
    expect(l.state).toBe('SEARCH');
    expect(l.room).toBe('archive');
  });

  it('is deterministic for a seed', () => {
    const trace = (seed: number) => {
      const l = new Listener(config, seed);
      l.wake();
      const out: string[] = [];
      for (let i = 0; i < 2000; i++) out.push(l.state + l.room);
      for (let i = 0; i < 2000; i++) {
        l.tick(ctx({ mustEngage: i % 500 === 0 }));
        out.push(l.state + l.room);
      }
      return out.join();
    };
    expect(trace(5)).toBe(trace(5));
    expect(trace(5)).not.toBe(trace(6));
  });
});

describe('Director', () => {
  const pass = (d: Director, seconds: number) => {
    for (let i = 0; i < seconds * 10; i++) d.tick(DT);
  };

  it('holds encounters at least 45 s apart and comes by 150 s', () => {
    for (let seed = 0; seed < 20; seed++) {
      const d = new Director(config, seed, false);
      pass(d, 44);
      expect(d.mayEngage).toBe(false);
      expect(d.mustEngage).toBe(false);
      pass(d, 2);
      expect(d.mayEngage).toBe(true);
      pass(d, 105);
      expect(d.mustEngage).toBe(true);
    }
  });

  it('never stacks: an engaged Listener blocks another', () => {
    const d = new Director(config, 1, false);
    pass(d, 200);
    d.onEngaged();
    expect(d.mayEngage).toBe(false);
    expect(d.mustEngage).toBe(false);
  });

  it('eases off after a near-catch', () => {
    const d = new Director(config, 1, false);
    d.onFinished(0.9, true);
    pass(d, 50);
    expect(d.mayEngage).toBe(false);
    pass(d, 40);
    expect(d.mayEngage).toBe(true);
  });

  it('escalates gently with encounters survived', () => {
    const d = new Director(config, 1, false);
    const [start, gain] = [d.searchSeconds, d.gainMultiplier];
    expect(start).toBe(20);
    for (let i = 0; i < 6; i++) d.onFinished(0, true);
    expect(d.searchSeconds).toBe(35);
    expect(d.gainMultiplier).toBeGreaterThan(gain);
    expect(d.intensity).toBe(1);
  });

  it('an empty-room search does not count as an encounter', () => {
    const d = new Director(config, 1, false);
    d.onFinished(0, false);
    expect(d.encountersFinished).toBe(0);
  });

  it('Gentle Mode lengthens all gaps', () => {
    const d = new Director(config, 1, true);
    pass(d, 60);
    expect(d.mayEngage).toBe(false);
    pass(d, 10);
    expect(d.mayEngage).toBe(true);
  });
});

describe('AcousticLock', () => {
  const breathe = (a: BreathAnalyzer, lock: AcousticLock, bpm: number, seconds: number) => {
    for (let i = 0; i < seconds * 10; i++) {
      const samples = Array.from({ length: 3 }, (_, j) =>
        Math.sin((2 * Math.PI * bpm * (clock + j / 30)) / 60),
      );
      clock += 0.1;
      a.push(samples, 30);
      lock.update();
    }
  };
  let clock = 0;

  it('opens on three slow regular breaths', () => {
    const a = new BreathAnalyzer();
    const lock = new AcousticLock(config, a, 14);
    breathe(a, lock, 7, 45);
    expect(lock.open).toBe(true);
  });

  it('stays shut at resting rate', () => {
    const a = new BreathAnalyzer();
    const lock = new AcousticLock(config, a, 14);
    breathe(a, lock, 14, 60);
    expect(lock.open).toBe(false);
    expect(lock.streak).toBe(0);
  });

  it('holding your breath cannot open it', () => {
    const a = new BreathAnalyzer();
    const lock = new AcousticLock(config, a, 14);
    breathe(a, lock, 14, 10);
    for (let i = 0; i < 600; i++) {
      a.push([0, 0, 0], 30);
      lock.update();
    }
    expect(lock.open).toBe(false);
  });

  it('a fast breath breaks the streak', () => {
    const a = new BreathAnalyzer();
    const lock = new AcousticLock(config, a, 14);
    breathe(a, lock, 7, 22);
    const had = lock.streak;
    expect(had).toBeGreaterThan(0);
    breathe(a, lock, 22, 12);
    expect(lock.streak).toBe(0);
  });
});

describe('Run', () => {
  const tickFrames = (run: Run, frames: VitalsFrame[], act = false) => {
    for (const f of frames) {
      run.ingest(f);
      if (act) autopilot(run);
      run.tick(DT);
      if (run.finished) break;
    }
  };
  const start = (seed = 1) => {
    const run = new Run(config, { difficulty: 'standard', seed });
    tickFrames(run, synthFrames(40));
    expect(run.phase).toBe('playing');
    return run;
  };

  it('moves through calibration into play', () => {
    const run = start();
    expect(run.toLog().events[0]?.event).toEqual({ kind: 'calibrated', measured: true });
    expect(run.listener.state).not.toBe('DORMANT');
  });

  it('enforces the objective order', () => {
    const run = start();
    expect(run.startFinale()).toBe(false);
    expect(run.installFuse()).toBe(false);
    expect(run.startTape()).toBe(false); // desk has no tape
    expect(run.startFuse()).toBe(false);
    expect(run.hide()).toBe(true);
    expect(run.move('desk')).toBe(false); // already here
  });

  it('hiding keeps task progress, so it can be resumed', () => {
    const run = start();
    run.tapes.clear();
    (run as unknown as { playerRoom: string }).playerRoom = 'control';
    expect(run.startTape()).toBe(true);
    const frames = synthFrames(10);
    for (const f of frames) {
      run.ingest(f);
      run.tick(DT);
    }
    const left = run.task!.left;
    expect(left).toBeLessThan(run.task!.total);
    run.hide();
    expect(run.task).toBeNull();
    for (let i = 0; i < 20; i++) run.tick(DT);
    run.unhide();
    run.startTape();
    expect(run.task!.left).toBeCloseTo(left, 5);
  });

  it('pressing hide repeatedly does not delay getting into cover', () => {
    const run = start();
    expect(run.hide()).toBe(true);
    expect(run.hide()).toBe(false);
    for (let i = 0; i < 15 && !run.hidden; i++) {
      run.hide();
      run.tick(DT);
    }
    expect(run.hidden).toBe(true);
  });

  it('the autopilot is in cover when the Listener arrives', () => {
    const run = new Run(config, { difficulty: 'standard', seed: 2 });
    const next = liveSynth(() => {}, 2);
    const hiddenAtStart: boolean[] = [];
    for (let i = 0; i < 4000 && !run.finished; i++) {
      run.ingest(next());
      autopilot(run);
      for (const e of run.tick(DT))
        if (e.kind === 'encounter_start') hiddenAtStart.push(run.hidden);
    }
    expect(hiddenAtStart.length).toBeGreaterThan(0);
    expect(hiddenAtStart.every(Boolean)).toBe(true);
  });

  it('cannot move during an encounter', () => {
    const run = start();
    run.listener.forceSearch('desk', 20);
    expect(run.inEncounter).toBe(true);
    expect(run.move('corridor')).toBe(false);
    expect(run.hide()).toBe(false);
    expect(run.canAct).toBe(false);
  });

  it('offers a neutral break when pulse stays far above baseline', () => {
    // Out-of-reach thresholds isolate the wellbeing rule from the Listener.
    const quiet: EngineConfig = {
      ...config,
      difficulties: {
        ...config.difficulties,
        standard: { alertThreshold: 9, searchThreshold: 9, suspicionGain: 0 },
      },
    };
    const run = new Run(quiet, { difficulty: 'standard', seed: 1 });
    const next = liveSynth((b, s) => {
      b.pulseBpm = s > 40 ? 130 : 70;
    });
    const kinds: string[] = [];
    for (let i = 0; i < 1400; i++) {
      run.ingest(next());
      kinds.push(...run.tick(DT).map((e) => e.kind));
    }
    expect(kinds.filter((k) => k === 'offer_break')).toHaveLength(1);
    run.acknowledgeBreak();
    for (let i = 0; i < 800; i++) {
      run.ingest(next());
      kinds.push(...run.tick(DT).map((e) => e.kind));
    }
    expect(kinds.filter((k) => k === 'offer_break')).toHaveLength(2);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('a calm player escapes in 8�12 minutes (seed %i)', (seed) => {
    const run = new Run(config, { difficulty: 'standard', seed });
    // Rest, then breathe slowly once at the blast door.
    const next = liveSynth((b) => {
      b.breathBpm = run.phase === 'finale' ? 7 : 14;
    }, seed);
    for (let i = 0; i < 9000 && !run.finished; i++) {
      run.ingest(next());
      autopilot(run);
      run.tick(DT);
    }
    expect(run.phase).toBe('escaped');
    expect(run.time / 60).toBeGreaterThanOrEqual(8);
    expect(run.time / 60).toBeLessThanOrEqual(12);
    const encounters = run.toLog().events.filter((e) => e.event.kind === 'encounter_start');
    expect(encounters.length).toBeGreaterThanOrEqual(2);
  });

  it('whole runs are reproducible for a seed', () => {
    const play = () => {
      const run = new Run(config, { difficulty: 'standard', seed: 9 });
      tickFrames(run, synthFrames(300), true);
      return JSON.stringify(run.toLog());
    };
    expect(play()).toBe(play());
  });

  it('a persistently loud player gets caught', () => {
    const run = new Run(config, { difficulty: 'standard', seed: 4 });
    const frames = synthFrames(900, (b, s) => {
      if (s > 45) {
        b.pulseBpm = 120;
        b.breathBpm = 32;
        b.breathJitter = 0.4;
        b.headMotion = 0.03;
      }
    });
    tickFrames(run, frames, true);
    expect(run.phase).toBe('caught');
  });

  it('bad lighting for a whole run never gets a still player caught', () => {
    const run = new Run(config, { difficulty: 'iceCold', seed: 5 });
    const frames = synthFrames(600, (b) => {
      b.signalQuality = 0.15;
      b.qualityReason = 'Too dark';
    });
    tickFrames(run, frames, true);
    expect(run.phase).not.toBe('caught');
  });
});
