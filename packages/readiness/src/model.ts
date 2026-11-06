import { METRICS, READINESS, type Metric } from './config';

/** One morning's trusted values. A metric that wasn't read well is simply absent. */
export interface DayReading {
  /** YYYY-MM-DD */
  date: string;
  pulse?: number;
  breath?: number;
  rmssd?: number;
  stress?: number;
  sleep?: number;
  feel?: number;
  /** Best valid jump height of the day, an estimate in metres. Only ever compared with the person's own. */
  jump?: number;
}

export type Status = 'ready' | 'watch' | 'check-in' | 'waiting' | 'learning';

export interface MetricBaseline {
  median: number;
  mad: number;
  count: number;
}
export type Baseline = Partial<Record<Metric, MetricBaseline>>;

export interface Deviation {
  metric: Metric;
  today: number;
  /** Median of the usual range, in the metric's natural units. */
  usual: number;
  /** Robust z-score, positive when further towards "worse". Capped. */
  off: number;
}

export interface Assessment {
  date: string;
  status: Status;
  score: number;
  deviations: Deviation[];
  reasons: string[];
  goodCheckins: number;
  watchStreak: number;
  /** Feel has been 1/5 for several days. Shown to the coach only. */
  gentleNudge: boolean;
}

export function median(values: readonly number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mad(values: readonly number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** RMSSD is skewed, so it's compared on a log scale. */
const toWorking = (metric: Metric, value: number): number =>
  metric === 'rmssd' ? Math.log(Math.max(value, 1)) : value;

/** Which direction is further from usual in the "worse" sense. */
const WORSE_WHEN: Record<Metric, 1 | -1> = {
  pulse: 1,
  breath: 1,
  stress: 1,
  rmssd: -1,
  sleep: -1,
  feel: -1,
  jump: -1,
};

/** A good check-in has at least one trusted camera reading. Taps alone don't teach the baseline. */
export const isGoodCheckin = (r: DayReading): boolean =>
  r.pulse !== undefined || r.rmssd !== undefined;

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Rolling baseline from the good check-ins in the days before `date`, never including `date`. */
export function computeBaseline(history: readonly DayReading[], date: string): Baseline {
  const usable = history.filter((r) => {
    const age = daysBetween(r.date, date);
    return age >= 1 && age <= READINESS.baselineDays && isGoodCheckin(r);
  });
  const baseline: Baseline = {};
  for (const metric of METRICS) {
    const values = usable.map((r) => r[metric]).filter((v): v is number => v !== undefined);
    if (!values.length) continue;
    const working = values.map((v) => toWorking(metric, v));
    baseline[metric] = { median: median(working), mad: mad(working), count: values.length };
  }
  return baseline;
}

/** The personal usual range in natural units, for shading charts. */
export function usualRange(
  baseline: Baseline,
  metric: Metric,
): { low: number; high: number; median: number } | null {
  const b = baseline[metric];
  if (!b) return null;
  const spread = 1.4826 * Math.max(b.mad, READINESS.madFloor[metric]);
  const back = (v: number): number => (metric === 'rmssd' ? Math.exp(v) : v);
  return { low: back(b.median - spread), high: back(b.median + spread), median: back(b.median) };
}

export function computeDeviations(reading: DayReading, baseline: Baseline): Deviation[] {
  const out: Deviation[] = [];
  for (const metric of METRICS) {
    const today = reading[metric];
    const b = baseline[metric];
    if (today === undefined || !b) continue;
    if (metric === 'jump' && b.count < READINESS.jumpLearning) continue;
    const z =
      (toWorking(metric, today) - b.median) / (1.4826 * Math.max(b.mad, READINESS.madFloor[metric]));
    out.push({
      metric,
      today,
      usual: metric === 'rmssd' ? Math.exp(b.median) : b.median,
      off: Math.min(READINESS.maxDeviation, Math.max(0, z * WORSE_WHEN[metric])),
    });
  }
  return out;
}

/** Weighted mean of how far off each metric is. Missing metrics drop out and weights renormalise. */
export function combinedScore(deviations: readonly Deviation[]): number {
  let weight = 0;
  let sum = 0;
  for (const d of deviations) {
    weight += READINESS.weights[d.metric];
    sum += READINESS.weights[d.metric] * d.off;
  }
  return weight > 0 ? sum / weight : 0;
}

const pct = (today: number, usual: number): number =>
  usual === 0 ? 0 : Math.round((Math.abs(today - usual) / usual) * 100);

/** Plain sentence for one metric. Every string here is checked by the wording test. */
export function reasonText(d: Deviation): string {
  switch (d.metric) {
    case 'pulse':
      return `Pulse ${Math.round(d.today - d.usual)} above usual`;
    case 'rmssd':
      return `HRV ${pct(d.today, d.usual)}% below usual`;
    case 'stress':
      return `Stress index ${pct(d.today, d.usual)}% above usual`;
    case 'breath':
      return `Breathing ${Math.round(d.today - d.usual)}/min above usual`;
    case 'sleep':
      return `Slept ${roundHalf(d.today)} h`;
    case 'feel':
      return `Feels ${Math.round(d.today)}/5`;
    case 'jump':
      return `Legs ${pct(d.today, d.usual)}% below usual`;
  }
}

const roundHalf = (v: number): number => Math.round(v * 2) / 2;

function pickReasons(deviations: readonly Deviation[]): string[] {
  return [...deviations]
    .filter((d) => d.off >= READINESS.reasonMin)
    .sort(
      (a, b) =>
        READINESS.weights[b.metric] * b.off - READINESS.weights[a.metric] * a.off ||
        METRICS.indexOf(a.metric) - METRICS.indexOf(b.metric),
    )
    .slice(0, READINESS.maxReasons)
    .map(reasonText);
}

/**
 * Replays an athlete's whole history, because status depends on previous days (hysteresis and the
 * Watch streak). Returns one assessment per reading, in date order. Deterministic.
 */
export function assessHistory(readings: readonly DayReading[]): Assessment[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const out: Assessment[] = [];
  let previous: Assessment | null = null;
  let good = 0;
  let lowFeelRun = 0;
  sorted.forEach((reading, index) => {
    const past = sorted.slice(0, index);
    const goodBefore = good;
    if (isGoodCheckin(reading)) good++;
    lowFeelRun = reading.feel === 1 ? lowFeelRun + 1 : 0;
    const gentleNudge = lowFeelRun >= READINESS.lowFeelDays;

    if (goodBefore < READINESS.learningCheckins) {
      previous = {
        date: reading.date,
        status: 'learning',
        score: 0,
        deviations: [],
        reasons: [],
        goodCheckins: good,
        watchStreak: 0,
        gentleNudge,
      };
      out.push(previous);
      return;
    }

    const deviations = computeDeviations(reading, computeBaseline(past, reading.date));
    const score = combinedScore(deviations);
    const peak = deviations.reduce((m, d) => Math.max(m, d.off), 0);
    // A gap of more than two days means yesterday's status says nothing about today.
    const recent: Assessment | null =
      previous && daysBetween(previous.date, reading.date) <= 2 ? previous : null;
    const margin = READINESS.holdMargin;
    const wasCheckIn = recent?.status === 'check-in';
    const wasOff = recent?.status === 'watch' || wasCheckIn;

    const offNow =
      score >= READINESS.watch.combined - (wasOff ? margin : 0) ||
      peak >= READINESS.watch.single - (wasOff ? margin : 0);
    const watchStreak = offNow ? (recent?.watchStreak ?? 0) + 1 : 0;

    let status: Status = 'ready';
    if (offNow) {
      const high = score >= READINESS.checkIn.combined - (wasCheckIn ? margin : 0);
      const long = watchStreak >= READINESS.checkIn.watchDays;
      status = high || long ? 'check-in' : 'watch';
    }

    previous = {
      date: reading.date,
      status,
      score,
      deviations,
      reasons: status === 'ready' ? [] : pickReasons(deviations),
      goodCheckins: good,
      watchStreak,
      gentleNudge,
    };
    out.push(previous);
  });
  return out;
}

/** Sort key for the coach's board: who needs attention first. */
export const STATUS_ORDER: Record<Status, number> = {
  'check-in': 0,
  watch: 1,
  waiting: 2,
  learning: 3,
  ready: 4,
};

/** Words that must never appear in the UI, in drafts or in docs that face users. */
export const BANNED_WORDS = [
  'diagnos',
  'disease',
  'illness',
  'sick',
  'infection',
  'anxiety',
  'disorder',
  'cardiac',
  'arrhythmia',
  'nervous system',
  'risk score',
] as const;

/** Matches from the start of a word, so "stillness" isn't read as "illness". */
export function findBannedWords(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_WORDS.filter((w) => new RegExp(`\\b${w}`).test(lower));
}
