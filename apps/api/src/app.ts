import { randomBytes, randomUUID } from 'node:crypto';
import {
  addDays,
  athletes,
  checkins,
  checkinStreak,
  deleteGameData,
  exportGameData,
  loadCamp,
  loadCrewFeed,
  loadInsights,
  loadToday,
  loadBoard,
  loadDetail,
  messages,
  plans,
  pushSubscriptions,
  seedDemo,
  settings,
  toReading,
  type CoachAction,
  type CoachStyle,
  type Db,
  type Workspace,
} from '@rollcall/db';
import {
  draftSignals,
  fillName,
  ollamaProvider,
  openAiProvider,
  templateDraft,
  writeDraft,
  type DraftProvider,
} from '@rollcall/drafts';
import { assessHistory } from '@rollcall/readiness';
import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { makeSession, passphraseMatches, readSession } from './auth';
import { mountGame } from './game-routes';
import type { Env } from './env';
import { silentNotifier, type Notifier } from './notify';

const COOKIE = 'rc_session';

export interface AppDeps {
  db: Db;
  env: Env;
  today: () => string;
  notifier?: Notifier;
  /** Tests inject a fake. Otherwise chosen from the environment. */
  draftProvider?: DraftProvider | null;
}

type Vars = { Variables: { workspace: Workspace } };

const ActionSchema = z.enum(['keep', 'easy', 'rest', 'custom']);

const PLAN_CHANGES: Partial<Record<CoachAction, { title: string; intensity: 'easy' | 'rest' }>> = {
  easy: { title: 'Easy session, coach’s swap', intensity: 'easy' },
  rest: { title: 'Rest day', intensity: 'rest' },
};

export function createApp(deps: AppDeps): Hono<Vars> {
  const { db, env, today } = deps;
  const notifier = deps.notifier ?? silentNotifier;
  const provider =
    deps.draftProvider !== undefined
      ? deps.draftProvider
      : env.ollamaUrl && env.ollamaModel
        ? ollamaProvider(env.ollamaUrl, env.ollamaModel)
        : env.openAiKey
          ? openAiProvider(env.openAiKey, env.openAiDraftModel)
          : null;

  const app = new Hono<Vars>();
  const startSession = (c: Context<Vars>, workspace: Workspace): void => {
    setCookie(c, COOKIE, makeSession(env.sessionSecret, workspace), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: env.production,
      path: '/',
      maxAge: 30 * 86_400,
    });
  };

  app.get('/api/config', (c) =>
    c.json({
      liveAvailable: env.liveAvailable,
      allowSim: env.allowSimForReal,
      vapidPublicKey: env.vapidPublic,
      coachLoginEnabled: !!env.coachPassphrase,
      recorder: !env.production,
    }),
  );

  app.post('/api/coach/login', async (c) => {
    const body = z.object({ passphrase: z.string() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success || !env.coachPassphrase || !passphraseMatches(env.coachPassphrase, body.data.passphrase)) {
      return c.json({ error: 'That passphrase didn’t match.' }, 401);
    }
    startSession(c, 'real');
    return c.json({ workspace: 'real' });
  });

  /** Judge Mode: fresh seeded data, no keys, no camera. */
  app.post('/api/demo/start', async (c) => {
    await seedDemo(db, today());
    startSession(c, 'demo');
    return c.json({ workspace: 'demo', checkinLink: '/a/demo-hana?mode=replay', morningLink: '/a/demo-amara' });
  });

  app.post('/api/coach/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // Everything for the coach, scoped to their workspace.
  const coach = new Hono<Vars>();
  coach.use('*', async (c, next) => {
    const workspace = readSession(env.sessionSecret, getCookie(c, COOKIE));
    if (!workspace) return c.json({ error: 'Please sign in.' }, 401);
    c.set('workspace', workspace);
    await next();
    return undefined;
  });

  const ownAthlete = async (workspace: Workspace, id: string) => {
    const [a] = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.id, id), eq(athletes.workspace, workspace)));
    return a ?? null;
  };

  const styleOf = async (workspace: Workspace): Promise<CoachStyle> => {
    const [s] = await db.select().from(settings).where(eq(settings.workspace, workspace));
    return s?.style ?? 'warm';
  };

  coach.get('/me', async (c) =>
    c.json({ workspace: c.var.workspace, style: await styleOf(c.var.workspace) }),
  );

  coach.get('/board', async (c) => c.json(await loadBoard(db, c.var.workspace, today())));

  coach.patch('/settings', async (c) => {
    const body = z.object({ style: z.enum(['warm', 'direct', 'funny']) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Choose a style.' }, 400);
    await db
      .insert(settings)
      .values({ workspace: c.var.workspace, style: body.data.style })
      .onConflictDoUpdate({ target: settings.workspace, set: { style: body.data.style } });
    return c.json({ style: body.data.style });
  });

  coach.post('/athletes', async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        sport: z.string().trim().min(1).max(40),
        squad: z.string().trim().max(40).default(''),
        email: z.email().optional(),
        plan: z.string().trim().max(120).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'A name and sport are needed.' }, 400);
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const { plan, ...fields } = body.data;
    await db.insert(athletes).values({ id, token, workspace: c.var.workspace, ...fields });
    if (plan) await db.insert(plans).values({ athleteId: id, date: today(), title: plan, intensity: 'moderate' });
    return c.json({ id, link: `/a/${token}` }, 201);
  });

  coach.get('/athletes/:id', async (c) => {
    const detail = await loadDetail(db, c.var.workspace, c.req.param('id'), today());
    return detail ? c.json(detail) : c.json({ error: 'Not found' }, 404);
  });

  coach.patch('/athletes/:id', async (c) => {
    const a = await ownAthlete(c.var.workspace, c.req.param('id'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const body = z
      .object({
        notes: z.string().max(4000).optional(),
        showNumbers: z.boolean().optional(),
        plan: z.object({ title: z.string().trim().min(1).max(120), intensity: z.enum(['hard', 'moderate', 'easy', 'rest']) }).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Check those values.' }, 400);
    const { plan, ...fields } = body.data;
    if (Object.keys(fields).length) await db.update(athletes).set(fields).where(eq(athletes.id, a.id));
    if (plan) {
      await db
        .insert(plans)
        .values({ athleteId: a.id, date: today(), ...plan })
        .onConflictDoUpdate({ target: [plans.athleteId, plans.date], set: plan });
    }
    return c.json({ ok: true });
  });

  coach.post('/athletes/:id/rotate-link', async (c) => {
    const a = await ownAthlete(c.var.workspace, c.req.param('id'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const token = randomBytes(24).toString('base64url');
    await db.update(athletes).set({ token }).where(eq(athletes.id, a.id));
    return c.json({ link: `/a/${token}` });
  });

  coach.post('/athletes/:id/draft', async (c) => {
    const a = await ownAthlete(c.var.workspace, c.req.param('id'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const body = z.object({ action: ActionSchema }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Choose an action.' }, 400);
    const date = today();
    const rows = await db
      .select()
      .from(checkins)
      .where(and(eq(checkins.athleteId, a.id), eq(checkins.kind, 'morning')));
    const assessment = assessHistory(rows.filter((r) => r.date <= date).map(toReading)).at(-1);
    const hasCheckedIn = assessment?.date === date;
    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.athleteId, a.id), eq(plans.date, date)));
    // Judge Mode never spends the owner's API credit.
    const draft = await writeDraft(
      {
        action: body.data.action,
        style: await styleOf(c.var.workspace),
        sessionIntensity: plan?.intensity,
        signals: hasCheckedIn && assessment ? draftSignals(assessment.deviations) : [],
        hasCheckedIn,
      },
      c.var.workspace === 'demo' ? null : provider,
    );
    return c.json({ body: fillName(draft.body, a.name), source: draft.source });
  });

  const applyDecision = async (
    a: { id: string; name: string; email: string | null; token: string },
    action: CoachAction,
    body: string,
    baseUrl: string,
    workspace: Workspace,
    customTitle?: string,
  ): Promise<void> => {
    const date = today();
    const change = customTitle ? { title: customTitle, intensity: 'moderate' as const } : PLAN_CHANGES[action];
    if (change) {
      const [current] = await db
        .select()
        .from(plans)
        .where(and(eq(plans.athleteId, a.id), eq(plans.date, date)));
      await db
        .insert(plans)
        .values({ athleteId: a.id, date, ...change })
        .onConflictDoUpdate({
          target: [plans.athleteId, plans.date],
          set: { ...change, originalTitle: current?.originalTitle ?? current?.title ?? null },
        });
    }
    await db.insert(messages).values({
      id: randomUUID(),
      athleteId: a.id,
      date,
      action,
      body,
      sentAt: new Date().toISOString(),
    });
    if (workspace === 'real') await notifier.messageWaiting(a, baseUrl);
  };

  /** The only way a message reaches an athlete: the coach pressed Send on this exact text. */
  coach.post('/athletes/:id/send', async (c) => {
    const a = await ownAthlete(c.var.workspace, c.req.param('id'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const body = z
      .object({
        action: ActionSchema,
        body: z.string().trim().min(1).max(2000),
        customTitle: z.string().trim().min(1).max(120).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Write a message first.' }, 400);
    await applyDecision(a, body.data.action, body.data.body, new URL(c.req.url).origin, c.var.workspace, body.data.customTitle);
    return c.json({ ok: true });
  });

  /** "All good, train as planned" to everyone Ready who has no message yet. The click is the approval. */
  coach.post('/bulk-ready', async (c) => {
    const board = await loadBoard(db, c.var.workspace, today());
    const style = await styleOf(c.var.workspace);
    const text = templateDraft({ action: 'keep', style, signals: [], hasCheckedIn: true });
    const targets = board.rows.filter((r) => r.status === 'ready' && !r.decided);
    for (const row of targets) {
      const a = await ownAthlete(c.var.workspace, row.id);
      if (a) await applyDecision(a, 'keep', fillName(text, a.name), new URL(c.req.url).origin, c.var.workspace);
    }
    return c.json({ sent: targets.length });
  });

  app.route('/api/coach', coach);

  // Everything for the athlete: the private link is the credential.
  const athlete = new Hono<Vars>();
  const byToken = async (token: string) => {
    const [a] = await db.select().from(athletes).where(eq(athletes.token, token));
    return a ?? null;
  };

  mountGame(athlete as never, { db, env, today, notifier, byToken });

  athlete.get('/:token', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'This link isn’t active. Ask your coach for a new one.' }, 404);
    const date = today();
    const rows = await db.select().from(checkins).where(eq(checkins.athleteId, a.id));
    const morning = rows.filter((r) => r.kind === 'morning');
    const todayRow = morning.find((r) => r.date === date);
    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.athleteId, a.id), eq(plans.date, date)));
    const inbox = await db.select().from(messages).where(eq(messages.athleteId, a.id));
    const feed = await loadCrewFeed(db, a.id, date);
    return c.json({
      today: await loadToday(db, a, date),
      insights: await loadInsights(db, a.id),
      camp: await loadCamp(db, a.id),
      crew: feed ? { name: feed.crew.name, emblem: feed.crew.emblem, checkedIn: feed.checkedIn, total: feed.total, streak: feed.crewStreak, todayPoints: feed.mine.today.reduce((s, e) => s + e.points, 0) } : null,
      name: a.name,
      avatar: a.avatar,
      sport: a.sport,
      demo: a.workspace === 'demo',
      consented: !!a.consentAt,
      streak: checkinStreak(morning.map((r) => r.date), date),
      checkedIn: !!todayRow,
      answered: todayRow ? todayRow.feel !== null : false,
      settleDone: rows.some((r) => r.kind === 'settle' && r.date === date),
      plan: plan ? { title: plan.title, intensity: plan.intensity } : null,
      numbers:
        a.showNumbers && todayRow
          ? { pulse: todayRow.pulse, breath: todayRow.breath, rmssd: todayRow.rmssd, stress: todayRow.stress }
          : null,
      messages: inbox
        .sort((x, y) => y.sentAt.localeCompare(x.sentAt))
        .slice(0, 10)
        .map((m) => ({ id: m.id, date: m.date, body: m.body, read: !!m.readAt })),
    });
  });

  athlete.post('/:token/consent', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    await db.update(athletes).set({ consentAt: new Date().toISOString() }).where(eq(athletes.id, a.id));
    return c.json({ ok: true });
  });

  athlete.post('/:token/answers', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const body = z
      .object({ sleep: z.number().min(0).max(14), feel: z.number().int().min(1).max(5) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Check those answers.' }, 400);
    const date = today();
    const [row] = await db
      .select()
      .from(checkins)
      .where(and(eq(checkins.athleteId, a.id), eq(checkins.date, date), eq(checkins.kind, 'morning')));
    if (!row) return c.json({ error: 'Check in first.' }, 409);
    await db.update(checkins).set(body.data).where(eq(checkins.id, row.id));
    return c.json({ ok: true });
  });

  athlete.post('/:token/settle-details', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const body = z
      .object({ minutesAfter: z.number().int().min(0).max(240) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Check that answer.' }, 400);
    const date = today();
    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.athleteId, a.id), eq(plans.date, date)));
    await db
      .update(checkins)
      .set({ minutesAfter: body.data.minutesAfter, sessionIntensity: plan?.intensity ?? null })
      .where(and(eq(checkins.athleteId, a.id), eq(checkins.date, date), eq(checkins.kind, 'settle')));
    return c.json({ ok: true });
  });

  athlete.post('/:token/messages/:id/read', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    await db
      .update(messages)
      .set({ readAt: new Date().toISOString() })
      .where(and(eq(messages.id, c.req.param('id')), eq(messages.athleteId, a.id)));
    return c.json({ ok: true });
  });

  athlete.post('/:token/push', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const body = z
      .object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Bad subscription.' }, 400);
    const row = { endpoint: body.data.endpoint, athleteId: a.id, ...body.data.keys };
    await db
      .insert(pushSubscriptions)
      .values(row)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row });
    return c.json({ ok: true });
  });

  /** Everything we hold about this athlete. */
  athlete.get('/:token/export', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    const { token: _token, workspace: _workspace, ...profile } = a;
    const body = {
      exportedAt: new Date().toISOString(),
      profile,
      checkins: await db.select().from(checkins).where(eq(checkins.athleteId, a.id)),
      plans: await db.select().from(plans).where(eq(plans.athleteId, a.id)),
      messages: await db.select().from(messages).where(eq(messages.athleteId, a.id)),
      ...(await exportGameData(db, a.id)),
    };
    c.header('Content-Disposition', 'attachment; filename="roll-call-my-data.json"');
    return c.json(body);
  });

  /** Deletes everything we hold. The link stops working. */
  athlete.delete('/:token', async (c) => {
    const a = await byToken(c.req.param('token'));
    if (!a) return c.json({ error: 'Not found' }, 404);
    await deleteGameData(db, a.id, today());
    await db.delete(checkins).where(eq(checkins.athleteId, a.id));
    await db.delete(plans).where(eq(plans.athleteId, a.id));
    await db.delete(messages).where(eq(messages.athleteId, a.id));
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.athleteId, a.id));
    await db.delete(athletes).where(eq(athletes.id, a.id));
    return c.json({ ok: true });
  });

  app.route('/api/a', athlete);
  return app;
}

export { addDays };
