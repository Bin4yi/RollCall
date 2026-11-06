import { CheckinSession } from '@rollcall/readiness';
import { BodySynth } from '@rollcall/signals';
import { checkins, messages, openDb, plans, type Db } from '@rollcall/db';
import type { DraftProvider } from '@rollcall/drafts';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, makeSession, readSession, saveCheckin } from '../src';
import type { Env } from '../src/env';

const TODAY = '2026-11-20';
const env: Env = {
  production: false,
  port: 0,
  databaseUrl: ':memory:',
  coachPassphrase: 'open-sesame',
  sessionSecret: 'test-secret',
  liveAvailable: false,
  smartSpectraKey: null,
  maxLiveSessions: 2,
  allowSimForReal: true,
  openAiKey: null,
  openAiDraftModel: 'x',
  ollamaUrl: null,
  ollamaModel: null,
  vapidPublic: null,
  vapidPrivate: null,
  vapidSubject: 'mailto:a@b.c',
  resendKey: null,
  emailFrom: null,
  timeZone: undefined,
};

let db: Db;
let app: ReturnType<typeof createApp>;
const notifier = { messageWaiting: vi.fn(async () => undefined) };

const cookieFor = (workspace: 'real' | 'demo'): string =>
  `rc_session=${makeSession(env.sessionSecret, workspace)}`;

const call = (path: string, init: RequestInit & { json?: unknown; as?: 'real' | 'demo' } = {}) => {
  const { json, as, ...rest } = init;
  return app.request(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(as ? { Cookie: cookieFor(as) } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
};

beforeEach(async () => {
  notifier.messageWaiting.mockClear();
  db = await openDb(':memory:');
  app = createApp({ db, env, today: () => TODAY, notifier, draftProvider: null });
});

const addAthlete = async (name = 'Sam') => {
  const res = await call('/api/coach/athletes', {
    method: 'POST',
    as: 'real',
    json: { name, sport: 'running', plan: 'Tempo run' },
  });
  return (await res.json()) as { id: string; link: string };
};

describe('coach auth', () => {
  it('rejects a wrong passphrase and accepts the right one', async () => {
    expect((await call('/api/coach/login', { method: 'POST', json: { passphrase: 'nope' } })).status).toBe(401);
    const ok = await call('/api/coach/login', { method: 'POST', json: { passphrase: 'open-sesame' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('protects every coach route', async () => {
    for (const path of ['/api/coach/board', '/api/coach/me', '/api/coach/athletes/x']) {
      expect((await call(path)).status).toBe(401);
    }
  });

  it('rejects tampered and expired sessions', () => {
    const good = makeSession('s', 'real', 1000);
    expect(readSession('s', good, 1000)).toBe('real');
    expect(readSession('other', good, 1000)).toBeNull();
    expect(readSession('s', good.replace('real', 'demo'), 1000)).toBeNull();
    expect(readSession('s', good, 1000 + 40 * 86_400)).toBeNull();
    expect(readSession('s', undefined)).toBeNull();
  });
});

describe('Judge Mode', () => {
  it('seeds the demo and signs in with no keys', async () => {
    const res = await call('/api/demo/start', { method: 'POST' });
    expect(res.status).toBe(200);
    const board = await (await call('/api/coach/board', { as: 'demo' })).json() as { summary: string };
    expect(board.summary).toBe('9 of 12 checked in, 2 to look at.');
  });

  it('a real coach never sees demo athletes, and the other way round', async () => {
    await call('/api/demo/start', { method: 'POST' });
    const real = await (await call('/api/coach/board', { as: 'real' })).json() as { rows: unknown[] };
    expect(real.rows).toEqual([]);
    expect((await call('/api/coach/athletes/demo-amara', { as: 'real' })).status).toBe(404);
    const { id } = await addAthlete();
    expect((await call(`/api/coach/athletes/${id}`, { as: 'demo' })).status).toBe(404);
  });

  it('never calls the LLM, so judges cannot spend the owner’s credit', async () => {
    const complete = vi.fn(async () => '{name}, hello.');
    const provider: DraftProvider = { name: 'paid', complete };
    app = createApp({ db, env, today: () => TODAY, draftProvider: provider });
    await call('/api/demo/start', { method: 'POST' });
    const res = await call('/api/coach/athletes/demo-amara/draft', { method: 'POST', as: 'demo', json: { action: 'easy' } });
    const draft = await res.json() as { source: string };
    expect(draft.source).toBe('template');
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('drafts and sending', () => {
  it('drafting sends nothing: only Send does', async () => {
    const { id } = await addAthlete();
    const draft = await call(`/api/coach/athletes/${id}/draft`, { method: 'POST', as: 'real', json: { action: 'easy' } });
    const body = await draft.json() as { body: string };
    expect(body.body).toMatch(/^Sam,/);
    expect(await db.select().from(messages)).toEqual([]);
    expect(notifier.messageWaiting).not.toHaveBeenCalled();

    const sent = await call(`/api/coach/athletes/${id}/send`, {
      method: 'POST',
      as: 'real',
      json: { action: 'easy', body: 'Sam, easy day, edited by me.' },
    });
    expect(sent.status).toBe(200);
    const stored = await db.select().from(messages);
    expect(stored.map((m) => m.body)).toEqual(['Sam, easy day, edited by me.']);
    expect(notifier.messageWaiting).toHaveBeenCalledOnce();
  });

  it('what reaches the LLM has no name, notes or session title', async () => {
    const seen: string[] = [];
    const provider: DraftProvider = {
      name: 'fake',
      complete: async (i, p) => {
        seen.push(i, p);
        return '{name}, easy today.';
      },
    };
    app = createApp({ db, env, today: () => TODAY, draftProvider: provider });
    const { id } = await addAthlete('Zanzibar');
    await call(`/api/coach/athletes/${id}`, { method: 'PATCH', as: 'real', json: { notes: 'Secret note' } });
    const res = await call(`/api/coach/athletes/${id}/draft`, { method: 'POST', as: 'real', json: { action: 'easy' } });
    const draft = await res.json() as { body: string };
    expect(draft.body).toBe('Zanzibar, easy today.');
    const all = seen.join('\n');
    expect(all).not.toContain('Zanzibar');
    expect(all).not.toContain('Secret note');
    expect(all).not.toContain('Tempo run');
  });

  it('swapping to easy changes the plan and remembers the original', async () => {
    const { id } = await addAthlete();
    await call(`/api/coach/athletes/${id}/send`, { method: 'POST', as: 'real', json: { action: 'easy', body: 'Easy' } });
    const [plan] = await db.select().from(plans).where(eq(plans.athleteId, id));
    expect(plan?.intensity).toBe('easy');
    expect(plan?.originalTitle).toBe('Tempo run');
  });

  it('keeping the plan leaves it alone', async () => {
    const { id } = await addAthlete();
    await call(`/api/coach/athletes/${id}/send`, { method: 'POST', as: 'real', json: { action: 'keep', body: 'Go' } });
    const [plan] = await db.select().from(plans).where(eq(plans.athleteId, id));
    expect(plan?.title).toBe('Tempo run');
    expect(plan?.originalTitle).toBeNull();
  });

  it('refuses an empty message', async () => {
    const { id } = await addAthlete();
    const res = await call(`/api/coach/athletes/${id}/send`, { method: 'POST', as: 'real', json: { action: 'keep', body: '  ' } });
    expect(res.status).toBe(400);
  });

  it('bulk send reaches only Ready athletes without a message, and skips Judge notifications', async () => {
    await call('/api/demo/start', { method: 'POST' });
    const before = await (await call('/api/coach/board', { as: 'demo' })).json() as { counts: { ready: number } };
    const res = await call('/api/coach/bulk-ready', { method: 'POST', as: 'demo' });
    expect(((await res.json()) as { sent: number }).sent).toBe(before.counts.ready);
    expect(notifier.messageWaiting).not.toHaveBeenCalled();
    const again = await call('/api/coach/bulk-ready', { method: 'POST', as: 'demo' });
    expect(((await again.json()) as { sent: number }).sent).toBe(0);
  });
});

describe('athlete link', () => {
  const tokenOf = (link: string): string => link.split('/').at(-1)!;

  it('unknown links are refused', async () => {
    expect((await call('/api/a/nope')).status).toBe(404);
  });

  it('rotating the link kills the old one', async () => {
    const { id, link } = await addAthlete();
    const res = await call(`/api/coach/athletes/${id}/rotate-link`, { method: 'POST', as: 'real' });
    const fresh = await res.json() as { link: string };
    expect((await call(`/api/a/${tokenOf(link)}`)).status).toBe(404);
    expect((await call(`/api/a/${tokenOf(fresh.link)}`)).status).toBe(200);
  });

  it('shows numbers only if the coach allows it', async () => {
    const { id, link } = await addAthlete();
    const session = new CheckinSession();
    const synth = new BodySynth(1);
    for (let i = 0; i < 800; i++) session.ingest(synth.step('sim'));
    await saveCheckin(db, id, TODAY, session.result(), 'sim');
    const token = tokenOf(link);
    const hidden = await (await call(`/api/a/${token}`)).json() as { numbers: unknown; checkedIn: boolean };
    expect(hidden.checkedIn).toBe(true);
    expect(hidden.numbers).toBeNull();
    await call(`/api/coach/athletes/${id}`, { method: 'PATCH', as: 'real', json: { showNumbers: true } });
    const shown = await (await call(`/api/a/${token}`)).json() as { numbers: { pulse: number } };
    expect(shown.numbers.pulse).toBeGreaterThan(40);
  });

  it('answers attach to today’s check-in, and need a check-in first', async () => {
    const { id, link } = await addAthlete();
    const token = tokenOf(link);
    const early = await call(`/api/a/${token}/answers`, { method: 'POST', json: { sleep: 7, feel: 4 } });
    expect(early.status).toBe(409);
    const session = new CheckinSession();
    const synth = new BodySynth(1);
    for (let i = 0; i < 800; i++) session.ingest(synth.step('sim'));
    await saveCheckin(db, id, TODAY, session.result(), 'sim');
    await call(`/api/a/${token}/answers`, { method: 'POST', json: { sleep: 7.5, feel: 4 } });
    const [row] = await db.select().from(checkins).where(eq(checkins.athleteId, id));
    expect([row?.sleep, row?.feel]).toEqual([7.5, 4]);
    expect((await call(`/api/a/${token}/answers`, { method: 'POST', json: { sleep: 7, feel: 9 } })).status).toBe(400);
  });

  it('a second check-in on the same day replaces the first', async () => {
    const { id } = await addAthlete();
    const session = new CheckinSession();
    const synth = new BodySynth(1);
    for (let i = 0; i < 800; i++) session.ingest(synth.step('sim'));
    const first = await saveCheckin(db, id, TODAY, session.result(), 'sim');
    const second = await saveCheckin(db, id, TODAY, session.result(), 'sim');
    expect(second).toBe(first);
    expect(await db.select().from(checkins).where(eq(checkins.athleteId, id))).toHaveLength(1);
  });

  it('export contains the athlete’s data but not the link token', async () => {
    const { link } = await addAthlete();
    const res = await call(`/api/a/${tokenOf(link)}/export`);
    const text = await res.text();
    expect(text).toContain('Sam');
    expect(text).not.toContain(tokenOf(link));
  });

  it('delete removes everything and ends the link', async () => {
    const { id, link } = await addAthlete();
    const token = tokenOf(link);
    await call(`/api/coach/athletes/${id}/send`, { method: 'POST', as: 'real', json: { action: 'keep', body: 'Hi' } });
    expect((await call(`/api/a/${token}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/api/a/${token}`)).status).toBe(404);
    expect(await db.select().from(messages).where(eq(messages.athleteId, id))).toEqual([]);
    expect(await db.select().from(plans).where(eq(plans.athleteId, id))).toEqual([]);
  });
});
