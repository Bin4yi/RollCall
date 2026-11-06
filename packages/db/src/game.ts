import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  advanceDay,
  BUILDING_WORDS,
  BUILDINGS,
  campGrowth,
  contestedKeys,
  CREW_SIZE,
  crewStreak,
  hexKey,
  HOME_SLOTS,
  LEAGUE_TIERS,
  nextBuilding,
  nextStage,
  POINT_WORDS,
  rankSeason,
  scoreDay,
  seasonWeek,
  tileCounts,
  valley,
  type CrewDay,
  type MapState,
  type PointReason,
  type Recap,
} from '@rollcall/crews';
import {
  assessHistory,
  buildInsights,
  CONFIDENCE,
  isSmartCall,
  legsState,
  planUsesLegs,
  READINESS,
  todaysCall,
  type Choice,
  type DayReading,
  type Insight,
  type LegsState,
  type SessionFact,
  type Status,
  type TodaysCall,
} from '@rollcall/readiness';
import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { addDays, type Db } from './index';
import { toReading } from './read';
import { athletes, checkins, plans, type Intensity, type Workspace } from './schema';
import {
  auditLog,
  balanceTests,
  camps,
  crewInvites,
  crewMembers,
  crews,
  dailyCalls,
  jumps,
  leagues,
  legsDays,
  mapTiles,
  nudges,
  pointsLedger,
  reps,
  seasons,
  sets,
  tileClaims,
  trainSessions,
  type PoseSource,
} from './schema-game';

/** The WebSocket server listens here, so the feed and map update live. */
export const gameEvents = new EventEmitter();
gameEvents.setMaxListeners(0);

const nowIso = (): string => new Date().toISOString();

export async function audit(db: Db, athleteId: string | null, action: string, detail = ''): Promise<void> {
  await db.insert(auditLog).values({ id: randomUUID(), at: nowIso(), athleteId, action, detail });
}

type AthleteRow = typeof athletes.$inferSelect;

export const DEFAULT_PLAN = { title: 'Your usual session', intensity: 'moderate' as Intensity };

/** Morning readings with the day's jump added. */
export async function readingsWithJumps(db: Db, athleteId: string, upTo: string): Promise<DayReading[]> {
  const rows = await db
    .select()
    .from(checkins)
    .where(and(eq(checkins.athleteId, athleteId), eq(checkins.kind, 'morning'), lte(checkins.date, upTo)));
  const legs = await db.select().from(legsDays).where(eq(legsDays.athleteId, athleteId));
  const best = new Map(legs.filter((l) => l.bestM !== null).map((l) => [l.date, l.bestM!]));
  return rows.map((r) => {
    const reading = toReading(r);
    const jump = best.get(r.date);
    if (jump !== undefined) reading.jump = jump;
    return reading;
  });
}

/** The heart line leaves jump out, so the two lines stay separate facts. */
export function heartStatusOn(readings: readonly DayReading[], date: string): Status | null {
  const heartOnly = readings.map(({ jump: _jump, ...rest }) => rest);
  return assessHistory(heartOnly).find((a) => a.date === date)?.status ?? null;
}

async function legsFor(db: Db, athleteId: string, date: string): Promise<LegsState> {
  const rows = await db
    .select()
    .from(legsDays)
    .where(and(eq(legsDays.athleteId, athleteId), lte(legsDays.date, date)));
  const today = rows.find((r) => r.date === date);
  const from = addDays(date, -READINESS.baselineDays);
  const past = rows.filter((r) => r.date < date && r.date >= from && r.bestM !== null).map((r) => r.bestM!);
  return legsState(past, today?.bestM ?? null, today?.kind === 'skipped');
}

const planFor = async (db: Db, athleteId: string, date: string) => {
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), eq(plans.date, date)));
  return row ? { title: row.title, intensity: row.intensity } : DEFAULT_PLAN;
};

export interface TodayView {
  heartStatus: Status | null;
  legs: LegsState;
  legsDone: boolean;
  legsKind: 'jumps' | 'balance' | 'skipped' | null;
  call: TodaysCall | null;
  chosen: { choice: string; intensity: string; done: boolean; listened: boolean; suggestion: string } | null;
  gentleCard: boolean;
  nudged: boolean;
  plan: { title: string; intensity: Intensity };
}

export async function loadToday(db: Db, a: AthleteRow, date: string): Promise<TodayView> {
  const readings = await readingsWithJumps(db, a.id, date);
  const heartStatus = heartStatusOn(readings, date);
  const legs = await legsFor(db, a.id, date);
  const [legsRow] = await db
    .select()
    .from(legsDays)
    .where(and(eq(legsDays.athleteId, a.id), eq(legsDays.date, date)));
  const plan = await planFor(db, a.id, date);
  const [call] = await db
    .select()
    .from(dailyCalls)
    .where(and(eq(dailyCalls.athleteId, a.id), eq(dailyCalls.date, date)));
  const [nudge] = await db
    .select()
    .from(nudges)
    .where(and(eq(nudges.toId, a.id), eq(nudges.date, date)));
  const assessed = assessHistory(readings).at(-1);
  return {
    heartStatus,
    legs,
    legsDone: !!legsRow,
    legsKind: legsRow?.kind ?? null,
    call: heartStatus ? todaysCall(heartStatus, legs, plan, a.sport) : null,
    chosen: call
      ? { choice: call.choice, intensity: call.intensity, done: !!call.doneAt, listened: call.listened, suggestion: call.suggestion }
      : null,
    // Shown only to this person. Nothing about it reaches the crew.
    gentleCard: assessed?.date === date && assessed.gentleNudge,
    nudged: !!nudge && !heartStatus,
    plan,
  };
}

/** Chooses for today. The server works out whether it was a smart call: the client can't say so. */
export async function chooseToday(db: Db, a: AthleteRow, date: string, choice: Choice): Promise<TodayView | null> {
  const view = await loadToday(db, a, date);
  if (!view.heartStatus || !view.call) return null;
  const option = view.call.options.find((o) => o.choice === choice);
  if (!option) return null;
  const listened = isSmartCall(view.heartStatus, view.legs, view.plan, option.intensity, a.sport);
  const row = {
    heart: view.heartStatus,
    legs: view.legs.kind,
    suggestion: view.call.suggestion,
    choice,
    intensity: option.intensity,
    plannedIntensity: view.plan.intensity,
    listened,
    chosenAt: nowIso(),
  };
  await db
    .insert(dailyCalls)
    .values({ athleteId: a.id, date, ...row })
    .onConflictDoUpdate({ target: [dailyCalls.athleteId, dailyCalls.date], set: row });
  await awardPoints(db, a, date);
  return loadToday(db, a, date);
}

export async function markDone(db: Db, a: AthleteRow, date: string): Promise<boolean> {
  const [call] = await db
    .select()
    .from(dailyCalls)
    .where(and(eq(dailyCalls.athleteId, a.id), eq(dailyCalls.date, date)));
  if (!call) return false;
  await db
    .update(dailyCalls)
    .set({ doneAt: call.doneAt ?? nowIso() })
    .where(and(eq(dailyCalls.athleteId, a.id), eq(dailyCalls.date, date)));
  await awardPoints(db, a, date);
  return true;
}

export interface JumpInput {
  flightMs: number;
  heightM: number;
  hipRiseM: number;
  kneeAtTakeoff: number;
  kneeAtLanding: number;
  airFrames: number;
  fps: number;
  valid: boolean;
  problem?: string | undefined;
}

export async function saveLegs(
  db: Db,
  a: AthleteRow,
  date: string,
  input: { kind: 'jumps'; jumps: JumpInput[]; source: PoseSource } | { kind: 'skipped'; source: PoseSource },
): Promise<void> {
  await db.delete(jumps).where(and(eq(jumps.athleteId, a.id), eq(jumps.date, date)));
  let bestM: number | null = null;
  let fps: number | null = null;
  if (input.kind === 'jumps') {
    const valid = input.jumps.filter((j) => j.valid);
    bestM = valid.length ? Math.max(...valid.map((j) => j.heightM)) : null;
    fps = input.jumps[0]?.fps ?? null;
    if (input.jumps.length) {
      await db.insert(jumps).values(
        input.jumps.map((j, i) => ({
          id: randomUUID(),
          athleteId: a.id,
          date,
          n: i + 1,
          flightMs: j.flightMs,
          heightM: j.heightM,
          hipRiseM: j.hipRiseM,
          kneeAtTakeoff: j.kneeAtTakeoff,
          kneeAtLanding: j.kneeAtLanding,
          airFrames: j.airFrames,
          fps: j.fps,
          valid: j.valid,
          problem: j.problem ?? null,
        })),
      );
    }
  }
  const row = { kind: input.kind, bestM, fps, source: input.source, createdAt: nowIso() };
  await db
    .insert(legsDays)
    .values({ athleteId: a.id, date, ...row })
    .onConflictDoUpdate({ target: [legsDays.athleteId, legsDays.date], set: row });
  await awardPoints(db, a, date);
}

export async function saveBalance(
  db: Db,
  a: AthleteRow,
  date: string,
  results: { side: 'left' | 'right'; swayPct: number; touches: number; seconds: number }[],
  source: PoseSource,
): Promise<void> {
  await db.delete(balanceTests).where(and(eq(balanceTests.athleteId, a.id), eq(balanceTests.date, date)));
  await db.insert(balanceTests).values(results.map((r) => ({ id: randomUUID(), athleteId: a.id, date, source, ...r })));
  const row = { kind: 'balance' as const, bestM: null, fps: null, source, createdAt: nowIso() };
  await db
    .insert(legsDays)
    .values({ athleteId: a.id, date, ...row })
    .onConflictDoUpdate({ target: [legsDays.athleteId, legsDays.date], set: row });
  await awardPoints(db, a, date);
}

/**
 * Appends whatever a person has newly earned today, worked out only from stored rows. Nothing a client
 * sends can name a reason or an amount. A heart check-in counts only from a live reading with good
 * confidence; Judge Mode's fictional athletes count replays, and their data is walled off from real crews.
 */
export async function awardPoints(db: Db, a: AthleteRow, date: string): Promise<void> {
  const rows = await db
    .select()
    .from(checkins)
    .where(and(eq(checkins.athleteId, a.id), eq(checkins.date, date)));
  const realSource = (source: string): boolean => source === 'live' || a.workspace === 'demo';
  const good = (r: (typeof rows)[number] | undefined): boolean =>
    !!r && realSource(r.source) && r.pulse !== null && (r.pulseConf ?? 0) >= CONFIDENCE.pulse;
  const [legs] = await db
    .select()
    .from(legsDays)
    .where(and(eq(legsDays.athleteId, a.id), eq(legsDays.date, date)));
  const [call] = await db
    .select()
    .from(dailyCalls)
    .where(and(eq(dailyCalls.athleteId, a.id), eq(dailyCalls.date, date)));
  const entries = scoreDay({
    realHeartCheckin: good(rows.find((r) => r.kind === 'morning')),
    legsOrBalance: !!legs && realSource(legs.source) && legs.kind !== 'skipped' && (legs.kind === 'balance' || legs.bestM !== null),
    listened: call?.listened ?? false,
    followedThrough: !!call?.doneAt,
    settle: good(rows.find((r) => r.kind === 'settle')),
  });
  for (const e of entries) {
    const inserted = await db
      .insert(pointsLedger)
      .values({ id: randomUUID(), athleteId: a.id, date, reason: e.reason, points: e.points, createdAt: nowIso() })
      .onConflictDoNothing()
      .returning({ id: pointsLedger.id });
    if (inserted.length) await audit(db, a.id, 'points', `${date} ${e.reason} +${e.points}`);
  }
  await growCamp(db, a.id);
  const [member] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, a.id));
  if (!member) return;
  const [crew] = await db.select().from(crews).where(eq(crews.id, member.crewId));
  if (!crew) return;
  await settleLeague(db, crew.leagueId, date);
  gameEvents.emit('league', crew.leagueId);
}

async function growCamp(db: Db, athleteId: string): Promise<number> {
  const entries = await db.select().from(pointsLedger).where(eq(pointsLedger.athleteId, athleteId));
  const growth = campGrowth(entries.filter((e) => e.reason === 'heart').length, entries.filter((e) => e.reason === 'listened').length);
  const [row] = await db.select().from(camps).where(eq(camps.athleteId, athleteId));
  const stage = nextStage(row?.stage ?? 0, growth);
  await db
    .insert(camps)
    .values({ athleteId, stage, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: camps.athleteId, set: { stage, updatedAt: nowIso() } });
  return growth;
}

export interface CampView {
  name: string;
  stage: number;
  buildings: { id: string; name: string }[];
  next: { name: string; left: number } | null;
}

/** Buildings only. Never any reading. */
export async function loadCamp(db: Db, athleteId: string): Promise<CampView | null> {
  const [a] = await db.select().from(athletes).where(eq(athletes.id, athleteId));
  if (!a) return null;
  const growth = await growCamp(db, athleteId);
  const [row] = await db.select().from(camps).where(eq(camps.athleteId, athleteId));
  const stage = row?.stage ?? 0;
  const next = nextBuilding(stage, growth);
  return {
    name: a.name,
    stage,
    buildings: BUILDINGS.slice(0, stage).map((id) => ({ id, name: BUILDING_WORDS[id] })),
    next: next ? { name: BUILDING_WORDS[next.name], left: next.left } : null,
  };
}

export const startSession = async (db: Db, a: AthleteRow, date: string, source: PoseSource): Promise<string> => {
  const today = await loadToday(db, a, date);
  const id = randomUUID();
  const title = today.chosen?.choice === 'upper' ? 'Easy upper body' : today.plan.title;
  await db.insert(trainSessions).values({
    id,
    athleteId: a.id,
    date,
    title,
    intensity: (today.chosen?.intensity as Intensity | undefined) ?? today.plan.intensity,
    morningStatus: today.heartStatus ?? 'waiting',
    legsKind: today.legs.kind,
    source,
    startedAt: nowIso(),
  });
  return id;
};

export interface SetInput {
  exercise: string;
  reps: number;
  partials: number;
  fastest: number;
  slowest: number;
  speedDrop: number;
  avgDepth: number;
  flagCounts: Record<string, number>;
  stopSuggestedAt: number | null;
  holdSeconds?: number | undefined;
  sagShare?: number | undefined;
  durationMs: number;
  repList: { n: number; speed: number; drop: number; depth: number; durationMs: number; flags: string[] }[];
}

export async function saveSet(db: Db, athleteId: string, sessionId: string, input: SetInput): Promise<boolean> {
  const [session] = await db
    .select()
    .from(trainSessions)
    .where(and(eq(trainSessions.id, sessionId), eq(trainSessions.athleteId, athleteId)));
  if (!session) return false;
  const existing = await db.select({ id: sets.id }).from(sets).where(eq(sets.sessionId, sessionId));
  const id = randomUUID();
  await db.insert(sets).values({
    id,
    sessionId,
    n: existing.length + 1,
    exercise: input.exercise,
    reps: input.reps,
    partials: input.partials,
    fastest: input.fastest,
    slowest: input.slowest,
    speedDrop: input.speedDrop,
    avgDepth: input.avgDepth,
    flags: JSON.stringify(input.flagCounts),
    stopSuggestedAt: input.stopSuggestedAt,
    holdSeconds: input.holdSeconds ?? null,
    sagShare: input.sagShare ?? null,
    durationMs: input.durationMs,
  });
  if (input.repList.length) {
    await db.insert(reps).values(input.repList.map((r) => ({ ...r, id: randomUUID(), setId: id, flags: JSON.stringify(r.flags) })));
  }
  return true;
}

export async function finishSession(db: Db, a: AthleteRow, sessionId: string, date: string): Promise<boolean> {
  const [session] = await db
    .select()
    .from(trainSessions)
    .where(and(eq(trainSessions.id, sessionId), eq(trainSessions.athleteId, a.id)));
  if (!session) return false;
  await db.update(trainSessions).set({ finishedAt: nowIso() }).where(eq(trainSessions.id, sessionId));
  // A finished session is the logged session they chose.
  await markDone(db, a, date);
  return true;
}

export async function loadInsights(db: Db, athleteId: string): Promise<Insight[]> {
  const sessions = await db.select().from(trainSessions).where(eq(trainSessions.athleteId, athleteId));
  const ids = sessions.map((s) => s.id);
  const allSets = ids.length ? await db.select().from(sets).where(inArray(sets.sessionId, ids)) : [];
  const calls = await db.select().from(dailyCalls).where(eq(dailyCalls.athleteId, athleteId));
  const callOn = new Map(calls.map((c) => [c.date, c]));
  const rank: Record<string, number> = { rest: 0, easy: 1, moderate: 2, hard: 3 };
  const facts: SessionFact[] = allSets.flatMap((s) => {
    const session = sessions.find((x) => x.id === s.sessionId);
    if (!session || s.reps === 0) return [];
    const call = callOn.get(session.date);
    const suggestedEasier = !!call && call.suggestion !== 'planned';
    const wentEasier = !!call && rank[call.intensity]! < rank[call.plannedIntensity]!;
    return [
      {
        date: session.date,
        exercise: s.exercise,
        status: session.morningStatus,
        speedDrop: s.speedDrop,
        avgDepth: s.avgDepth,
        followedEasier: suggestedEasier && wentEasier,
        ignoredEasier: suggestedEasier && !wentEasier,
        usesLegs: ['squat', 'goblet', 'lunge', 'bridge'].includes(s.exercise),
        hard: session.intensity === 'hard',
      },
    ];
  });
  const legs = await db.select().from(legsDays).where(eq(legsDays.athleteId, athleteId));
  const today = legs.map((l) => l.date).sort().at(-1) ?? '9999-12-31';
  const readings = await readingsWithJumps(db, athleteId, today);
  const heart = assessHistory(readings.map(({ jump: _j, ...r }) => r)).map((x) => ({ date: x.date, status: x.status }));
  return buildInsights(
    facts,
    legs.filter((l) => l.bestM !== null).map((l) => ({ date: l.date, heightM: l.bestM! })),
    heart,
  );
}

export const CREW_COLOURS = ['#FF6B5B', '#3FB8AF', '#2B2A6B', '#FFB37A', '#B8352A', '#17706A'] as const;

export const inviteCode = (): string => randomBytes(4).toString('hex').toUpperCase();

/** The lowest league with a free home slot, for a workspace. */
async function leagueWithRoom(db: Db, workspace: Workspace): Promise<{ id: string; slot: number }> {
  const all = await db.select().from(leagues).where(eq(leagues.workspace, workspace));
  for (const l of all.filter((x) => x.tier === 0)) {
    const inLeague = await db.select().from(crews).where(eq(crews.leagueId, l.id));
    if (inLeague.length < HOME_SLOTS.length) {
      const taken = new Set(inLeague.map((c) => hexKey({ q: c.homeQ, r: c.homeR })));
      const slot = HOME_SLOTS.findIndex((h) => !taken.has(hexKey(h)));
      return { id: l.id, slot };
    }
  }
  const id = randomUUID();
  await createLeague(db, id, workspace, 0);
  return { id, slot: 0 };
}

export async function createLeague(db: Db, id: string, workspace: Workspace, tier: number): Promise<void> {
  await db.insert(leagues).values({ id, workspace, tier });
  await db.insert(mapTiles).values(valley().map((t) => ({ leagueId: id, q: t.q, r: t.r, kind: t.kind })));
}

async function openSeason(db: Db, leagueId: string, date: string) {
  const open = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.leagueId, leagueId), eq(seasons.status, 'open')));
  const current = open.find((s) => s.start <= date && s.end >= date);
  if (current) return current;
  const week = seasonWeek(date);
  const row = { id: randomUUID(), leagueId, start: week.start, end: week.end, status: 'open' as const, recap: null };
  await db.insert(seasons).values(row);
  return row;
}

export async function createCrew(
  db: Db,
  a: AthleteRow,
  date: string,
  input: { name: string; emblem: string; colour: string },
): Promise<{ id: string; code: string } | { error: string }> {
  const [already] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, a.id));
  if (already) return { error: 'You’re already in a crew. Leave it first.' };
  const room = await leagueWithRoom(db, a.workspace);
  const home = HOME_SLOTS[room.slot]!;
  const id = randomUUID();
  await db.insert(crews).values({
    id,
    workspace: a.workspace,
    leagueId: room.id,
    ownerId: a.id,
    homeQ: home.q,
    homeR: home.r,
    createdAt: nowIso(),
    ...input,
  });
  await db.insert(crewMembers).values({ crewId: id, athleteId: a.id, joinedAt: nowIso() });
  const code = inviteCode();
  await db.insert(crewInvites).values({ code, crewId: id, createdAt: nowIso() });
  await openSeason(db, room.id, date);
  await settleLeague(db, room.id, date);
  await audit(db, a.id, 'crew-create', id);
  gameEvents.emit('league', room.id);
  return { id, code };
}

export async function joinCrew(db: Db, a: AthleteRow, date: string, code: string): Promise<{ id: string } | { error: string }> {
  const [already] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, a.id));
  if (already) return { error: 'You’re already in a crew. Leave it first.' };
  const [invite] = await db.select().from(crewInvites).where(eq(crewInvites.code, code.trim().toUpperCase()));
  if (!invite) return { error: 'That code didn’t match a crew.' };
  const [crew] = await db.select().from(crews).where(eq(crews.id, invite.crewId));
  if (!crew || crew.workspace !== a.workspace) return { error: 'That code didn’t match a crew.' };
  const members = await db.select().from(crewMembers).where(eq(crewMembers.crewId, crew.id));
  if (members.length >= CREW_SIZE.max) return { error: 'That crew is full.' };
  await db.insert(crewMembers).values({ crewId: crew.id, athleteId: a.id, joinedAt: nowIso() });
  await audit(db, a.id, 'crew-join', crew.id);
  await settleLeague(db, crew.leagueId, date);
  gameEvents.emit('league', crew.leagueId);
  return { id: crew.id };
}

/** Leaving takes the person's points with them. An empty crew disappears from the map. */
export async function leaveCrew(db: Db, athleteId: string, date: string): Promise<void> {
  const [member] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, athleteId));
  if (!member) return;
  await db.delete(crewMembers).where(eq(crewMembers.athleteId, athleteId));
  const [crew] = await db.select().from(crews).where(eq(crews.id, member.crewId));
  if (!crew) return;
  const left = await db.select().from(crewMembers).where(eq(crewMembers.crewId, crew.id));
  if (!left.length) {
    await db.delete(crewInvites).where(eq(crewInvites.crewId, crew.id));
    await db.delete(tileClaims).where(eq(tileClaims.crewId, crew.id));
    await db.delete(crews).where(eq(crews.id, crew.id));
  } else if (crew.ownerId === athleteId) {
    const next = [...left].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0]!;
    await db.update(crews).set({ ownerId: next.athleteId }).where(eq(crews.id, crew.id));
  }
  await audit(db, athleteId, 'crew-leave', crew.id);
  await settleLeague(db, crew.leagueId, date);
  gameEvents.emit('league', crew.leagueId);
}

const meanPoints = (crewId: string, members: { crewId: string; athleteId: string }[], ledger: { athleteId: string; date: string; points: number }[], date: string): number => {
  const own = members.filter((m) => m.crewId === crewId);
  if (!own.length) return 0;
  const ids = new Set(own.map((m) => m.athleteId));
  return ledger.filter((e) => e.date === date && ids.has(e.athleteId)).reduce((s, e) => s + e.points, 0) / own.length;
};

/** Brings a league's map up to `date`, day by day. Safe to call as often as you like. */
export async function settleLeague(db: Db, leagueId: string, date: string): Promise<void> {
  const season = await openSeason(db, leagueId, date);
  const inLeague = await db.select().from(crews).where(eq(crews.leagueId, leagueId));
  const ids = inLeague.map((c) => c.id);
  const members = ids.length ? await db.select().from(crewMembers).where(inArray(crewMembers.crewId, ids)) : [];
  const people = members.map((m) => m.athleteId);
  const ledger = people.length
    ? await db
        .select()
        .from(pointsLedger)
        .where(and(inArray(pointsLedger.athleteId, people), gte(pointsLedger.date, addDays(season.start, -1)), lte(pointsLedger.date, date)))
    : [];
  const [last] = await db
    .select()
    .from(tileClaims)
    .where(and(eq(tileClaims.seasonId, season.id), lt(tileClaims.date, date)))
    .orderBy(desc(tileClaims.date))
    .limit(1);
  const startDate = last ? addDays(last.date, 1) : season.start;
  let state: MapState = new Map();
  if (last) {
    const rows = await db
      .select()
      .from(tileClaims)
      .where(and(eq(tileClaims.seasonId, season.id), eq(tileClaims.date, last.date)));
    state = new Map(rows.map((r) => [hexKey(r), { crewId: r.crewId, light: r.light }]));
  }
  for (let day = startDate; day <= date; day = addDays(day, 1)) {
    const crewDays: CrewDay[] = inLeague.map((c) => ({
      id: c.id,
      home: { q: c.homeQ, r: c.homeR },
      score: meanPoints(c.id, members, ledger, day),
      yesterday: meanPoints(c.id, members, ledger, addDays(day, -1)),
    }));
    const { state: next, claims } = advanceDay(state, crewDays);
    await db.delete(tileClaims).where(and(eq(tileClaims.seasonId, season.id), eq(tileClaims.date, day)));
    const rows = [...next].map(([key, tile]) => {
      const [q, r] = key.split(',').map(Number) as [number, number];
      const claim = claims.find((x) => hexKey(x.hex) === key);
      return {
        seasonId: season.id,
        date: day,
        q,
        r,
        crewId: tile.crewId,
        light: tile.light,
        takenFrom: claim?.from ?? null,
        claimedToday: !!claim,
      };
    });
    if (rows.length) await db.insert(tileClaims).values(rows);
    state = next;
  }
}

export interface FeedMember {
  id: string;
  name: string;
  avatar: string | null;
  checkedIn: boolean;
  isYou: boolean;
  /** Only present if that member allows it. */
  points?: number;
  streak?: number;
  canNudge: boolean;
}

/** The crew feed. Check-in status, points and streaks only: never a reading. Tests enforce this. */
export interface CrewFeed {
  crew: { id: string; name: string; emblem: string; colour: string; code: string; ownerIsYou: boolean; league: string };
  members: FeedMember[];
  checkedIn: number;
  total: number;
  crewStreak: number;
  needsMore: number;
  mine: { today: { reason: string; words: string; points: number }[]; season: number; showPoints: boolean; showStreak: boolean };
}

const dayStreak = (dates: Set<string>, today: string): number => {
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!dates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let n = 0;
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    n++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return n;
};

export async function loadCrewFeed(db: Db, athleteId: string, date: string): Promise<CrewFeed | null> {
  const [me] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, athleteId));
  if (!me) return null;
  const [crew] = await db.select().from(crews).where(eq(crews.id, me.crewId));
  if (!crew) return null;
  const [league] = await db.select().from(leagues).where(eq(leagues.id, crew.leagueId));
  const season = await openSeason(db, crew.leagueId, date);
  const [invite] = await db.select().from(crewInvites).where(eq(crewInvites.crewId, crew.id));
  const members = await db.select().from(crewMembers).where(eq(crewMembers.crewId, crew.id));
  const ids = members.map((m) => m.athleteId);
  const people = await db.select({ id: athletes.id, name: athletes.name, avatar: athletes.avatar }).from(athletes).where(inArray(athletes.id, ids));
  // Dates only: this query deliberately selects no reading columns.
  const days = await db
    .select({ athleteId: checkins.athleteId, date: checkins.date })
    .from(checkins)
    .where(and(inArray(checkins.athleteId, ids), eq(checkins.kind, 'morning')));
  const ledger = await db
    .select()
    .from(pointsLedger)
    .where(and(inArray(pointsLedger.athleteId, ids), gte(pointsLedger.date, season.start), lte(pointsLedger.date, date)));
  const nudged = await db.select().from(nudges).where(and(inArray(nudges.toId, ids), eq(nudges.date, date)));

  const byDate = new Map<string, number>();
  for (const d of days) byDate.set(d.date, (byDate.get(d.date) ?? 0) + 1);

  const feedMembers: FeedMember[] = members.map((m) => {
    const person = people.find((p) => p.id === m.athleteId);
    const dates = new Set(days.filter((d) => d.athleteId === m.athleteId).map((d) => d.date));
    const checkedIn = dates.has(date);
    const isYou = m.athleteId === athleteId;
    const out: FeedMember = {
      id: m.athleteId,
      name: person?.name ?? 'Teammate',
      avatar: person?.avatar ?? null,
      checkedIn,
      isYou,
      canNudge: !isYou && !checkedIn && !nudged.some((n) => n.toId === m.athleteId),
    };
    if (m.showPoints || isYou) out.points = ledger.filter((e) => e.athleteId === m.athleteId).reduce((s, e) => s + e.points, 0);
    if (m.showStreak || isYou) out.streak = dayStreak(dates, date);
    return out;
  });
  feedMembers.sort((a, b) => Number(b.isYou) - Number(a.isYou) || (b.points ?? -1) - (a.points ?? -1) || a.name.localeCompare(b.name));
  const mine = ledger.filter((e) => e.athleteId === athleteId);
  return {
    crew: {
      id: crew.id,
      name: crew.name,
      emblem: crew.emblem,
      colour: crew.colour,
      code: invite?.code ?? '',
      ownerIsYou: crew.ownerId === athleteId,
      league: LEAGUE_TIERS[league?.tier ?? 0] ?? 'Dawn',
    },
    members: feedMembers,
    checkedIn: feedMembers.filter((m) => m.checkedIn).length,
    total: feedMembers.length,
    crewStreak: crewStreak(byDate, members.length, date),
    needsMore: Math.max(0, 3 - members.length),
    mine: {
      today: mine
        .filter((e) => e.date === date)
        .map((e) => ({ reason: e.reason, words: POINT_WORDS[e.reason as PointReason] ?? e.reason, points: e.points })),
      season: mine.reduce((s, e) => s + e.points, 0),
      showPoints: me.showPoints,
      showStreak: me.showStreak,
    },
  };
}

export async function sendNudge(db: Db, from: AthleteRow, toId: string, date: string): Promise<{ ok: true; to: AthleteRow } | { error: string }> {
  const [me] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, from.id));
  const [them] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, toId));
  if (!me || !them || me.crewId !== them.crewId || toId === from.id) return { error: 'They’re not in your crew.' };
  const done = await db
    .select({ id: checkins.id })
    .from(checkins)
    .where(and(eq(checkins.athleteId, toId), eq(checkins.date, date), eq(checkins.kind, 'morning')));
  if (done.length) return { error: 'They’ve already checked in.' };
  const inserted = await db
    .insert(nudges)
    .values({ id: randomUUID(), fromId: from.id, toId, date })
    .onConflictDoNothing()
    .returning({ id: nudges.id });
  if (!inserted.length) return { error: 'They’ve had their nudge for today.' };
  await audit(db, from.id, 'nudge', toId);
  const [to] = await db.select().from(athletes).where(eq(athletes.id, toId));
  const [crew] = await db.select().from(crews).where(eq(crews.id, me.crewId));
  if (crew) gameEvents.emit('league', crew.leagueId);
  return { ok: true, to: to! };
}

export async function removeMember(db: Db, owner: AthleteRow, memberId: string, date: string): Promise<boolean> {
  const [me] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, owner.id));
  if (!me || memberId === owner.id) return false;
  const [crew] = await db.select().from(crews).where(eq(crews.id, me.crewId));
  const [them] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, memberId));
  if (!crew || crew.ownerId !== owner.id || them?.crewId !== crew.id) return false;
  await leaveCrew(db, memberId, date);
  return true;
}

export interface MapView {
  league: string;
  season: { start: string; end: string; daysLeft: number };
  tiles: { q: number; r: number; kind: string; crewId: string | null; light: number; contested: boolean; claimedToday: boolean; takenFrom: string | null }[];
  crews: { id: string; name: string; emblem: string; colour: string; tiles: number; home: { q: number; r: number }; isYours: boolean; rank: number }[];
  lastTaken: { crewId: string; fromCrewId: string; q: number; r: number } | null;
}

export async function loadMap(db: Db, athleteId: string, date: string): Promise<MapView | null> {
  const [me] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, athleteId));
  if (!me) return null;
  const [crew] = await db.select().from(crews).where(eq(crews.id, me.crewId));
  if (!crew) return null;
  await closeDueSeasons(db, crew.workspace, date);
  const [fresh] = await db.select().from(crews).where(eq(crews.id, crew.id));
  const leagueId = fresh!.leagueId;
  await settleLeague(db, leagueId, date);
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  const season = await openSeason(db, leagueId, date);
  const tiles = await db.select().from(mapTiles).where(eq(mapTiles.leagueId, leagueId));
  const claims = await db
    .select()
    .from(tileClaims)
    .where(and(eq(tileClaims.seasonId, season.id), eq(tileClaims.date, date)));
  const state: MapState = new Map(claims.map((c) => [hexKey(c), { crewId: c.crewId, light: c.light }]));
  const contested = contestedKeys(state);
  const counts = tileCounts(state);
  const inLeague = await db.select().from(crews).where(eq(crews.leagueId, leagueId));
  const ranked = [...inLeague].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const taken = claims.find((c) => c.takenFrom && c.crewId === crew.id) ?? claims.find((c) => c.takenFrom);
  return {
    league: LEAGUE_TIERS[league?.tier ?? 0] ?? 'Dawn',
    season: {
      start: season.start,
      end: season.end,
      daysLeft: Math.round((Date.parse(`${season.end}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000),
    },
    tiles: tiles.map((t) => {
      const c = claims.find((x) => x.q === t.q && x.r === t.r);
      return {
        q: t.q,
        r: t.r,
        kind: t.kind,
        crewId: c?.crewId ?? null,
        light: c?.light ?? 0,
        contested: contested.has(hexKey(t)),
        claimedToday: c?.claimedToday ?? false,
        takenFrom: c?.takenFrom ?? null,
      };
    }),
    crews: ranked.map((c, i) => ({
      id: c.id,
      name: c.name,
      emblem: c.emblem,
      colour: c.colour,
      tiles: counts.get(c.id) ?? 0,
      home: { q: c.homeQ, r: c.homeR },
      isYours: c.id === crew.id,
      rank: i + 1,
    })),
    lastTaken: taken ? { crewId: taken.crewId, fromCrewId: taken.takenFrom!, q: taken.q, r: taken.r } : null,
  };
}

/** The season job: closes finished weeks, moves crews between leagues and writes recap cards. Idempotent. */
export async function closeDueSeasons(db: Db, workspace: Workspace, today: string): Promise<number> {
  const all = await db.select().from(leagues).where(eq(leagues.workspace, workspace));
  let closed = 0;
  for (const league of all) {
    const due = (await db
      .select()
      .from(seasons)
      .where(and(eq(seasons.leagueId, league.id), eq(seasons.status, 'open'))))
      .filter((s) => s.end < today);
    for (const season of due) {
      await settleLeague(db, league.id, season.end);
      const inLeague = await db.select().from(crews).where(eq(crews.leagueId, league.id));
      const claims = await db
        .select()
        .from(tileClaims)
        .where(and(eq(tileClaims.seasonId, season.id), eq(tileClaims.date, season.end)));
      const counts = tileCounts(new Map(claims.map((c) => [hexKey(c), { crewId: c.crewId, light: c.light }])));
      const members = inLeague.length
        ? await db.select().from(crewMembers).where(inArray(crewMembers.crewId, inLeague.map((c) => c.id)))
        : [];
      const ledger = members.length
        ? await db
            .select()
            .from(pointsLedger)
            .where(and(inArray(pointsLedger.athleteId, members.map((m) => m.athleteId)), gte(pointsLedger.date, season.start), lte(pointsLedger.date, season.end)))
        : [];
      const ranked = rankSeason(
        inLeague.map((c) => {
          const ids = new Set(members.filter((m) => m.crewId === c.id).map((m) => m.athleteId));
          return { crewId: c.id, tiles: counts.get(c.id) ?? 0, points: ledger.filter((e) => ids.has(e.athleteId)).reduce((s, e) => s + e.points, 0) };
        }),
        league.tier,
      );
      const recaps: Record<string, Recap> = {};
      for (const r of ranked) {
        const c = inLeague.find((x) => x.id === r.crewId)!;
        const own = members.filter((m) => m.crewId === c.id);
        const smart = own
          .map((m) => ({ id: m.athleteId, n: ledger.filter((e) => e.athleteId === m.athleteId && e.reason === 'listened').length }))
          .sort((a, b) => b.n - a.n)[0];
        const [mvp] = smart ? await db.select({ name: athletes.name }).from(athletes).where(eq(athletes.id, smart.id)) : [];
        const days = await db
          .select({ date: checkins.date })
          .from(checkins)
          .where(and(inArray(checkins.athleteId, own.map((m) => m.athleteId)), eq(checkins.kind, 'morning'), gte(checkins.date, season.start), lte(checkins.date, season.end)));
        const byDate = new Map<string, number>();
        for (const d of days) byDate.set(d.date, (byDate.get(d.date) ?? 0) + 1);
        let bestStreak = 0;
        for (let d = season.start; d <= season.end; d = addDays(d, 1)) bestStreak = Math.max(bestStreak, crewStreak(byDate, own.length, d));
        recaps[c.id] = {
          crewName: c.name,
          league: LEAGUE_TIERS[league.tier] ?? 'Dawn',
          rank: r.rank,
          crews: ranked.length,
          tiles: r.tiles,
          bestStreak,
          mvp: mvp && smart && smart.n > 0 ? { name: mvp.name, smartCalls: smart.n } : null,
          move: r.move,
          seasonStart: season.start,
          seasonEnd: season.end,
        };
        if (r.move !== 'stay') {
          const target = await moveTarget(db, workspace, league.tier + (r.move === 'up' ? 1 : -1), today);
          await db
            .update(crews)
            .set({ leagueId: target.id, homeQ: target.home.q, homeR: target.home.r })
            .where(eq(crews.id, c.id));
        }
      }
      await db.update(seasons).set({ status: 'closed', recap: JSON.stringify(recaps) }).where(eq(seasons.id, season.id));
      await audit(db, null, 'season-close', season.id);
      gameEvents.emit('league', league.id);
      closed++;
    }
  }
  return closed;
}

async function moveTarget(db: Db, workspace: Workspace, tier: number, today: string) {
  const inTier = await db
    .select()
    .from(leagues)
    .where(and(eq(leagues.workspace, workspace), eq(leagues.tier, tier)));
  for (const l of inTier) {
    const members = await db.select().from(crews).where(eq(crews.leagueId, l.id));
    const taken = new Set(members.map((c) => hexKey({ q: c.homeQ, r: c.homeR })));
    const home = HOME_SLOTS.find((h) => !taken.has(hexKey(h)));
    if (home) return { id: l.id, home };
  }
  const id = randomUUID();
  await createLeague(db, id, workspace, tier);
  await openSeason(db, id, today);
  return { id, home: HOME_SLOTS[0]! };
}

/** The latest closed season's card for this person's crew, if there is one. */
export async function loadRecap(db: Db, athleteId: string): Promise<Recap | null> {
  const [me] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, athleteId));
  if (!me) return null;
  const closed = await db.select().from(seasons).where(eq(seasons.status, 'closed')).orderBy(desc(seasons.end));
  for (const s of closed) {
    const recap = s.recap ? (JSON.parse(s.recap) as Record<string, Recap>)[me.crewId] : undefined;
    if (recap) return recap;
  }
  return null;
}

/** Everything held about a person, for the export. */
export async function exportGameData(db: Db, athleteId: string) {
  const sessions = await db.select().from(trainSessions).where(eq(trainSessions.athleteId, athleteId));
  const sessionIds = sessions.map((s) => s.id);
  const allSets = sessionIds.length ? await db.select().from(sets).where(inArray(sets.sessionId, sessionIds)) : [];
  const allReps = allSets.length ? await db.select().from(reps).where(inArray(reps.setId, allSets.map((s) => s.id))) : [];
  return {
    legs: await db.select().from(legsDays).where(eq(legsDays.athleteId, athleteId)),
    jumps: await db.select().from(jumps).where(eq(jumps.athleteId, athleteId)),
    balance: await db.select().from(balanceTests).where(eq(balanceTests.athleteId, athleteId)),
    calls: await db.select().from(dailyCalls).where(eq(dailyCalls.athleteId, athleteId)),
    trainSessions: sessions,
    sets: allSets,
    reps: allReps,
    points: await db.select().from(pointsLedger).where(eq(pointsLedger.athleteId, athleteId)),
    camp: await db.select().from(camps).where(eq(camps.athleteId, athleteId)),
  };
}

/** Deleting an account outranks the ledger being append-only. */
export async function deleteGameData(db: Db, athleteId: string, date: string): Promise<void> {
  await leaveCrew(db, athleteId, date);
  const sessions = await db.select({ id: trainSessions.id }).from(trainSessions).where(eq(trainSessions.athleteId, athleteId));
  const ids = sessions.map((s) => s.id);
  if (ids.length) {
    const setRows = await db.select({ id: sets.id }).from(sets).where(inArray(sets.sessionId, ids));
    if (setRows.length) await db.delete(reps).where(inArray(reps.setId, setRows.map((s) => s.id)));
    await db.delete(sets).where(inArray(sets.sessionId, ids));
    await db.delete(trainSessions).where(inArray(trainSessions.id, ids));
  }
  await db.delete(legsDays).where(eq(legsDays.athleteId, athleteId));
  await db.delete(jumps).where(eq(jumps.athleteId, athleteId));
  await db.delete(balanceTests).where(eq(balanceTests.athleteId, athleteId));
  await db.delete(dailyCalls).where(eq(dailyCalls.athleteId, athleteId));
  await db.delete(pointsLedger).where(eq(pointsLedger.athleteId, athleteId));
  await db.delete(camps).where(eq(camps.athleteId, athleteId));
  await db.delete(nudges).where(eq(nudges.toId, athleteId));
  await db.delete(nudges).where(eq(nudges.fromId, athleteId));
  await db.delete(auditLog).where(eq(auditLog.athleteId, athleteId));
}
