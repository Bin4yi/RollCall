import { median } from './model';

/**
 * Personal comparisons across training, legs and heart. Every insight shows how many examples it rests
 * on, stays cautious ("so far"), and says nothing about what a pattern might mean for anyone's health.
 */
export interface SessionFact {
  date: string;
  exercise: string;
  /** The morning's heart status. */
  status: string;
  /** Largest fall in rep speed within a set, 0..1. */
  speedDrop: number;
  avgDepth: number;
  /** Rollo suggested easier, and the person went easier. */
  followedEasier: boolean;
  /** Rollo suggested easier, and the person didn't. */
  ignoredEasier: boolean;
  usesLegs: boolean;
  hard: boolean;
}

export interface Insight {
  id: string;
  text: string;
  /** "4 Watch days and 6 Ready days" */
  examples: string;
}

export const INSIGHTS = {
  /** Examples needed on each side of a comparison. */
  minEach: 3,
  minDifference: 0.1,
  minDepthDifference: 0.03,
  /** Jump within this share of usual counts as back. */
  jumpBack: 0.03,
  maxDaysLooked: 5,
} as const;

const mean = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const addDay = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const FAMILY: Record<string, string> = {
  squat: 'squat',
  goblet: 'squat',
  lunge: 'lunge',
  pushup: 'push-up',
  bridge: 'bridge',
  press: 'press',
};

export function buildInsights(
  sessions: readonly SessionFact[],
  jumps: readonly { date: string; heightM: number }[],
  heart: readonly { date: string; status: string }[],
): Insight[] {
  const out: Insight[] = [];

  // Speed drop-off on off days against Ready days, per movement.
  for (const family of new Set(Object.values(FAMILY))) {
    const own = sessions.filter((s) => FAMILY[s.exercise] === family);
    const off = own.filter((s) => s.status === 'watch' || s.status === 'check-in');
    const ready = own.filter((s) => s.status === 'ready');
    if (off.length < INSIGHTS.minEach || ready.length < INSIGHTS.minEach) continue;
    const a = mean(off.map((s) => s.speedDrop));
    const b = mean(ready.map((s) => s.speedDrop));
    if (b <= 0 || Math.abs(a - b) / b < INSIGHTS.minDifference) continue;
    const pct = Math.round((Math.abs(a - b) / b) * 100);
    out.push({
      id: `speed-${family}`,
      text: `So far, on Watch days your ${family} speed drops ${pct}% ${a > b ? 'faster' : 'slower'} than on Ready days.`,
      examples: `${plural(off.length, 'Watch day')} and ${plural(ready.length, 'Ready day')}`,
    });
  }

  // Depth on days the person took Rollo's "go easier" suggestion.
  const followed = sessions.filter((s) => s.followedEasier);
  const ignored = sessions.filter((s) => s.ignoredEasier);
  if (followed.length >= INSIGHTS.minEach && ignored.length >= INSIGHTS.minEach) {
    const a = mean(followed.map((s) => s.avgDepth));
    const b = mean(ignored.map((s) => s.avgDepth));
    if (a - b >= INSIGHTS.minDepthDifference) {
      out.push({
        id: 'depth-followed',
        text: 'So far, your depth has held better on days you followed Rollo’s “go easier” suggestion.',
        examples: `${plural(followed.length, 'day')} you followed it and ${plural(ignored.length, 'day')} you didn’t`,
      });
    }
  }

  // How long legs and heart take to come back after a hard leg session.
  if (jumps.length >= 5) {
    const usual = median(jumps.map((j) => j.heightM));
    const jumpOn = new Map(jumps.map((j) => [j.date, j.heightM]));
    const heartOn = new Map(heart.map((h) => [h.date, h.status]));
    const legDays = [...new Set(sessions.filter((s) => s.usesLegs && s.hard).map((s) => s.date))];
    const legsBack: number[] = [];
    let heartBackNext = 0;
    let heartSeen = 0;
    for (const date of legDays) {
      for (let d = 1; d <= INSIGHTS.maxDaysLooked; d++) {
        const height = jumpOn.get(addDay(date, d));
        if (height === undefined) continue;
        if (height >= usual * (1 - INSIGHTS.jumpBack)) {
          legsBack.push(d - 1);
          break;
        }
      }
      const next = heartOn.get(addDay(date, 1));
      if (next !== undefined) {
        heartSeen++;
        if (next === 'ready') heartBackNext++;
      }
    }
    if (legsBack.length >= INSIGHTS.minEach && heartSeen >= INSIGHTS.minEach) {
      const days = Math.round(median(legsBack));
      if (days >= 1 && heartBackNext / heartSeen >= 0.6) {
        out.push({
          id: 'legs-vs-heart',
          text: `So far, after you train legs hard your jump stays down for about ${plural(days, 'day')}, while your heart is usually back to usual the next morning.`,
          examples: plural(legsBack.length, 'hard leg session'),
        });
      }
    }
  }
  return out;
}
