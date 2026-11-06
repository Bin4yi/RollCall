import { findBannedWords } from '@rollcall/readiness';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addDays,
  athletes,
  checkinStreak,
  loadBoard,
  loadDetail,
  messages,
  openDb,
  seedDemo,
  type Board,
  type Db,
} from '../src';

const TODAY = '2026-11-20';
let db: Db;
let board: Board;
const row = (name: string) => board.rows.find((r) => r.name === name)!;

beforeAll(async () => {
  db = await openDb(':memory:');
  await seedDemo(db, TODAY);
  board = await loadBoard(db, 'demo', TODAY);
});

describe('demo stories', () => {
  it('reads "9 of 12 checked in, 2 to look at"', () => {
    expect(board.summary).toBe('9 of 12 checked in, 2 to look at.');
  });

  it('puts the people who need attention first', () => {
    expect(board.rows.slice(0, 2).map((r) => r.name)).toEqual(['Mei', 'Tomasz']);
  });

  it('Amara has not checked in yet: Judge Mode’s morning is hers', () => {
    expect(row('Amara').status).toBe('waiting');
    expect(row('Amara').plan?.intensity).toBe('hard');
  });

  it('Mei is off her usual today, with plain reasons and a hard session planned', () => {
    const a = row('Mei');
    expect(a.status).toBe('check-in');
    expect(a.reasons.join(' ')).toMatch(/Pulse \d+ above usual/);
    expect(a.plan?.intensity).toBe('hard');
  });

  it('Amara dipped in her heavy block and recovered after the easy week', async () => {
    const detail = (await loadDetail(db, 'demo', 'demo-amara', TODAY))!;
    const status = (daysAgo: number) => detail.points[27 - daysAgo]!.status;
    expect([status(16), status(15), status(14)].some((s) => s === 'watch' || s === 'check-in')).toBe(true);
    expect(status(4)).toBe('ready');
  });

  it('Kasun has three off days from travel, then is back to usual', async () => {
    const detail = (await loadDetail(db, 'demo', 'demo-kasun', TODAY))!;
    const off = detail.points.filter((p) => p.status === 'watch' || p.status === 'check-in');
    expect(off.map((p) => p.date)).toEqual([
      addDays(TODAY, -10),
      addDays(TODAY, -9),
      addDays(TODAY, -8),
    ]);
    expect(row('Kasun').status).toBe('ready');
  });

  it('Noor is steady and Ready nearly every day', async () => {
    const detail = (await loadDetail(db, 'demo', 'demo-noor', TODAY))!;
    const judged = detail.points.filter((p) => p.status && p.status !== 'learning');
    const ready = judged.filter((p) => p.status === 'ready');
    expect(ready.length / judged.length).toBeGreaterThan(0.85);
    expect(row('Noor').status).toBe('ready');
  });

  it('Diego rarely checks in, and the board shows the gap', () => {
    const d = row('Diego');
    expect(d.checkedIn).toBe(false);
    expect(d.status).toBe('waiting');
    expect(d.daysAway).toBeGreaterThan(0);
  });

  it('Hana has not checked in yet, ready for the replayed check-in', () => {
    expect(row('Hana').status).toBe('waiting');
    expect(row('Hana').daysAway).toBe(1);
  });

  it('Jonah is new, so Roll Call is still learning his usual', () => {
    expect(row('Jonah').status).toBe('learning');
    expect(row('Jonah').learning).toEqual({ have: 3, need: 5 });
  });

  it('Tomasz gets the gentle nudge after three mornings at 1/5', () => {
    expect(row('Tomasz').gentleNudge).toBe(true);
  });

  it('coach sees trends, usual ranges, sessions and settle checks', async () => {
    const detail = (await loadDetail(db, 'demo', 'demo-amara', TODAY))!;
    expect(detail.points).toHaveLength(28);
    expect(detail.usual.pulse?.median).toBeGreaterThan(40);
    expect(detail.sessions.length).toBeGreaterThan(3);
    expect(detail.settle.find((s) => s.intensity === 'hard')?.count).toBeGreaterThan(0);
    expect(detail.athlete).not.toHaveProperty('token');
  });

  it('never mixes demo and real data', async () => {
    expect((await loadBoard(db, 'real', TODAY)).rows).toEqual([]);
    expect(await loadDetail(db, 'real', 'demo-amara', TODAY)).toBeNull();
  });

  it('reseeding is repeatable and replaces earlier changes', async () => {
    await db.update(athletes).set({ notes: 'changed' }).where(eq(athletes.id, 'demo-amara'));
    await seedDemo(db, TODAY);
    const again = await loadBoard(db, 'demo', TODAY);
    expect(again.summary).toBe(board.summary);
    const [a] = await db.select().from(athletes).where(eq(athletes.id, 'demo-amara'));
    expect(a?.notes).not.toBe('changed');
  });

  it('no seeded text uses banned wording', async () => {
    const text = [
      ...(await db.select().from(athletes)).map((a) => a.notes),
      ...(await db.select().from(messages)).map((m) => m.body),
      ...board.rows.flatMap((r) => r.reasons),
    ].join(' ');
    expect(findBannedWords(text)).toEqual([]);
  });
});

describe('checkinStreak', () => {
  it('counts back from today, or yesterday if today is not done yet', () => {
    const dates = ['2026-11-17', '2026-11-18', '2026-11-19'];
    expect(checkinStreak(dates, '2026-11-19')).toBe(3);
    expect(checkinStreak(dates, '2026-11-20')).toBe(3);
    expect(checkinStreak(dates, '2026-11-21')).toBe(0);
    expect(checkinStreak([], '2026-11-21')).toBe(0);
  });
});
