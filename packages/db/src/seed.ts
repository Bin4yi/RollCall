import { makeRng } from '@rollcall/signals';
import { eq, inArray } from 'drizzle-orm';
import { addDays, type Db } from './index';
import { athletes, checkins, messages, plans, settings, type Intensity } from './schema';

/**
 * Judge Mode's data: 12 fictional athletes and 28 days each, all invented. Deterministic for a given
 * date, and every number is marked as demo data. The stories are checked in packages/db/test.
 */
interface Usual {
  pulse: number;
  breath: number;
  rmssd: number;
  stress: number;
  sleep: number;
}

/** How one day differs from usual. daysAgo 0 is today. */
interface Shift {
  pulse?: number;
  rmssd?: number;
  stress?: number;
  breath?: number;
  sleep?: number;
  feel?: number;
  skip?: boolean;
}

interface Character {
  id: string;
  name: string;
  sport: string;
  squad: string;
  usual: Usual;
  feel: number;
  token: string;
  story: (daysAgo: number, rng: () => number) => Shift;
  plan: (daysAgo: number) => [string, Intensity];
  today: [string, Intensity];
  showNumbers?: boolean;
  notes?: string;
}

const weekly =
  (hard: string, moderate: string, easy: string) =>
  (daysAgo: number): [string, Intensity] => {
    const d = daysAgo % 7;
    if (d === 0 || d === 3) return [hard, 'hard'];
    if (d === 1 || d === 5) return [moderate, 'moderate'];
    if (d === 6) return ['Rest day', 'rest'];
    return [easy, 'easy'];
  };

const steady = (): Shift => ({});

export const DEMO_TOKENS = {
  amara: 'demo-amara',
  hana: 'demo-hana',
  diego: 'demo-diego',
} as const;

const CHARACTERS: Character[] = [
  {
    id: 'demo-amara',
    name: 'Amara',
    sport: 'running',
    squad: 'Endurance',
    usual: { pulse: 52, breath: 13, rmssd: 68, stress: 62, sleep: 7.6 },
    feel: 4,
    token: DEMO_TOKENS.amara,
    showNumbers: true,
    notes: 'Marathon in nine weeks. Tends to push through heavy weeks.',
    // A heavy block dips, a coach-ordered easy week recovers it, and now a new block is starting.
    story: (d) => {
      if (d >= 14 && d <= 18) return { pulse: 7, rmssd: -18, stress: 28, sleep: -0.8, feel: -1 };
      if (d === 0) return { pulse: 9, rmssd: -24, stress: 42, breath: 2, sleep: -2.4, feel: -2 };
      if (d === 1) return { pulse: 4, rmssd: -9, stress: 12, sleep: -0.8 };
      return {};
    },
    plan: (d) => {
      if (d >= 7 && d <= 13) return ['Easy run, 40 min', 'easy'];
      return weekly('Track intervals, 8 x 800 m', 'Steady run, 60 min', 'Easy run, 45 min')(d);
    },
    today: ['Track intervals, 8 x 800 m', 'hard'],
  },
  {
    id: 'demo-kasun',
    name: 'Kasun',
    sport: 'cycling',
    squad: 'Endurance',
    usual: { pulse: 48, breath: 12, rmssd: 78, stress: 54, sleep: 7.8 },
    feel: 4,
    token: 'demo-kasun',
    notes: 'Back from the Colombo trip last week.',
    // Long-haul travel: three days off usual, then back.
    story: (d) => (d >= 8 && d <= 10 ? { pulse: 6, rmssd: -14, stress: 20, sleep: -2 } : {}),
    plan: weekly('Hill repeats, 90 min', 'Endurance ride, 2 h', 'Spin, 45 min'),
    today: ['Endurance ride, 2 h', 'moderate'],
  },
  {
    id: 'demo-noor',
    name: 'Noor',
    sport: 'lifting',
    squad: 'Strength',
    usual: { pulse: 62, breath: 14, rmssd: 52, stress: 88, sleep: 8 },
    feel: 4,
    token: 'demo-noor',
    story: steady,
    plan: weekly('Heavy squat day', 'Bench and accessories', 'Mobility, 30 min'),
    today: ['Heavy squat day', 'hard'],
  },
  {
    id: 'demo-diego',
    name: 'Diego',
    sport: 'triathlon',
    squad: 'Endurance',
    usual: { pulse: 50, breath: 13, rmssd: 70, stress: 60, sleep: 7 },
    feel: 3,
    token: DEMO_TOKENS.diego,
    notes: 'Travels for work. Checks in when he remembers.',
    // Rarely checks in: the board has to handle gaps.
    story: (d) => ({ skip: d % 4 !== 3 }),
    plan: weekly('Brick session', 'Swim, 3 km', 'Easy spin, 40 min'),
    today: ['Swim, 3 km', 'moderate'],
  },
  {
    id: 'demo-mei',
    name: 'Mei',
    sport: 'swimming',
    squad: 'Endurance',
    usual: { pulse: 54, breath: 12, rmssd: 74, stress: 58, sleep: 8.2 },
    feel: 4,
    token: 'demo-mei',
    story: steady,
    plan: weekly('Threshold set, 4 km', 'Technique, 3 km', 'Recovery swim, 2 km'),
    today: ['Threshold set, 4 km', 'hard'],
  },
  {
    id: 'demo-tomasz',
    name: 'Tomasz',
    sport: 'rowing',
    squad: 'Endurance',
    usual: { pulse: 58, breath: 14, rmssd: 48, stress: 92, sleep: 7.2 },
    feel: 4,
    token: 'demo-tomasz',
    notes: 'Moving house this month.',
    // Numbers are fine, but three mornings of feeling flat.
    story: (d) => (d <= 2 ? { feel: -3, sleep: -1 } : {}),
    plan: weekly('Erg intervals, 5 x 1 km', 'Steady row, 60 min', 'Easy row, 30 min'),
    today: ['Erg intervals, 5 x 1 km', 'hard'],
  },
  {
    id: 'demo-priya',
    name: 'Priya',
    sport: 'climbing',
    squad: 'Strength',
    usual: { pulse: 60, breath: 14, rmssd: 56, stress: 80, sleep: 7.5 },
    feel: 4,
    token: 'demo-priya',
    story: steady,
    plan: weekly('Limit bouldering', 'Fingerboard session', 'Easy traverse, 40 min'),
    today: ['Fingerboard session', 'moderate'],
  },
  {
    id: 'demo-jonah',
    name: 'Jonah',
    sport: 'football',
    squad: 'Team',
    usual: { pulse: 58, breath: 14, rmssd: 60, stress: 74, sleep: 8 },
    feel: 4,
    token: 'demo-jonah',
    // Joined three days ago, so Roll Call is still learning his usual.
    story: (d) => ({ skip: d > 2 }),
    plan: weekly('Small-sided games', 'Team training', 'Light jog, 30 min'),
    today: ['Team training', 'moderate'],
  },
  {
    id: 'demo-freya',
    name: 'Freya',
    sport: 'running',
    squad: 'Endurance',
    usual: { pulse: 56, breath: 13, rmssd: 46, stress: 96, sleep: 7.8 },
    feel: 4,
    token: 'demo-freya',
    story: steady,
    plan: weekly('Tempo run, 8 km', 'Long run, 14 km', 'Easy run, 6 km'),
    today: ['Easy run, 6 km', 'easy'],
  },
  {
    id: 'demo-hana',
    name: 'Hana',
    sport: 'triathlon',
    squad: 'Endurance',
    // Matches the recording her Judge Mode check-in replays, so it lands as Ready.
    usual: { pulse: 69, breath: 14, rmssd: 52, stress: 86, sleep: 7.6 },
    feel: 4,
    token: DEMO_TOKENS.hana,
    // Hasn't checked in yet today. Judge Mode's replayed check-in is hers.
    story: (d) => ({ skip: d === 0 }),
    plan: weekly('Bike intervals, 75 min', 'Run off the bike', 'Swim drills, 2 km'),
    today: ['Run off the bike', 'moderate'],
  },
  {
    id: 'demo-sione',
    name: 'Sione',
    sport: 'lifting',
    squad: 'Strength',
    usual: { pulse: 66, breath: 15, rmssd: 44, stress: 104, sleep: 7.4 },
    feel: 4,
    token: 'demo-sione',
    story: steady,
    plan: weekly('Clean and jerk, heavy', 'Snatch technique', 'Mobility, 30 min'),
    today: ['Snatch technique', 'moderate'],
  },
  {
    id: 'demo-elif',
    name: 'Elif',
    sport: 'cycling',
    squad: 'Endurance',
    usual: { pulse: 50, breath: 12, rmssd: 72, stress: 58, sleep: 8 },
    feel: 5,
    token: 'demo-elif',
    story: steady,
    plan: weekly('VO2 intervals, 75 min', 'Group ride, 2 h', 'Coffee spin, 45 min'),
    today: ['Coffee spin, 45 min', 'easy'],
  },
];

const round = (v: number, places = 1): number => Math.round(v * 10 ** places) / 10 ** places;

export async function seedDemo(db: Db, today: string): Promise<void> {
  const existing = await db.select({ id: athletes.id }).from(athletes).where(eq(athletes.workspace, 'demo'));
  const ids = existing.map((a) => a.id);
  if (ids.length) {
    await db.delete(checkins).where(inArray(checkins.athleteId, ids));
    await db.delete(plans).where(inArray(plans.athleteId, ids));
    await db.delete(messages).where(inArray(messages.athleteId, ids));
    await db.delete(athletes).where(inArray(athletes.id, ids));
  }
  await db
    .insert(settings)
    .values({ workspace: 'demo', style: 'warm' })
    .onConflictDoUpdate({ target: settings.workspace, set: { style: 'warm' } });

  for (const [index, c] of CHARACTERS.entries()) {
    await db.insert(athletes).values({
      id: c.id,
      workspace: 'demo',
      name: c.name,
      sport: c.sport,
      squad: c.squad,
      avatar: `avatar_${c.name.toLowerCase()}`,
      token: c.token,
      showNumbers: c.showNumbers ?? false,
      notes: c.notes ?? '',
      consentAt: `${addDays(today, -28)}T06:00:00Z`,
    });
    const rng = makeRng(1000 + index * 37);
    const planRows: (typeof plans.$inferInsert)[] = [];
    const rows: (typeof checkins.$inferInsert)[] = [];
    for (let d = 27; d >= 0; d--) {
      const date = addDays(today, -d);
      const [title, intensity] = d === 0 ? c.today : c.plan(d);
      planRows.push({ athleteId: c.id, date, title, intensity });
      const jitter = (size: number): number => (rng() - 0.5) * 2 * size;
      const shift = c.story(d, rng);
      // Noise is drawn even on skipped days, so one story never changes another day's numbers.
      const noise = {
        pulse: jitter(1.5),
        breath: jitter(0.6),
        rmssd: jitter(3),
        stress: jitter(5),
        sleep: jitter(0.4),
      };
      if (shift.skip) continue;
      const u = c.usual;
      const pulse = round(u.pulse + (shift.pulse ?? 0) + noise.pulse);
      const rmssd = round(u.rmssd + (shift.rmssd ?? 0) + noise.rmssd);
      rows.push({
        id: `${c.id}-${date}`,
        athleteId: c.id,
        date,
        kind: 'morning',
        source: 'demo',
        pulse,
        pulseConf: 0.9,
        breath: round(u.breath + (shift.breath ?? 0) + noise.breath),
        breathConf: 0.85,
        rmssd,
        sdnn: round(rmssd * 1.25),
        meanNn: round(60000 / pulse),
        stress: round(u.stress + (shift.stress ?? 0) + noise.stress),
        hrvConf: 0.8,
        sleep: Math.round((u.sleep + (shift.sleep ?? 0) + noise.sleep) * 2) / 2,
        feel: Math.max(1, Math.min(5, c.feel + (shift.feel ?? 0))),
        createdAt: `${date}T06:${String(10 + index * 3).padStart(2, '0')}:00Z`,
      });
      // Settle checks after harder sessions, for athletes who keep them up.
      if (index % 2 === 0 && d > 0 && (intensity === 'hard' || intensity === 'moderate')) {
        rows.push({
          id: `${c.id}-${date}-settle`,
          athleteId: c.id,
          date,
          kind: 'settle',
          source: 'demo',
          pulse: round(u.pulse + (intensity === 'hard' ? 22 : 12) + jitter(3)),
          pulseConf: 0.8,
          breath: round(u.breath + 3 + jitter(1)),
          breathConf: 0.8,
          minutesAfter: intensity === 'hard' ? 10 : 5,
          sessionIntensity: intensity,
          createdAt: `${date}T18:00:00Z`,
        });
      }
    }
    await db.insert(plans).values(planRows);
    if (rows.length) await db.insert(checkins).values(rows);
  }

  await db.insert(messages).values({
    id: 'demo-msg-amara-1',
    athleteId: 'demo-amara',
    date: addDays(today, -13),
    action: 'easy',
    body: 'Amara, your last few mornings have run well below your usual. Easy week starting today, no arguments. You have earned it.',
    sentAt: `${addDays(today, -13)}T06:40:00Z`,
    readAt: `${addDays(today, -13)}T07:05:00Z`,
  });
}
