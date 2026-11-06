import { assessHistory } from '@rollcall/readiness';
import { hexKey, HOME_SLOTS, neighbours, valley, type Hex, type Recap } from '@rollcall/crews';
import { eq, inArray } from 'drizzle-orm';
import { addDays, type Db } from './index';
import { createLeague, settleLeague } from './game';
import { toReading } from './read';
import { athletes, checkins, plans, type Intensity } from './schema';
import {
  camps,
  crewInvites,
  crewMembers,
  crews,
  leagues,
  legsDays,
  mapTiles,
  nudges,
  pointsLedger,
  seasons,
  sets,
  tileClaims,
  trainSessions,
} from './schema-game';

/**
 * Judge Mode's Legs, Train and Crews story. All invented and labelled as demo data.
 * Amara's crew starts one tile behind, and her smart call this morning wins the contested tile.
 */
const LEAGUE = 'demo-league-dawn';
const SEASON = 'demo-season-now';

export const DEMO_CREWS = [
  { id: 'demo-crew-dawn', name: 'Dawn Patrol', emblem: 'emblem_comet', colour: '#FF6B5B', home: HOME_SLOTS[0]!, tiles: 12, members: ['demo-amara', 'demo-hana', 'demo-kasun'], code: 'DAWN2026', camp: [4, 3, 2] },
  { id: 'demo-crew-fox', name: 'Fox Milers', emblem: 'emblem_fox', colour: '#3FB8AF', home: HOME_SLOTS[5]!, tiles: 13, members: ['demo-noor', 'demo-freya', 'demo-elif'], code: 'FOXFOX26', camp: [3, 3, 2] },
  { id: 'demo-crew-lantern', name: 'Harbour Lanterns', emblem: 'emblem_lantern', colour: '#2B2A6B', home: HOME_SLOTS[4]!, tiles: 9, members: ['demo-mei', 'demo-tomasz', 'demo-priya'], code: 'LANTERN6', camp: [3, 2, 2] },
  { id: 'demo-crew-pine', name: 'Pine Street', emblem: 'emblem_pine', colour: '#B8352A', home: HOME_SLOTS[1]!, tiles: 8, members: ['demo-diego', 'demo-jonah', 'demo-sione'], code: 'PINEST26', camp: [1, 1, 2] },
];

const rand = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
};

/** Grows each crew outward from home, round by round, up to its share. */
export function layOutTiles(list: readonly { id: string; home: Hex; tiles: number }[]): Map<string, string> {
  const onMap = new Set(valley().map(hexKey));
  const owners = new Map<string, string>();
  const frontier = new Map(list.map((c) => [c.id, [c.home]]));
  for (const c of list) owners.set(hexKey(c.home), c.id);
  const count = (id: string): number => [...owners.values()].filter((v) => v === id).length;
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list) {
      if (count(c.id) >= c.tiles) continue;
      const queue = frontier.get(c.id)!;
      const next = [...queue]
        .flatMap((h) => neighbours(h))
        .filter((h) => onMap.has(hexKey(h)) && !owners.has(hexKey(h)))
        .sort((a, b) => hexKey(a).localeCompare(hexKey(b)))[0];
      if (!next) continue;
      owners.set(hexKey(next), c.id);
      queue.push(next);
      grew = true;
    }
  }
  return owners;
}

export async function seedGame(db: Db, today: string): Promise<void> {
  const people = await db.select().from(athletes).where(eq(athletes.workspace, 'demo'));
  const ids = people.map((p) => p.id);
  const oldCrews = await db.select({ id: crews.id }).from(crews).where(eq(crews.workspace, 'demo'));
  if (oldCrews.length) {
    await db.delete(crewInvites).where(inArray(crewInvites.crewId, oldCrews.map((c) => c.id)));
    await db.delete(crewMembers).where(inArray(crewMembers.crewId, oldCrews.map((c) => c.id)));
    await db.delete(crews).where(eq(crews.workspace, 'demo'));
  }
  const oldLeagues = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.workspace, 'demo'));
  if (oldLeagues.length) {
    const leagueIds = oldLeagues.map((l) => l.id);
    const oldSeasons = await db.select({ id: seasons.id }).from(seasons).where(inArray(seasons.leagueId, leagueIds));
    if (oldSeasons.length) await db.delete(tileClaims).where(inArray(tileClaims.seasonId, oldSeasons.map((s) => s.id)));
    await db.delete(seasons).where(inArray(seasons.leagueId, leagueIds));
    await db.delete(mapTiles).where(inArray(mapTiles.leagueId, leagueIds));
    await db.delete(leagues).where(eq(leagues.workspace, 'demo'));
  }
  const oldSessions = await db.select({ id: trainSessions.id }).from(trainSessions).where(inArray(trainSessions.athleteId, ids));
  if (oldSessions.length) await db.delete(sets).where(inArray(sets.sessionId, oldSessions.map((s) => s.id)));
  await db.delete(trainSessions).where(inArray(trainSessions.athleteId, ids));
  await db.delete(legsDays).where(inArray(legsDays.athleteId, ids));
  await db.delete(pointsLedger).where(inArray(pointsLedger.athleteId, ids));
  await db.delete(camps).where(inArray(camps.athleteId, ids));
  await db.delete(nudges).where(inArray(nudges.toId, ids));

  await seedAmaraHistory(db, today);
  await seedOtherLegs(db, today);

  await createLeague(db, LEAGUE, 'demo', 0);
  await db.insert(seasons).values({
    id: SEASON,
    leagueId: LEAGUE,
    start: addDays(today, -3),
    end: addDays(today, 3),
    status: 'open',
  });
  const recaps: Record<string, Recap> = {};
  DEMO_CREWS.forEach((c, i) => {
    recaps[c.id] = {
      crewName: c.name,
      league: 'Dawn',
      rank: [2, 1, 3, 4][i]!,
      crews: DEMO_CREWS.length,
      tiles: [19, 21, 12, 9][i]!,
      bestStreak: [5, 4, 3, 2][i]!,
      mvp: { name: people.find((p) => p.id === c.members[0])?.name ?? 'Teammate', smartCalls: [5, 4, 3, 3][i]! },
      move: 'stay',
      seasonStart: addDays(today, -10),
      seasonEnd: addDays(today, -4),
    };
  });
  await db.insert(seasons).values({
    id: 'demo-season-last',
    leagueId: LEAGUE,
    start: addDays(today, -10),
    end: addDays(today, -4),
    status: 'closed',
    recap: JSON.stringify(recaps),
  });

  const stamp = `${addDays(today, -14)}T06:00:00Z`;
  for (const c of DEMO_CREWS) {
    await db.insert(crews).values({
      id: c.id,
      workspace: 'demo',
      leagueId: LEAGUE,
      name: c.name,
      emblem: c.emblem,
      colour: c.colour,
      ownerId: c.members[0]!,
      homeQ: c.home.q,
      homeR: c.home.r,
      createdAt: stamp,
    });
    await db.insert(crewInvites).values({ code: c.code, crewId: c.id, createdAt: stamp });
    for (const [i, member] of c.members.entries()) {
      await db.insert(crewMembers).values({ crewId: c.id, athleteId: member, joinedAt: stamp });
      await db.insert(camps).values({ athleteId: member, stage: c.camp[i] ?? 1, updatedAt: stamp });
    }
  }

  // Points for the days of this season so far, from who actually checked in.
  const rows = await db.select({ athleteId: checkins.athleteId, date: checkins.date, kind: checkins.kind }).from(checkins).where(inArray(checkins.athleteId, ids));
  const ledger: (typeof pointsLedger.$inferInsert)[] = [];
  const earlySmart = new Set(['demo-noor', 'demo-amara', 'demo-mei', 'demo-sione', 'demo-freya']);
  for (const r of rows) {
    if (r.kind !== 'morning' || r.date < addDays(today, -3)) continue;
    const at = `${r.date}T07:00:00Z`;
    ledger.push({ id: `${r.athleteId}-${r.date}-heart`, athleteId: r.athleteId, date: r.date, reason: 'heart', points: 1, createdAt: at });
    if (r.date < today && earlySmart.has(r.athleteId)) {
      ledger.push({ id: `${r.athleteId}-${r.date}-listened`, athleteId: r.athleteId, date: r.date, reason: 'listened', points: 3, createdAt: at });
    }
  }
  if (ledger.length) await db.insert(pointsLedger).values(ledger);

  // Yesterday's map, laid out by hand so the story starts one tile behind.
  const yesterday = addDays(today, -1);
  const owners = layOutTiles(DEMO_CREWS);
  await db.insert(tileClaims).values(
    [...owners].map(([key, crewId]) => {
      const [q, r] = key.split(',').map(Number) as [number, number];
      return { seasonId: SEASON, date: yesterday, q, r, crewId, light: 1 };
    }),
  );
  await settleLeague(db, LEAGUE, today);
}

/** Amara's Legs checks and training, so her trends and insights have something to say. */
async function seedAmaraHistory(db: Db, today: string): Promise<void> {
  const id = 'demo-amara';
  const random = rand(4242);
  const morning = await db.select().from(checkins).where(eq(checkins.athleteId, id));
  const planRows = await db.select().from(plans).where(eq(plans.athleteId, id));
  const statusOn = new Map(
    assessHistory(morning.filter((r) => r.kind === 'morning').map(toReading)).map((a) => [a.date, a.status]),
  );
  const legs: (typeof legsDays.$inferInsert)[] = [];
  for (let d = 27; d >= 1; d--) {
    const date = addDays(today, -d);
    const noise = (random() - 0.5) * 0.008;
    // Down for two mornings after the weekly hard leg session.
    const afterHard = d % 7 === 6 || d % 7 === 5;
    legs.push({
      athleteId: id,
      date,
      kind: 'jumps',
      bestM: Math.round((0.36 * (afterHard ? 0.95 : 1) + noise) * 1000) / 1000,
      source: 'demo',
      fps: 60,
      createdAt: `${date}T06:20:00Z`,
    });
  }
  await db.insert(legsDays).values(legs);

  for (let d = 27; d >= 1; d--) {
    const offDay = d >= 14 && d <= 18;
    const hardLegDay = d % 7 === 0;
    if (!offDay && !hardLegDay && d % 7 !== 3) continue;
    const date = addDays(today, -d);
    const status = statusOn.get(date) ?? 'ready';
    const sid = `demo-train-${d}`;
    const plan = planRows.find((p) => p.date === date);
    const intensity: Intensity = hardLegDay ? 'hard' : 'moderate';
    await db.insert(trainSessions).values({
      id: sid,
      athleteId: id,
      date,
      title: plan?.title ?? 'Squats',
      intensity,
      morningStatus: status,
      legsKind: 'usual',
      source: 'demo',
      startedAt: `${date}T17:00:00Z`,
      finishedAt: `${date}T17:40:00Z`,
    });
    const off = status === 'watch' || status === 'check-in';
    await db.insert(sets).values({
      id: `${sid}-1`,
      sessionId: sid,
      n: 1,
      exercise: 'squat',
      reps: 10,
      partials: 0,
      fastest: 0.72,
      slowest: off ? 0.533 : 0.562,
      speedDrop: off ? 0.26 : 0.22,
      avgDepth: 0.95,
      flags: '{}',
      stopSuggestedAt: 8,
      durationMs: 26000,
    });
  }
}

/** A little Legs history for two more people, so a board shows it isn't only Amara. */
async function seedOtherLegs(db: Db, today: string): Promise<void> {
  for (const [id, usual, seed] of [['demo-noor', 0.42, 77], ['demo-hana', 0.31, 91]] as const) {
    const random = rand(seed);
    const rows: (typeof legsDays.$inferInsert)[] = [];
    for (let d = 12; d >= 1; d--) {
      const date = addDays(today, -d);
      rows.push({
        athleteId: id,
        date,
        kind: 'jumps',
        bestM: Math.round((usual + (random() - 0.5) * 0.01) * 1000) / 1000,
        source: 'demo',
        fps: 60,
        createdAt: `${date}T06:20:00Z`,
      });
    }
    await db.insert(legsDays).values(rows);
  }
}
