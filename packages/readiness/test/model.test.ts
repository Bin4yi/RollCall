import { describe, expect, it } from 'vitest';
import {
  assessHistory,
  combinedScore,
  computeBaseline,
  computeDeviations,
  findBannedWords,
  isGoodCheckin,
  mad,
  median,
  READINESS,
  reasonText,
  usualRange,
  type DayReading,
  type Deviation,
  type Metric,
} from '../src';

const day = (n: number): string =>
  new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);

/** A steady athlete with small natural variation. */
const steady = (n: number, over: Partial<DayReading> = {}): DayReading => ({
  date: day(n),
  pulse: 55 + (n % 3),
  breath: 13 + (n % 2),
  rmssd: 60 + (n % 4),
  stress: 80 + (n % 5),
  sleep: 7.5 + (n % 2) * 0.5,
  feel: 4,
  ...over,
});

const history = (days: number): DayReading[] => Array.from({ length: days }, (_, n) => steady(n));
const last = <T>(xs: T[]): T => xs[xs.length - 1]!;

describe('median and MAD', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });
});

describe('baseline', () => {
  it('uses only the 14 days before the date, never the date itself', () => {
    const rows = [
      steady(0, { pulse: 200 }), // 20 days back: too old
      ...Array.from({ length: 14 }, (_, i) => steady(6 + i, { pulse: 50 })),
      steady(20, { pulse: 200 }), // today: excluded
    ];
    const b = computeBaseline(rows, day(20));
    expect(b.pulse?.median).toBe(50);
    expect(b.pulse?.count).toBe(14);
  });

  it('ignores check-ins with no trusted camera reading', () => {
    const rows: DayReading[] = [
      { date: day(0), sleep: 1, feel: 1 },
      ...Array.from({ length: 5 }, (_, i) => steady(i + 1, { sleep: 8 })),
    ];
    expect(computeBaseline(rows, day(6)).sleep?.median).toBe(8);
    expect(isGoodCheckin({ date: day(0), sleep: 8 })).toBe(false);
    expect(isGoodCheckin({ date: day(0), rmssd: 40 })).toBe(true);
  });

  it('gives a usual range in natural units, including log-scale RMSSD', () => {
    const rows = Array.from({ length: 10 }, (_, i) => steady(i, { rmssd: 50 }));
    const range = usualRange(computeBaseline(rows, day(10)), 'rmssd')!;
    expect(range.median).toBeCloseTo(50, 5);
    expect(range.low).toBeLessThan(50);
    expect(range.high).toBeGreaterThan(50);
    expect(usualRange({}, 'pulse')).toBeNull();
  });
});

describe('deviations', () => {
  const baseline = computeBaseline(history(14), day(14));
  const off = (over: Partial<DayReading>, metric: Metric): number =>
    computeDeviations({ date: day(14), ...over }, baseline).find((d) => d.metric === metric)!.off;

  it('counts the worse direction only, for each metric', () => {
    expect(off({ pulse: 70 }, 'pulse')).toBeGreaterThan(1);
    expect(off({ pulse: 40 }, 'pulse')).toBe(0);
    expect(off({ breath: 22 }, 'breath')).toBeGreaterThan(1);
    expect(off({ stress: 200 }, 'stress')).toBeGreaterThan(1);
    expect(off({ rmssd: 25 }, 'rmssd')).toBeGreaterThan(1);
    expect(off({ rmssd: 120 }, 'rmssd')).toBe(0);
    expect(off({ sleep: 4 }, 'sleep')).toBeGreaterThan(1);
    expect(off({ feel: 1 }, 'feel')).toBeGreaterThan(1);
    expect(off({ feel: 5 }, 'feel')).toBe(0);
  });

  it('uses a MAD floor so tiny natural spread cannot explode', () => {
    const flat = Array.from({ length: 14 }, (_, i) => steady(i, { pulse: 55 }));
    const b = computeBaseline(flat, day(14));
    const d = computeDeviations({ date: day(14), pulse: 56 }, b)[0]!;
    expect(d.off).toBeCloseTo(1 / (1.4826 * READINESS.madFloor.pulse), 5);
  });

  it('caps extreme values', () => {
    expect(off({ pulse: 110 }, 'pulse')).toBe(READINESS.maxDeviation);
  });

  it('leaves out missing metrics and renormalises the weights', () => {
    const dev: Deviation = { metric: 'pulse', today: 60, usual: 55, off: 2 };
    expect(combinedScore([dev])).toBeCloseTo(2, 5);
    expect(
      combinedScore([dev, { metric: 'rmssd', today: 60, usual: 60, off: 0 }]),
    ).toBeCloseTo((0.3 * 2) / 0.55, 5);
    expect(combinedScore([])).toBe(0);
  });
});

describe('status', () => {
  it('stays in learning mode until 5 good check-ins, with no sun and no reasons', () => {
    const out = assessHistory(history(6));
    expect(out.slice(0, 5).every((a) => a.status === 'learning')).toBe(true);
    expect(out[0]!.reasons).toEqual([]);
    expect(out[5]!.status).toBe('ready');
    expect(out[4]!.goodCheckins).toBe(5);
  });

  it('check-ins without a camera reading do not shorten learning', () => {
    const rows: DayReading[] = [
      ...Array.from({ length: 6 }, (_, n) => ({ date: day(n), sleep: 8, feel: 4 })),
      steady(6),
    ];
    expect(assessHistory(rows).every((a) => a.status === 'learning')).toBe(true);
  });

  it('is Ready when close to usual', () => {
    expect(last(assessHistory(history(20))).status).toBe('ready');
  });

  it('is Watch when one signal is clearly off', () => {
    const rows = [...history(14), steady(14, { pulse: 66 })];
    const a = last(assessHistory(rows));
    expect(a.status).toBe('watch');
    expect(a.reasons[0]).toMatch(/^Pulse \d+ above usual$/);
  });

  it('is Check in when several signals are far off', () => {
    const rows = [
      ...history(14),
      steady(14, { pulse: 72, rmssd: 25, stress: 180, breath: 20, sleep: 4, feel: 1 }),
    ];
    const a = last(assessHistory(rows));
    expect(a.status).toBe('check-in');
    expect(a.reasons.length).toBe(READINESS.maxReasons);
  });

  it('becomes Check in after Watch for three days running', () => {
    const off = { pulse: 66 };
    const rows = [...history(14), steady(14, off), steady(15, off), steady(16, off)];
    const out = assessHistory(rows);
    expect(out[14]!.status).toBe('watch');
    expect(out[15]!.status).toBe('watch');
    expect(out[16]!.status).toBe('check-in');
    expect(out[16]!.watchStreak).toBe(3);
  });

  it('holds a status near the threshold instead of flickering', () => {
    const baseline = computeBaseline(history(14), day(14));
    const justBelow = baseline.pulse!.median + 1.4826 * Math.max(baseline.pulse!.mad, 2) * 1.85;
    // Alone, this is below the single-metric threshold, so a fresh day is Ready...
    const alone = [...history(14), steady(14, { pulse: justBelow })];
    expect(last(assessHistory(alone)).status).toBe('ready');
    // ...but straight after a Watch day it stays Watch.
    const after = [...history(14), steady(14, { pulse: 70 }), steady(15, { pulse: justBelow })];
    expect(last(assessHistory(after)).status).not.toBe('ready');
  });

  it('forgets the streak after a long gap', () => {
    const rows = [...history(14), steady(14, { pulse: 66 }), steady(15, { pulse: 66 }), steady(20, { pulse: 66 })];
    const out = assessHistory(rows);
    expect(last(out).watchStreak).toBe(1);
    expect(last(out).status).toBe('watch');
  });

  it('low-confidence metrics simply drop out', () => {
    const today = steady(14, { breath: 13 });
    delete today.pulse;
    delete today.rmssd;
    const a = last(assessHistory([...history(14), today]));
    expect(a.deviations.map((d) => d.metric)).not.toContain('pulse');
    expect(a.deviations.map((d) => d.metric)).not.toContain('rmssd');
    expect(a.status).toBe('ready');
  });

  it('nudges the coach after three days of feeling 1/5, and stops when it lifts', () => {
    const low = { feel: 1 };
    const rows = [...history(14), steady(14, low), steady(15, low), steady(16, low), steady(17)];
    const out = assessHistory(rows);
    expect(out[15]!.gentleNudge).toBe(false);
    expect(out[16]!.gentleNudge).toBe(true);
    expect(out[17]!.gentleNudge).toBe(false);
  });

  it('is deterministic and order independent', () => {
    const rows = history(20);
    expect(assessHistory([...rows].reverse())).toEqual(assessHistory(rows));
  });
});

describe('wording', () => {
  it('every reason is plain and free of banned words', () => {
    const all: Deviation[] = [
      { metric: 'pulse', today: 63, usual: 55, off: 3 },
      { metric: 'rmssd', today: 45, usual: 60, off: 3 },
      { metric: 'stress', today: 130, usual: 100, off: 3 },
      { metric: 'breath', today: 17, usual: 14, off: 3 },
      { metric: 'sleep', today: 5, usual: 8, off: 3 },
      { metric: 'feel', today: 2, usual: 4, off: 3 },
    ];
    expect(all.map(reasonText)).toEqual([
      'Pulse 8 above usual',
      'HRV 25% below usual',
      'Stress index 30% above usual',
      'Breathing 3/min above usual',
      'Slept 5 h',
      'Feels 2/5',
    ]);
    expect(findBannedWords(all.map(reasonText).join(' '))).toEqual([]);
  });

  it('the filter catches banned words in any case', () => {
    expect(findBannedWords('possible INFECTION and a Diagnosis')).toEqual(['diagnos', 'infection']);
    expect(findBannedWords('Pulse above your usual')).toEqual([]);
    expect(findBannedWords('Stillness matters, and sickness does not belong here')).toEqual(['sick']);
  });
});
