import { describe, expect, it } from 'vitest';
import {
  assessHistory,
  buildInsights,
  findBannedWords,
  isSmartCall,
  legsLine,
  legsState,
  planUsesLegs,
  READINESS,
  todaysCall,
  type DayReading,
  type SessionFact,
} from '../src';

const usual = [0.36, 0.361, 0.359, 0.362, 0.358, 0.36];
const track = { title: 'Track intervals, 8 x 800 m', intensity: 'hard' } as const;

describe('legsState', () => {
  it('learns for five checks before saying anything', () => {
    expect(legsState([0.36, 0.36], 0.3).kind).toBe('learning');
    expect(legsLine(legsState([0.36, 0.36], 0.3))).toBe('Legs: learning your usual (3 of 5)');
  });
  it('reads a 9% fall as clearly down, in plain words', () => {
    const legs = legsState(usual, 0.328);
    expect(legs.kind).toBe('clearly-down');
    expect(legs.pct).toBe(-9);
    expect(legsLine(legs)).toBe('Legs: 9% below usual');
  });
  it('treats a small wobble as usual', () => {
    expect(legsState(usual, 0.356).kind).toBe('usual');
  });
  it('skipping is never a mark against anyone', () => {
    expect(legsLine(legsState(usual, null, true))).toBe('Legs: skipped today');
  });
});

describe("today's call", () => {
  it('Heart Ready, legs clearly down, hard leg session: suggests upper body', () => {
    const call = todaysCall('ready', legsState(usual, 0.328), track, 'running');
    expect(call.heart).toBe('Heart: Ready');
    expect(call.legs).toBe('Legs: 9% below usual');
    expect(call.suggestion).toBe('upper');
    expect(call.options.find((o) => o.suggested)?.choice).toBe('upper');
    expect(call.options[0]?.choice).toBe('planned');
  });
  it('Heart Ready, legs fine: train as planned', () => {
    expect(todaysCall('ready', legsState(usual, 0.36), track, 'running').suggestion).toBe('planned');
  });
  it('legs down but an upper-body plan: no change needed', () => {
    const call = todaysCall('ready', legsState(usual, 0.328), { title: 'Bench and accessories', intensity: 'hard' }, 'lifting');
    expect(call.suggestion).toBe('planned');
  });
  it('Watch keeps it moderate, Check in goes easy', () => {
    expect(todaysCall('watch', legsState([], null), track).suggestion).toBe('moderate');
    expect(todaysCall('check-in', legsState([], null), track).suggestion).toBe('easy');
  });
  it('every option stays open', () => {
    const call = todaysCall('check-in', legsState([], null), track, 'running');
    expect(call.options.map((o) => o.choice)).toEqual(['planned', 'moderate', 'upper', 'easy', 'rest']);
  });
  it('uses no banned words in any branch', () => {
    const text = (['ready', 'watch', 'check-in', 'learning'] as const)
      .flatMap((h) => (['hard', 'moderate', 'easy', 'rest'] as const).map((i) => todaysCall(h, legsState(usual, 0.328), { title: 'Run', intensity: i }).why))
      .join(' ');
    expect(findBannedWords(text)).toEqual([]);
  });
});

describe('smart calls', () => {
  const none = legsState([], null);
  const down = legsState(usual, 0.328);
  it('rewards going hard on a Ready day', () => {
    expect(isSmartCall('ready', none, track, 'hard')).toBe(true);
    expect(isSmartCall('ready', none, track, 'easy')).toBe(false);
  });
  it('rewards easing off on off days, and gives nothing for going hard', () => {
    expect(isSmartCall('watch', none, track, 'moderate')).toBe(true);
    expect(isSmartCall('check-in', none, track, 'rest')).toBe(true);
    expect(isSmartCall('check-in', none, track, 'hard')).toBe(false);
  });
  it('rewards easing off when legs are clearly down, even with the heart Ready', () => {
    expect(isSmartCall('ready', down, track, 'easy', 'running')).toBe(true);
    expect(isSmartCall('ready', down, track, 'hard', 'running')).toBe(false);
  });
  it('gives nothing while still learning', () => {
    expect(isSmartCall('learning', none, track, 'hard')).toBe(false);
  });
});

describe('planUsesLegs', () => {
  it('reads titles and sport', () => {
    expect(planUsesLegs('Track intervals')).toBe(true);
    expect(planUsesLegs('Bench and accessories', 'lifting')).toBe(false);
    expect(planUsesLegs('Easy session', 'running')).toBe(true);
    expect(planUsesLegs('Rest day', 'running')).toBe(false);
  });
});

describe('jump in the readiness model', () => {
  const days = (n: number, jump?: number): DayReading[] =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-11-${String(i + 1).padStart(2, '0')}`,
      pulse: 60,
      rmssd: 60,
      stress: 80,
      breath: 14,
      sleep: 8,
      feel: 4,
      ...(jump ? { jump } : {}),
    }));

  it('weights are about 0.20 for jump and still sum to one', () => {
    expect(READINESS.weights.jump).toBeCloseTo(0.2);
    expect(Object.values(READINESS.weights).reduce((s, v) => s + v, 0)).toBeCloseTo(1);
  });

  it('ignores jump until five valid Legs checks exist', () => {
    const history = [...days(10), ...days(4, 0.36).map((d, i) => ({ ...d, date: `2026-11-${11 + i}` }))];
    const last: DayReading = { date: '2026-11-15', pulse: 60, rmssd: 60, stress: 80, breath: 14, sleep: 8, feel: 4, jump: 0.2 };
    const a = assessHistory([...history, last]).at(-1)!;
    expect(a.deviations.some((d) => d.metric === 'jump')).toBe(false);
  });

  it('counts jump after that, lower being worse, and names it plainly', () => {
    const history = days(8, 0.36);
    const last: DayReading = { date: '2026-11-09', pulse: 60, rmssd: 60, stress: 80, breath: 14, sleep: 8, feel: 4, jump: 0.28 };
    const a = assessHistory([...history, last]).at(-1)!;
    const jump = a.deviations.find((d) => d.metric === 'jump')!;
    expect(jump.off).toBeGreaterThan(1);
    expect(a.reasons.join(' ')).toMatch(/Legs \d+% below usual/);
  });

  it('a higher jump is never a problem', () => {
    const a = assessHistory([...days(8, 0.36), { date: '2026-11-09', pulse: 60, jump: 0.45 }]).at(-1)!;
    expect(a.deviations.find((d) => d.metric === 'jump')?.off).toBe(0);
  });
});

const fact = (over: Partial<SessionFact>): SessionFact => ({
  date: '2026-11-01',
  exercise: 'squat',
  status: 'ready',
  speedDrop: 0.22,
  avgDepth: 0.9,
  followedEasier: false,
  ignoredEasier: false,
  usesLegs: true,
  hard: false,
  ...over,
});

describe('insights', () => {
  it('compares squat speed drop on Watch and Ready days, showing the examples', () => {
    const sessions = [
      ...[1, 2, 3, 4].map(() => fact({ status: 'ready', speedDrop: 0.22 })),
      ...[1, 2, 3].map(() => fact({ status: 'watch', speedDrop: 0.26 })),
    ];
    const [i] = buildInsights(sessions, [], []);
    expect(i?.text).toBe('So far, on Watch days your squat speed drops 18% faster than on Ready days.');
    expect(i?.examples).toBe('3 Watch days and 4 Ready days');
  });
  it('says nothing from too few examples', () => {
    expect(buildInsights([fact({ status: 'watch', speedDrop: 0.5 }), fact({})], [], [])).toEqual([]);
  });
  it('says nothing when the difference is small', () => {
    const sessions = [...[1, 2, 3].map(() => fact({ status: 'ready' })), ...[1, 2, 3].map(() => fact({ status: 'watch', speedDrop: 0.225 }))];
    expect(buildInsights(sessions, [], [])).toEqual([]);
  });
  it('notes depth on days the suggestion was followed', () => {
    const sessions = [
      ...[1, 2, 3].map(() => fact({ followedEasier: true, avgDepth: 0.95 })),
      ...[1, 2, 3].map(() => fact({ ignoredEasier: true, avgDepth: 0.85 })),
    ];
    expect(buildInsights(sessions, [], []).map((i) => i.id)).toContain('depth-followed');
  });
  it('compares legs and heart after hard leg sessions', () => {
    const jumps = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13'].map((d) => ({
      date: `2026-11-${d}`,
      heightM: ['02', '03', '06', '07', '10', '11'].includes(d) ? 0.33 : 0.36,
    }));
    const heart = jumps.map((j) => ({ date: j.date, status: 'ready' }));
    const sessions = ['2026-11-01', '2026-11-05', '2026-11-09'].map((date) => fact({ date, hard: true }));
    const found = buildInsights(sessions, jumps, heart).find((i) => i.id === 'legs-vs-heart');
    expect(found?.text).toMatch(/jump stays down for about 2 days/);
    expect(found?.examples).toBe('3 hard leg sessions');
    expect(findBannedWords(found!.text)).toEqual([]);
  });
});
