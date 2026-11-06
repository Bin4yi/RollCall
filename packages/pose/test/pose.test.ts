import { describe, expect, it } from 'vitest';
import {
  BalanceTest,
  EXERCISES,
  exerciseById,
  exercisesForPlan,
  framingHint,
  frameError,
  HoldTimer,
  JumpDetector,
  LegsCheck,
  OneEuro,
  parsePoseJsonl,
  PoseReplay,
  PoseSmoother,
  RepCounter,
  simBadFraming,
  simBalance,
  simJumps,
  simPlank,
  simReps,
  toPoseJsonl,
  type JumpResult,
  type PoseFrame,
} from '../src';

const run = (frames: PoseFrame[]) => {
  const d = new JumpDetector();
  const smooth = new PoseSmoother();
  const out: JumpResult[] = [];
  for (const f of frames) {
    const j = d.push(smooth.next(f));
    if (j) out.push(j);
  }
  return out;
};

describe('One Euro filter', () => {
  it('reduces jitter when still and follows a fast move', () => {
    const f = new OneEuro();
    let spread = 0;
    for (let i = 0; i < 60; i++) {
      const out = f.next(0.5 + (i % 2 ? 0.002 : -0.002), i * 33);
      if (i > 20) spread = Math.max(spread, Math.abs(out - 0.5));
    }
    expect(spread).toBeLessThan(0.0015);
    let v = 0;
    for (let i = 60; i < 70; i++) v = f.next(0.9, i * 33);
    expect(v).toBeGreaterThan(0.85);
  });
});

describe('jump detection', () => {
  it('reads height from flight time, at 30 and 60 fps', () => {
    for (const fps of [30, 60]) {
      const [j] = run(simJumps('t', [{ flightS: 0.54 }], { fps }).frames);
      expect(j?.valid).toBe(true);
      expect(Math.abs(j!.heightM - 0.3576) / 0.3576).toBeLessThan(0.2);
      expect(j!.fps).toBeGreaterThan(fps * 0.9);
    }
  });

  it('a longer flight reads higher', () => {
    const [a] = run(simJumps('t', [{ flightS: 0.5 }]).frames);
    const [b] = run(simJumps('t', [{ flightS: 0.56 }]).frames);
    expect(b!.heightM).toBeGreaterThan(a!.heightM);
  });

  it('rejects tucked landings', () => {
    const [j] = run(simJumps('t', [{ flightS: 0.68, hipRiseM: 0.2, tucked: true }]).frames);
    expect(j?.valid).toBe(false);
    expect(j?.problem).toBe('knees-tucked');
  });

  it('rejects hands leaving the hips', () => {
    const [j] = run(simJumps('t', [{ flightS: 0.54, handsOut: true }]).frames);
    expect(j?.problem).toBe('hands-off-hips');
  });

  it('flags a jump where hip rise and flight time disagree', () => {
    const [j] = run(simJumps('t', [{ flightS: 0.6, hipRiseM: 0.1 }]).frames);
    expect(j?.problem).toBe('methods-disagree');
  });

  it('never accepts a jump whose feet left the picture', () => {
    const jumps = run(simJumps('t', [{ flightS: 0.54, feetCutOff: true }]).frames);
    expect(jumps.every((j) => !j.valid)).toBe(true);
  });

  it('does not see jumps in standing still', () => {
    expect(run(simJumps('t', [], { rest: 0 }).frames)).toEqual([]);
    expect(run(simBadFraming('t', 3).frames)).toEqual([]);
  });

  it('frame-rate error is about 15% at 30 fps, as documented', () => {
    expect(frameError(30, 0.45)).toBeCloseTo(0.148, 2);
    expect(frameError(60, 0.45)).toBeCloseTo(0.074, 2);
  });
});

describe('LegsCheck', () => {
  const feed = (check: LegsCheck, frames: PoseFrame[]) => {
    const s = new PoseSmoother();
    for (const f of frames) check.push(s.next(f));
  };

  it('takes the best of three valid jumps and stores them all', () => {
    const check = new LegsCheck();
    feed(check, simJumps('t', [{ flightS: 0.5 }, { flightS: 0.54 }, { flightS: 0.52 }]).frames);
    expect(check.done).toBe(true);
    expect(check.jumps).toHaveLength(3);
    expect(check.best!.heightM).toBe(Math.max(...check.jumps.map((j) => j.heightM)));
  });

  it('asks for more after a rejected jump, and never counts it', () => {
    const check = new LegsCheck();
    feed(check, simJumps('t', [{ flightS: 0.68, hipRiseM: 0.2, tucked: true }, { flightS: 0.5 }]).frames);
    expect(check.jumps).toHaveLength(2);
    expect(check.valid).toHaveLength(1);
    expect(check.done).toBe(false);
  });

  it('gives up after six attempts rather than running forever', () => {
    const check = new LegsCheck();
    feed(check, simJumps('t', Array.from({ length: 7 }, () => ({ flightS: 0.54, handsOut: true }))).frames);
    expect(check.jumps).toHaveLength(6);
    expect(check.done).toBe(true);
    expect(check.best).toBeNull();
  });
});

describe('balance test', () => {
  it('measures more sway for a wobblier stand', () => {
    const score = (sway: number) => {
      const b = new BalanceTest('left');
      for (const f of simBalance('t', 21, sway).frames) b.push(f);
      expect(b.done).toBe(true);
      return b.result();
    };
    expect(score(0.02).swayPct).toBeGreaterThan(score(0.002).swayPct);
    expect(score(0.002).seconds).toBeGreaterThanOrEqual(20);
  });
});

const count = (id: string, frames: PoseFrame[], drop?: number) => {
  const c = new RepCounter(exerciseById(id)!, drop);
  const s = new PoseSmoother();
  for (const f of frames) c.push(s.next(f));
  return c;
};
const even = (n: number) => Array.from({ length: n }, () => 0.8);

describe('rep counting', () => {
  it.each([
    ['squat', 'squat'],
    ['goblet', 'squat'],
    ['lunge', 'lunge'],
    ['pushup', 'pushup'],
    ['bridge', 'bridge'],
    ['press', 'press'],
  ] as const)('%s counts every rep', (id, kind) => {
    const c = count(id, simReps('t', kind, { lift: even(6) }).frames);
    expect(c.reps).toHaveLength(6);
    expect(c.stopSuggested).toBe(false);
    expect(c.summary().speedDrop).toBeLessThan(0.15);
    expect(c.reps.every((r) => r.speed > 0)).toBe(true);
  });

  it('half-reps do not count', () => {
    const c = count('squat', simReps('t', 'squat', { lift: even(3), turnAngle: 150 }).frames);
    expect(c.reps).toHaveLength(0);
    expect(c.partials).toBe(3);
  });

  it('shallow reps count with a gentle depth cue', () => {
    const c = count('squat', simReps('t', 'squat', { lift: even(3), turnAngle: 118 }).frames);
    expect(c.reps).toHaveLength(3);
    expect(c.reps[0]!.flags).toContain('depth');
  });

  it('suggests ending the set when rep speed falls past the threshold', () => {
    const c = count('squat', simReps('t', 'squat', { lift: [0.7, 0.7, 0.75, 0.85, 1.0, 1.2] }).frames);
    expect(c.stopSuggested).toBe(true);
    expect(c.stopSuggestedAt).toBeLessThanOrEqual(6);
    expect(c.reps).toHaveLength(6);
  });

  it('the threshold is adjustable', () => {
    const c = count('squat', simReps('t', 'squat', { lift: [0.7, 0.7, 0.75, 0.85, 1.0, 1.2] }).frames, 0.6);
    expect(c.stopSuggested).toBe(false);
  });

  it('flags hips sagging in push-ups', () => {
    const c = count('pushup', simReps('t', 'pushup', { lift: even(3), sag: 40 }).frames);
    expect(c.reps[0]!.flags).toContain('hips-sagging');
  });

  it('flags uneven tempo', () => {
    const c = count('squat', simReps('t', 'squat', { lift: [0.5, 2.2, 0.5, 2.2, 0.5] }, 3).frames, 0.99);
    expect(c.summary().flagCounts['uneven-tempo']).toBeGreaterThan(0);
  });

  it('frames with too little visible are ignored, not guessed', () => {
    expect(count('squat', simBadFraming('t', 3).frames).reps).toHaveLength(0);
  });

  it('has the seven listed exercises', () => {
    expect(EXERCISES.map((e) => e.id)).toEqual(['squat', 'goblet', 'lunge', 'pushup', 'bridge', 'press', 'plank']);
  });
});

describe('plank', () => {
  it('times the hold and notices sag', () => {
    const h = new HoldTimer(exerciseById('plank')!);
    for (const f of simPlank('t', 30, 20).frames) h.push(f);
    const s = h.summary();
    expect(s.holdSeconds).toBeGreaterThan(25);
    expect(s.sagShare).toBeGreaterThan(0.05);
    expect(s.sagShare).toBeLessThan(0.5);
  });
});

describe('framing guide', () => {
  it('maps what is visible to plain hints', () => {
    expect(framingHint(null).code).toBe('no-person');
    expect(framingHint(simBadFraming('t', 1).frames[0]!).text).toMatch(/feet are cut off/);
    const front = simJumps('t', []).frames[0]!;
    expect(framingHint(front).ok).toBe(true);
    expect(framingHint(front, 'side', 'squats').text).toBe('Turn a bit to the side for squats.');
    const side = simReps('t', 'squat', { lift: [] }).frames[0]!;
    expect(framingHint(side, 'side', 'squats').ok).toBe(true);
    expect(framingHint(side, 'front', 'presses').code).toBe('turn-front');
  });
});

describe('plans', () => {
  it('offers upper-body work after a swap and nothing on a rest day', () => {
    expect(exercisesForPlan('Track intervals', 'hard', true).map((e) => e.id)).toEqual(['pushup', 'press', 'plank']);
    expect(exercisesForPlan('Rest day', 'rest')).toEqual([]);
  });
});

describe('pose files', () => {
  it('round-trips, and replays against the clock', () => {
    const s = simJumps('jumps', [{ flightS: 0.5 }], { fps: 30 });
    const parsed = parsePoseJsonl(toPoseJsonl(s.header, s.frames));
    expect(parsed.header.synthetic).toBe(true);
    expect(parsed.frames).toHaveLength(s.frames.length);
    const replay = new PoseReplay(parsed);
    expect(replay.framesUntil(100).length).toBe(4);
    expect(replay.framesUntil(1e9).length).toBe(parsed.frames.length - 4);
    expect(replay.finished).toBe(true);
    expect(run(parsed.frames)[0]?.valid).toBe(true);
  });
});
