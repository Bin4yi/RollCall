import { describe, expect, it } from 'vitest';
import {
  advanceDay,
  campGrowth,
  campStage,
  contestedKeys,
  crewStreak,
  hexKey,
  HOME_SLOTS,
  MAP,
  neighbours,
  nextStage,
  POINTS,
  rankSeason,
  scoreDay,
  seasonWeek,
  tileCounts,
  valley,
  type CrewDay,
  type MapState,
} from '../src';

const none = { realHeartCheckin: false, legsOrBalance: false, listened: false, followedThrough: false, settle: false };

describe('scoreDay', () => {
  it('matches the points table', () => {
    const sum = (f: Partial<typeof none>) => scoreDay({ ...none, ...f }).reduce((s, e) => s + e.points, 0);
    expect(sum({ realHeartCheckin: true })).toBe(1);
    expect(sum({ legsOrBalance: true })).toBe(1);
    expect(sum({ listened: true })).toBe(3);
    expect(sum({ followedThrough: true })).toBe(2);
    expect(sum({ settle: true })).toBe(1);
  });
  it('no penalties: going hard on a Check in day is just no points', () => {
    expect(scoreDay(none)).toEqual([]);
  });
  it('caps a day', () => {
    const all = scoreDay({ realHeartCheckin: true, legsOrBalance: true, listened: true, followedThrough: true, settle: true });
    expect(all.reduce((s, e) => s + e.points, 0)).toBeLessThanOrEqual(POINTS.dailyCap);
  });
  it('takes only yes-or-no facts, so a reading cannot reach it', () => {
    expect(Object.values(none).every((v) => typeof v === 'boolean')).toBe(true);
  });
});

describe('crewStreak', () => {
  it('counts days with at least 75% checked in, including rest days', () => {
    const days = new Map([['2026-11-18', 3], ['2026-11-19', 4], ['2026-11-20', 3]]);
    expect(crewStreak(days, 4, '2026-11-20')).toBe(3);
    expect(crewStreak(new Map([['2026-11-20', 2]]), 4, '2026-11-20')).toBe(0);
  });
  it('holds until today is done', () => {
    expect(crewStreak(new Map([['2026-11-19', 4]]), 4, '2026-11-20')).toBe(1);
  });
});

describe('valley', () => {
  const tiles = valley();
  it('has 61 tiles and every promised landscape', () => {
    expect(tiles).toHaveLength(61);
    for (const kind of ['meadow', 'forest', 'river', 'lake', 'hill', 'pass', 'coast', 'lighthouse', 'village']) {
      expect(tiles.some((t) => t.kind === kind)).toBe(true);
    }
  });
  it('homes are on the map', () => {
    const keys = new Set(tiles.map(hexKey));
    for (const h of HOME_SLOTS) expect(keys.has(hexKey(h))).toBe(true);
  });
});

const crew = (id: string, slot: number, score: number, yesterday = score): CrewDay => ({ id, home: HOME_SLOTS[slot]!, score, yesterday });
const fromHomes = (crews: CrewDay[]): MapState => new Map(crews.map((c) => [hexKey(c.home), { crewId: c.id, light: 1 }]));

describe('advanceDay', () => {
  it('spreads light from home, by mean points', () => {
    const crews = [crew('a', 0, 4)];
    const { state, claims } = advanceDay(fromHomes(crews), crews);
    expect(claims).toHaveLength(2);
    expect(tileCounts(state).get('a')).toBe(3);
    expect(neighbours(HOME_SLOTS[0]!).map(hexKey)).toContain(hexKey(claims[0]!.hex));
  });

  it('caps a burst', () => {
    const crews = [crew('a', 0, 8)];
    expect(advanceDay(fromHomes(crews), crews).claims.length).toBeLessThanOrEqual(MAP.maxTilesPerDay);
  });

  it('contested tiles go to the crew with more points that day', () => {
    const a = crew('a', 0, 2);
    const b = crew('b', 1, 1);
    const prev: MapState = new Map([
      [hexKey(a.home), { crewId: 'a', light: 1 }],
      [hexKey(b.home), { crewId: 'b', light: 1 }],
      ['-3,0', { crewId: 'a', light: 1 }],
      ['-2,0', { crewId: 'b', light: 1 }],
    ]);
    const { state, claims } = advanceDay(prev, [a, b]);
    expect(claims[0]).toMatchObject({ crewId: 'a', from: 'b' });
    expect(state.get('-2,0')?.crewId).toBe('a');
  });

  it('a crew with fewer points cannot take a tile, and level scores keep the owner', () => {
    const a = crew('a', 0, 2);
    const b = crew('b', 1, 2);
    const prev: MapState = new Map([
      [hexKey(a.home), { crewId: 'a', light: 1 }],
      [hexKey(b.home), { crewId: 'b', light: 1 }],
      ['-3,0', { crewId: 'a', light: 1 }],
      ['-2,0', { crewId: 'b', light: 1 }],
    ]);
    expect(advanceDay(prev, [a, b]).claims.every((c) => c.from === null)).toBe(true);
  });

  it('light fades slowly if a crew stops checking in, and homes never fall', () => {
    const a = crew('a', 0, 0, 0);
    let state: MapState = new Map([
      [hexKey(a.home), { crewId: 'a', light: 1 }],
      ['-3,0', { crewId: 'a', light: 1 }],
    ]);
    state = advanceDay(state, [a]).state;
    expect(state.get('-3,0')?.light).toBeCloseTo(0.66);
    state = advanceDay(state, [a]).state;
    state = advanceDay(state, [a]).state;
    expect(state.has('-3,0')).toBe(false);
    expect(state.get(hexKey(a.home))?.light).toBe(1);
  });

  it('consistency beats a burst across a week', () => {
    const steady = crew('steady', 0, 4);
    const burst = crew('burst', 1, 0, 0);
    let state = fromHomes([steady, burst]);
    for (let day = 0; day < 6; day++) state = advanceDay(state, [steady, { ...burst, score: 0, yesterday: 0 }]).state;
    state = advanceDay(state, [steady, { ...burst, score: 8, yesterday: 0 }]).state;
    const counts = tileCounts(state);
    expect(counts.get('steady')!).toBeGreaterThan(counts.get('burst')!);
  });

  it('is deterministic', () => {
    const crews = [crew('a', 0, 4), crew('b', 1, 6)];
    const one = advanceDay(fromHomes(crews), crews);
    const two = advanceDay(fromHomes(crews), crews);
    expect([...one.state]).toEqual([...two.state]);
  });

  it('marks tiles along a border as contested', () => {
    const state: MapState = new Map([
      ['0,0', { crewId: 'a', light: 1 }],
      ['1,0', { crewId: 'b', light: 1 }],
      ['-3,0', { crewId: 'a', light: 1 }],
    ]);
    expect([...contestedKeys(state)].sort()).toEqual(['0,0', '1,0']);
  });
});

describe('seasons', () => {
  it('runs Monday to Sunday', () => {
    expect(seasonWeek('2026-11-20')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(seasonWeek('2026-11-22').start).toBe('2026-11-16');
  });
  it('ranks by tiles then points, with promotion and relegation', () => {
    const ranked = rankSeason(
      [
        { crewId: 'a', tiles: 10, points: 40 },
        { crewId: 'b', tiles: 12, points: 20 },
        { crewId: 'c', tiles: 10, points: 50 },
      ],
      1,
    );
    expect(ranked.map((r) => [r.crewId, r.move])).toEqual([['b', 'up'], ['c', 'stay'], ['a', 'down']]);
  });
  it('nobody falls out of the bottom league or rises off the top', () => {
    const entries = [{ crewId: 'a', tiles: 2, points: 1 }, { crewId: 'b', tiles: 1, points: 1 }, { crewId: 'c', tiles: 0, points: 1 }];
    expect(rankSeason(entries, 0).at(-1)?.move).toBe('stay');
    expect(rankSeason(entries, 3)[0]?.move).toBe('stay');
  });
});

describe('camp', () => {
  it('grows through the buildings', () => {
    expect(campStage(campGrowth(0, 0))).toBe(0);
    expect(campStage(campGrowth(1, 0))).toBe(1);
    expect(campStage(campGrowth(60, 15))).toBe(6);
  });
  it('never shrinks', () => {
    expect(nextStage(4, 0)).toBe(4);
    expect(nextStage(1, 40)).toBe(4);
  });
});
