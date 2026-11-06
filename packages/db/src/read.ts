import {
  assessHistory,
  computeBaseline,
  STATUS_ORDER,
  usualRange,
  type Assessment,
  type DayReading,
  type Metric,
  type Status,
} from '@rollcall/readiness';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './index';
import { athletes, checkins, messages, plans, type Workspace } from './schema';

type CheckinRow = typeof checkins.$inferSelect;
type AthleteRow = typeof athletes.$inferSelect;
type PlanRow = typeof plans.$inferSelect;

/** Only what was read with good confidence reaches here: the check-in leaves out everything else. */
export function toReading(row: CheckinRow): DayReading {
  const r: DayReading = { date: row.date };
  if (row.pulse !== null) r.pulse = row.pulse;
  if (row.breath !== null) r.breath = row.breath;
  if (row.rmssd !== null) r.rmssd = row.rmssd;
  if (row.stress !== null) r.stress = row.stress;
  if (row.sleep !== null) r.sleep = row.sleep;
  if (row.feel !== null) r.feel = row.feel;
  return r;
}

export interface BoardRow {
  id: string;
  name: string;
  sport: string;
  squad: string;
  avatar: string | null;
  status: Status;
  /** How far from their usual, for sorting. Never shown as a number. */
  score: number;
  reasons: string[];
  plan: { title: string; intensity: string; changed: boolean } | null;
  checkedIn: boolean;
  /** Days since the last check-in, when not checked in today. */
  daysAway: number | null;
  learning: { have: number; need: number } | null;
  gentleNudge: boolean;
  /** Coach has already messaged about today. */
  decided: boolean;
  source: string | null;
}

export interface Board {
  date: string;
  rows: BoardRow[];
  summary: string;
  counts: { total: number; checkedIn: number; toLook: number; ready: number };
}

const LEARNING_NEED = 5;

const dayGap = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function assessmentFor(date: string, rows: CheckinRow[]): Assessment | null {
  const morning = rows.filter((r) => r.kind === 'morning');
  const today = morning.some((r) => r.date === date);
  if (!today) return null;
  return assessHistory(morning.filter((r) => r.date <= date).map(toReading)).at(-1) ?? null;
}

export async function loadBoard(db: Db, workspace: Workspace, date: string): Promise<Board> {
  const people = await db.select().from(athletes).where(eq(athletes.workspace, workspace));
  const ids = people.map((a) => a.id);
  const allCheckins = ids.length
    ? await db.select().from(checkins).where(inArray(checkins.athleteId, ids))
    : [];
  const todayPlans = ids.length
    ? await db
        .select()
        .from(plans)
        .where(and(inArray(plans.athleteId, ids), eq(plans.date, date)))
    : [];
  const todayMessages = ids.length
    ? await db
        .select()
        .from(messages)
        .where(and(inArray(messages.athleteId, ids), eq(messages.date, date)))
    : [];

  const rows = people.map((a): BoardRow => {
    const own = allCheckins.filter((c) => c.athleteId === a.id);
    const morning = own.filter((c) => c.kind === 'morning');
    const assessment = assessmentFor(date, own);
    const plan = todayPlans.find((p) => p.athleteId === a.id);
    const last = morning.map((c) => c.date).sort().at(-1);
    const good = morning.filter((c) => c.pulse !== null || c.rmssd !== null).length;
    const status: Status = assessment?.status ?? (good < LEARNING_NEED ? 'learning' : 'waiting');
    return {
      id: a.id,
      name: a.name,
      sport: a.sport,
      squad: a.squad,
      avatar: a.avatar,
      status,
      score: assessment?.score ?? 0,
      reasons: assessment?.reasons ?? [],
      plan: plan
        ? { title: plan.title, intensity: plan.intensity, changed: plan.originalTitle !== null }
        : null,
      checkedIn: assessment !== null,
      daysAway: assessment || !last ? null : dayGap(last, date),
      learning: status === 'learning' ? { have: good, need: LEARNING_NEED } : null,
      gentleNudge: assessment?.gentleNudge ?? false,
      decided: todayMessages.some((m) => m.athleteId === a.id),
      source: morning.find((c) => c.date === date)?.source ?? null,
    };
  });

  rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.score - a.score ||
      a.name.localeCompare(b.name),
  );
  const checkedIn = rows.filter((r) => r.checkedIn).length;
  const toLook = rows.filter((r) => r.status === 'watch' || r.status === 'check-in').length;
  const ready = rows.filter((r) => r.status === 'ready').length;
  const summary = !rows.length
    ? 'No athletes yet.'
    : `${checkedIn} of ${rows.length} checked in, ${toLook === 0 ? 'nobody' : toLook} to look at.`;
  return { date, rows, summary, counts: { total: rows.length, checkedIn, toLook, ready } };
}

export interface DetailPoint {
  date: string;
  pulse: number | null;
  breath: number | null;
  rmssd: number | null;
  stress: number | null;
  sleep: number | null;
  feel: number | null;
  status: Status | null;
  intensity: string | null;
}

const METRIC_LIST: Metric[] = ['pulse', 'breath', 'rmssd', 'stress', 'sleep', 'feel'];

export interface AthleteDetail {
  athlete: Omit<AthleteRow, 'token'> & { link: string };
  today: BoardRow | null;
  points: DetailPoint[];
  usual: Partial<Record<Metric, { low: number; high: number; median: number }>>;
  sessions: { date: string; title: string; intensity: string; nextDay: Status | null }[];
  settle: { intensity: string; count: number; pulseAboveUsual: number | null; minutesAfter: number | null }[];
  messages: { id: string; date: string; body: string; action: string; readAt: string | null }[];
}

export async function loadDetail(
  db: Db,
  workspace: Workspace,
  id: string,
  date: string,
): Promise<AthleteDetail | null> {
  const [a] = await db
    .select()
    .from(athletes)
    .where(and(eq(athletes.id, id), eq(athletes.workspace, workspace)));
  if (!a) return null;
  const own = await db.select().from(checkins).where(eq(checkins.athleteId, id));
  const planRows: PlanRow[] = await db.select().from(plans).where(eq(plans.athleteId, id));
  const sent = await db.select().from(messages).where(eq(messages.athleteId, id));
  const morning = own.filter((c) => c.kind === 'morning' && c.date <= date);
  const assessed = assessHistory(morning.map(toReading));
  const statusOn = new Map(assessed.map((x) => [x.date, x.status]));

  const start = new Date(`${date}T00:00:00Z`);
  const points: DetailPoint[] = [];
  for (let i = 27; i >= 0; i--) {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() - i);
    const key = day.toISOString().slice(0, 10);
    const c = morning.find((m) => m.date === key);
    points.push({
      date: key,
      pulse: c?.pulse ?? null,
      breath: c?.breath ?? null,
      rmssd: c?.rmssd ?? null,
      stress: c?.stress ?? null,
      sleep: c?.sleep ?? null,
      feel: c?.feel ?? null,
      status: statusOn.get(key) ?? null,
      intensity: planRows.find((p) => p.date === key)?.intensity ?? null,
    });
  }

  const baseline = computeBaseline(morning.map(toReading), date);
  const usual: AthleteDetail['usual'] = {};
  for (const m of METRIC_LIST) {
    const range = usualRange(baseline, m);
    if (range) usual[m] = range;
  }

  const sessions = planRows
    .filter((p) => p.date < date && (p.intensity === 'hard' || p.intensity === 'moderate'))
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, 10)
    .map((p) => {
      const next = new Date(`${p.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return {
        date: p.date,
        title: p.title,
        intensity: p.intensity,
        nextDay: statusOn.get(next.toISOString().slice(0, 10)) ?? null,
      };
    });

  const settleRows = own.filter((c) => c.kind === 'settle');
  const usualPulse = baseline.pulse?.median;
  const settle = (['hard', 'moderate', 'easy'] as const)
    .map((intensity) => {
      const rows = settleRows.filter((c) => c.sessionIntensity === intensity);
      const pulses = rows.map((c) => c.pulse).filter((v): v is number => v !== null);
      const minutes = rows.map((c) => c.minutesAfter).filter((v): v is number => v !== null);
      const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
      return {
        intensity,
        count: rows.length,
        pulseAboveUsual:
          pulses.length && usualPulse !== undefined ? Math.round(mean(pulses) - usualPulse) : null,
        minutesAfter: minutes.length ? Math.round(mean(minutes)) : null,
      };
    })
    .filter((s) => s.count > 0);

  const board = await loadBoard(db, workspace, date);
  const { token, ...rest } = a;
  return {
    athlete: { ...rest, link: `/a/${token}` },
    today: board.rows.find((r) => r.id === id) ?? null,
    points,
    usual,
    sessions,
    settle,
    messages: sent
      .sort((x, y) => y.sentAt.localeCompare(x.sentAt))
      .slice(0, 20)
      .map((m) => ({ id: m.id, date: m.date, body: m.body, action: m.action, readAt: m.readAt })),
  };
}

/** Consecutive days checked in, ending today or yesterday. */
export function checkinStreak(dates: readonly string[], today: string): number {
  const have = new Set(dates);
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!have.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (have.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
