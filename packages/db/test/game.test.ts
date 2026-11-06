import { randomUUID } from 'node:crypto';
import { tileCounts, hexKey } from '@rollcall/crews';
import { findBannedWords } from '@rollcall/readiness';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  athletes,
  checkins,
  chooseToday,
  closeDueSeasons,
  createCrew,
  crewMembers,
  crews,
  DEMO_CREWS,
  deleteGameData,
  exportGameData,
  finishSession,
  joinCrew,
  leaveCrew,
  loadBoard,
  loadCamp,
  loadCrewFeed,
  loadInsights,
  loadMap,
  loadRecap,
  loadToday,
  markDone,
  openDb,
  plans,
  pointsLedger,
  removeMember,
  saveBalance,
  saveLegs,
  saveSet,
  seedDemo,
  sendNudge,
  startSession,
  camps,
  type Db,
  type JumpInput,
} from '../src';

const TODAY = '2026-11-20';
let db: Db;

const person = async (id: string) => (await db.select().from(athletes).where(eq(athletes.id, id)))[0]!;

const jump = (heightM: number, valid = true): JumpInput => ({
  flightMs: 500,
  heightM,
  hipRiseM: heightM,
  kneeAtTakeoff: 170,
  kneeAtLanding: 165,
  airFrames: 15,
  fps: 30,
  valid,
});

const heartIn = (athleteId: string, source: string, pulseConf = 0.9, date = TODAY) =>
  db.insert(checkins).values({
    id: randomUUID(),
    athleteId,
    date,
    kind: 'morning',
    source: source as 'live',
    pulse: 52,
    pulseConf,
    breath: 13,
    breathConf: 0.9,
    rmssd: 68,
    stress: 62,
    hrvConf: 0.9,
    sleep: 7.5,
    feel: 4,
    createdAt: `${date}T06:30:00Z`,
  });

async function newAthlete(name: string, workspace: 'real' | 'demo' = 'real') {
  const id = randomUUID();
  await db.insert(athletes).values({ id, workspace, name, sport: 'running', token: `t-${id}`, consentAt: 'x' });
  return person(id);
}

describe('the Judge Mode story', () => {
  beforeEach(async () => {
    db = await openDb(':memory:');
    await seedDemo(db, TODAY);
  });

  it('seeds four crews in one league, with Amara’s one tile behind', async () => {
    const map = (await loadMap(db, 'demo-amara', TODAY))!;
    expect(map.crews).toHaveLength(4);
    const tilesOf = (name: string) => map.crews.find((c) => c.name === name)!.tiles;
    expect(tilesOf('Fox Milers') - tilesOf('Dawn Patrol')).toBe(1);
    expect(map.lastTaken).toBeNull();
  });

  it('heart, legs and an easy-day choice earn points and take the contested tile', async () => {
    const amara = await person('demo-amara');
    await heartIn(amara.id, 'replay');
    await saveLegs(db, amara, TODAY, { kind: 'jumps', jumps: [jump(0.328), jump(0.32), jump(0.31)], source: 'replay' });
    const today = (await loadToday(db, amara, TODAY));
    expect(today.call?.heart).toBe('Heart: Ready');
    expect(today.call?.legs).toBe('Legs: 9% below usual');
    expect(today.call?.suggestion).toBe('upper');

    const chosen = (await chooseToday(db, amara, TODAY, 'upper'))!;
    expect(chosen.chosen?.listened).toBe(true);

    const feed = (await loadCrewFeed(db, amara.id, TODAY))!;
    expect(feed.mine.today.map((e) => e.reason).sort()).toEqual(['heart', 'legs', 'listened']);
    expect(feed.mine.today.reduce((s, e) => s + e.points, 0)).toBe(5);

    const map = (await loadMap(db, amara.id, TODAY))!;
    const tilesOf = (name: string) => map.crews.find((c) => c.name === name)!.tiles;
    expect(tilesOf('Dawn Patrol') - tilesOf('Fox Milers')).toBe(1);
    expect(map.lastTaken?.fromCrewId).toBe('demo-crew-fox');
    expect(map.lastTaken?.crewId).toBe('demo-crew-dawn');
  });

  it('keeps the coach’s board story, with Mei flagged', async () => {
    const board = await loadBoard(db, 'demo', TODAY);
    expect(board.summary).toBe('9 of 12 checked in, 2 to look at.');
    expect(board.rows.slice(0, 2).map((r) => r.name)).toEqual(['Mei', 'Tomasz']);
    expect(board.rows.find((r) => r.name === 'Amara')?.status).toBe('waiting');
  });

  it('a Legs drop does not turn the coach’s board against a Ready morning', async () => {
    const amara = await person('demo-amara');
    await heartIn(amara.id, 'replay');
    await saveLegs(db, amara, TODAY, { kind: 'jumps', jumps: [jump(0.328)], source: 'replay' });
    const board = await loadBoard(db, 'demo', TODAY);
    expect(board.rows.find((r) => r.name === 'Amara')?.status).toBe('ready');
  });

  it('Amara has insights linking training, legs and heart, with examples shown', async () => {
    const insights = await loadInsights(db, 'demo-amara');
    const speed = insights.find((i) => i.id === 'speed-squat');
    expect(speed?.text).toBe('So far, on Watch days your squat speed drops 18% faster than on Ready days.');
    expect(speed?.examples).toMatch(/\d+ Watch days and \d+ Ready days/);
    expect(insights.find((i) => i.id === 'legs-vs-heart')?.text).toMatch(/jump stays down/);
    expect(findBannedWords(insights.map((i) => i.text).join(' '))).toEqual([]);
  });

  it('has a recap card from last season', async () => {
    const recap = await loadRecap(db, 'demo-amara');
    expect(recap?.crewName).toBe('Dawn Patrol');
    expect(recap?.mvp?.smartCalls).toBeGreaterThan(0);
  });

  it('reseeding is repeatable', async () => {
    await heartIn('demo-amara', 'replay');
    await seedDemo(db, TODAY);
    const map = (await loadMap(db, 'demo-amara', TODAY))!;
    expect(map.crews.find((c) => c.name === 'Fox Milers')!.tiles - map.crews.find((c) => c.name === 'Dawn Patrol')!.tiles).toBe(1);
  });
});

describe('points', () => {
  beforeEach(async () => {
    db = await openDb(':memory:');
  });

  const ledger = async (id: string) => db.select().from(pointsLedger).where(eq(pointsLedger.athleteId, id));

  it('a real person’s heart point needs a live reading with good confidence', async () => {
    const a = await newAthlete('A');
    await heartIn(a.id, 'sim');
    await markDone(db, a, TODAY);
    await saveBalance(db, a, TODAY, [{ side: 'left', swayPct: 2, touches: 0, seconds: 20 }], 'sim');
    expect((await ledger(a.id)).map((e) => e.reason)).not.toContain('heart');

    const b = await newAthlete('B');
    await heartIn(b.id, 'live', 0.2);
    await saveBalance(db, b, TODAY, [{ side: 'left', swayPct: 2, touches: 0, seconds: 20 }], 'live');
    expect((await ledger(b.id)).map((e) => e.reason)).toEqual(['legs']);

    const c = await newAthlete('C');
    await heartIn(c.id, 'live');
    await saveBalance(db, c, TODAY, [{ side: 'left', swayPct: 2, touches: 0, seconds: 20 }], 'live');
    expect((await ledger(c.id)).map((e) => e.reason).sort()).toEqual(['heart', 'legs']);
  });

  it('counts each reason once a day, however often it is called', async () => {
    const a = await newAthlete('A');
    await heartIn(a.id, 'live');
    await saveLegs(db, a, TODAY, { kind: 'jumps', jumps: [jump(0.3)], source: 'live' });
    await saveLegs(db, a, TODAY, { kind: 'jumps', jumps: [jump(0.3)], source: 'live' });
    await saveLegs(db, a, TODAY, { kind: 'jumps', jumps: [jump(0.3)], source: 'live' });
    expect((await ledger(a.id)).filter((e) => e.reason === 'legs')).toHaveLength(1);
  });

  it('skipping or all-rejected jumps earn no legs point', async () => {
    const a = await newAthlete('A');
    await saveLegs(db, a, TODAY, { kind: 'skipped', source: 'live' });
    expect(await ledger(a.id)).toEqual([]);
    await saveLegs(db, a, TODAY, { kind: 'jumps', jumps: [jump(0.5, false)], source: 'live' });
    expect(await ledger(a.id)).toEqual([]);
  });

  it('points do not depend on how high anyone jumped', async () => {
    const low = await newAthlete('Low');
    const high = await newAthlete('High');
    await saveLegs(db, low, TODAY, { kind: 'jumps', jumps: [jump(0.1)], source: 'live' });
    await saveLegs(db, high, TODAY, { kind: 'jumps', jumps: [jump(0.6)], source: 'live' });
    expect((await ledger(low.id)).map((e) => e.points)).toEqual((await ledger(high.id)).map((e) => e.points));
  });

  it('going hard on a Check in day is no points and no penalty', async () => {
    const a = await newAthlete('A');
    const date = (d: number) => addDays(TODAY, -d);
    for (let d = 8; d >= 1; d--) await heartIn(a.id, 'live', 0.9, date(d));
    await db.insert(checkins).values({ id: randomUUID(), athleteId: a.id, date: TODAY, kind: 'morning', source: 'live', pulse: 90, pulseConf: 0.9, rmssd: 20, stress: 300, breath: 22, createdAt: 'x' });
    await db.insert(plans).values({ athleteId: a.id, date: TODAY, title: 'Track intervals', intensity: 'hard' });
    const view = (await chooseToday(db, a, TODAY, 'planned'))!;
    expect(view.heartStatus).toBe('check-in');
    expect(view.chosen?.listened).toBe(false);
    const entries = (await ledger(a.id)).filter((e) => e.date === TODAY);
    expect(entries.map((e) => e.reason)).toEqual(['heart']);
    expect(entries.every((e) => e.points > 0)).toBe(true);
  });

  it('a finished session is the logged session they chose', async () => {
    const a = await newAthlete('A');
    await heartIn(a.id, 'live');
    await chooseToday(db, a, TODAY, 'planned');
    const id = await startSession(db, a, TODAY, 'live');
    await saveSet(db, a.id, id, { exercise: 'squat', reps: 8, partials: 0, fastest: 1, slowest: 0.8, speedDrop: 0.2, avgDepth: 0.9, flagCounts: {}, stopSuggestedAt: null, durationMs: 1000, repList: [{ n: 1, speed: 1, drop: 0, depth: 1, durationMs: 900, flags: [] }] });
    expect(await finishSession(db, a, id, TODAY)).toBe(true);
    expect((await ledger(a.id)).map((e) => e.reason)).toContain('followed-through');
  });

  it('someone else’s session id does nothing', async () => {
    const a = await newAthlete('A');
    const b = await newAthlete('B');
    const id = await startSession(db, a, TODAY, 'live');
    expect(await finishSession(db, b, id, TODAY)).toBe(false);
  });
});

describe('crews', () => {
  beforeEach(async () => {
    db = await openDb(':memory:');
  });
  const make = async () => {
    const owner = await newAthlete('Owner');
    const made = await createCrew(db, owner, TODAY, { name: 'Test', emblem: 'emblem_fox', colour: '#FF6B5B' });
    if ('error' in made) throw new Error(made.error);
    return { owner, ...made };
  };

  it('creates and joins by code, one crew per person', async () => {
    const { owner, code } = await make();
    const b = await newAthlete('B');
    expect('id' in (await joinCrew(db, b, TODAY, code.toLowerCase()))).toBe(true);
    expect(await joinCrew(db, b, TODAY, code)).toEqual({ error: expect.stringMatching(/already/) });
    expect(await createCrew(db, owner, TODAY, { name: 'X', emblem: 'emblem_fox', colour: '#FF6B5B' })).toEqual({ error: expect.stringMatching(/already/) });
    expect(await joinCrew(db, await newAthlete('C'), TODAY, 'NOPE')).toEqual({ error: expect.stringMatching(/didn’t match/) });
    expect((await loadCrewFeed(db, owner.id, TODAY))?.needsMore).toBe(1);
  });

  it('is full at fifteen', async () => {
    const { code } = await make();
    for (let i = 0; i < 14; i++) await joinCrew(db, await newAthlete(`M${i}`), TODAY, code);
    expect(await joinCrew(db, await newAthlete('Too many'), TODAY, code)).toEqual({ error: expect.stringMatching(/full/) });
  });

  it('real people can’t join a demo crew', async () => {
    await seedDemo(db, TODAY);
    expect(await joinCrew(db, await newAthlete('Real'), TODAY, DEMO_CREWS[0]!.code)).toEqual({ error: expect.stringMatching(/didn’t match/) });
  });

  it('owners can remove members; members can leave; ownership passes on; an empty crew goes', async () => {
    const { owner, code, id } = await make();
    const b = await newAthlete('B');
    const c = await newAthlete('C');
    await joinCrew(db, b, TODAY, code);
    await joinCrew(db, c, TODAY, code);
    expect(await removeMember(db, b, c.id, TODAY)).toBe(false);
    expect(await removeMember(db, owner, c.id, TODAY)).toBe(true);
    await leaveCrew(db, owner.id, TODAY);
    expect((await db.select().from(crews).where(eq(crews.id, id)))[0]?.ownerId).toBe(b.id);
    await leaveCrew(db, b.id, TODAY);
    expect(await db.select().from(crews).where(eq(crews.id, id))).toEqual([]);
  });

  it('nudges once a day, only to teammates yet to check in', async () => {
    const { owner, code } = await make();
    const b = await newAthlete('B');
    const c = await newAthlete('C');
    const stranger = await newAthlete('S');
    await joinCrew(db, b, TODAY, code);
    await joinCrew(db, c, TODAY, code);
    await heartIn(c.id, 'live');
    expect(await sendNudge(db, owner, stranger.id, TODAY)).toEqual({ error: expect.stringMatching(/not in your crew/) });
    expect(await sendNudge(db, owner, owner.id, TODAY)).toEqual({ error: expect.stringMatching(/not in your crew/) });
    expect(await sendNudge(db, owner, c.id, TODAY)).toEqual({ error: expect.stringMatching(/already checked in/) });
    expect('ok' in (await sendNudge(db, owner, b.id, TODAY))).toBe(true);
    expect(await sendNudge(db, c, b.id, TODAY)).toEqual({ error: expect.stringMatching(/nudge for today/) });
    expect((await loadToday(db, b, TODAY)).nudged).toBe(true);
    const feed = await loadCrewFeed(db, owner.id, TODAY);
    expect(feed?.members.find((m) => m.id === b.id)?.canNudge).toBe(false);
  });

  it('crew streak counts days with 75% in, and rest days keep it alive', async () => {
    const { owner, code } = await make();
    const b = await newAthlete('B');
    const c = await newAthlete('C');
    const d = await newAthlete('D');
    for (const x of [b, c, d]) await joinCrew(db, x, TODAY, code);
    for (const x of [owner, b, c]) {
      await heartIn(x.id, 'live', 0.9, addDays(TODAY, -1));
      await heartIn(x.id, 'live', 0.9, TODAY);
    }
    expect((await loadCrewFeed(db, owner.id, TODAY))?.crewStreak).toBe(2);
  });

  it('members control what others see of them', async () => {
    const { owner, code } = await make();
    const b = await newAthlete('B');
    await joinCrew(db, b, TODAY, code);
    await db.update(crewMembers).set({ showPoints: false, showStreak: false }).where(eq(crewMembers.athleteId, b.id));
    const feed = (await loadCrewFeed(db, owner.id, TODAY))!;
    const seen = feed.members.find((m) => m.id === b.id)!;
    expect(seen).not.toHaveProperty('points');
    expect(seen).not.toHaveProperty('streak');
    expect((await loadCrewFeed(db, b.id, TODAY))!.members.find((m) => m.isYou)).toHaveProperty('points');
  });
});

describe('privacy', () => {
  /** Names of anything that would give away a reading or a performance. */
  const FORBIDDEN = /"(pulse|pulseConf|breath|breathConf|rmssd|sdnn|meanNn|stress|hrvConf|sleep|feel|heartStatus|status|heightM|bestM|flightMs|jump|jumps|reps|speed|speedDrop|avgDepth|swayPct|hold|weight|deviations|reasons|gentleNudge|listened)"/;

  it('crew feed, map, camp and recap carry no vitals or performance', async () => {
    db = await openDb(':memory:');
    await seedDemo(db, TODAY);
    const amara = await person('demo-amara');
    await heartIn(amara.id, 'replay');
    await saveLegs(db, amara, TODAY, { kind: 'jumps', jumps: [jump(0.328)], source: 'replay' });
    for (const payload of [
      await loadCrewFeed(db, amara.id, TODAY),
      await loadMap(db, amara.id, TODAY),
      await loadCamp(db, 'demo-noor'),
      await loadRecap(db, amara.id),
    ]) {
      expect(payload).not.toBeNull();
      const json = JSON.stringify(payload);
      expect(json).not.toMatch(FORBIDDEN);
      expect(json).not.toContain('"52"');
    }
  });

  it('a low mood streak shows only to that person', async () => {
    db = await openDb(':memory:');
    await seedDemo(db, TODAY);
    const tomasz = await person('demo-tomasz');
    expect((await loadToday(db, tomasz, TODAY)).gentleCard).toBe(true);
    const json = JSON.stringify(await loadCrewFeed(db, tomasz.id, TODAY));
    expect(json).not.toMatch(/gentle|feel|tough/i);
  });
});

describe('seasons', () => {
  it('closes a finished week, moves crews and writes recap cards, once', async () => {
    db = await openDb(':memory:');
    await seedDemo(db, TODAY);
    const later = addDays(TODAY, 4);
    const before = (await db.select().from(crews)).length;
    expect(await closeDueSeasons(db, 'demo', later)).toBe(1);
    expect(await closeDueSeasons(db, 'demo', later)).toBe(0);
    expect((await db.select().from(crews)).length).toBe(before);
    const recap = await loadRecap(db, 'demo-amara');
    expect(recap?.seasonEnd).toBe(addDays(TODAY, 3));
    const map = await loadMap(db, 'demo-amara', later);
    expect(map?.season.start).toBeTruthy();
  });

  it('every crew’s map tiles add up', async () => {
    db = await openDb(':memory:');
    await seedDemo(db, TODAY);
    const map = (await loadMap(db, 'demo-amara', TODAY))!;
    const state = new Map(map.tiles.filter((t) => t.crewId).map((t) => [hexKey(t), { crewId: t.crewId!, light: t.light }]));
    const counts = tileCounts(state);
    for (const c of map.crews) expect(counts.get(c.id)).toBe(c.tiles);
    expect(map.tiles).toHaveLength(61);
  });
});

describe('camps', () => {
  it('grow, and never shrink even if the points behind them go', async () => {
    db = await openDb(':memory:');
    const a = await newAthlete('A');
    await heartIn(a.id, 'live');
    await saveBalance(db, a, TODAY, [{ side: 'left', swayPct: 2, touches: 0, seconds: 20 }], 'live');
    expect((await loadCamp(db, a.id))?.stage).toBe(1);
    await db.update(camps).set({ stage: 3 }).where(eq(camps.athleteId, a.id));
    await db.delete(pointsLedger).where(and(eq(pointsLedger.athleteId, a.id)));
    const camp = (await loadCamp(db, a.id))!;
    expect(camp.stage).toBe(3);
    expect(camp.buildings.map((b) => b.name)).toEqual(['Coop', 'Vegetable patch', 'Running track']);
  });
});

describe('my data', () => {
  it('exports and deletes everything from the new tables', async () => {
    db = await openDb(':memory:');
    const a = await newAthlete('A');
    await heartIn(a.id, 'live');
    await saveLegs(db, a, TODAY, { kind: 'jumps', jumps: [jump(0.3)], source: 'live' });
    await chooseToday(db, a, TODAY, 'planned');
    const id = await startSession(db, a, TODAY, 'live');
    await saveSet(db, a.id, id, { exercise: 'squat', reps: 1, partials: 0, fastest: 1, slowest: 1, speedDrop: 0, avgDepth: 1, flagCounts: {}, stopSuggestedAt: null, durationMs: 1, repList: [{ n: 1, speed: 1, drop: 0, depth: 1, durationMs: 1, flags: [] }] });
    await createCrew(db, a, TODAY, { name: 'Mine', emblem: 'emblem_fox', colour: '#FF6B5B' });
    const exported = await exportGameData(db, a.id);
    expect(exported.jumps).toHaveLength(1);
    expect(exported.reps).toHaveLength(1);
    expect(exported.points.length).toBeGreaterThan(0);
    await deleteGameData(db, a.id, TODAY);
    const after = await exportGameData(db, a.id);
    for (const rows of Object.values(after)) expect(rows).toEqual([]);
    expect(await loadCrewFeed(db, a.id, TODAY)).toBeNull();
  });
});
