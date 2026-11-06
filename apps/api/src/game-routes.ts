import {
  chooseToday,
  createCrew,
  crewMembers,
  CREW_COLOURS,
  finishSession,
  joinCrew,
  leaveCrew,
  loadCamp,
  loadCrewFeed,
  loadInsights,
  loadMap,
  loadRecap,
  loadToday,
  markDone,
  removeMember,
  saveBalance,
  saveLegs,
  saveSet,
  sendNudge,
  startSession,
  type athletes,
  type Db,
  type PoseSource,
} from '@rollcall/db';
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import type { Notifier } from './notify';

type Athlete = typeof athletes.$inferSelect;

const G = 9.81;

const JumpSchema = z.object({
  flightMs: z.number().min(0).max(5000),
  hipRiseM: z.number().min(-1).max(3),
  kneeAtTakeoff: z.number().min(0).max(180),
  kneeAtLanding: z.number().min(0).max(180),
  airFrames: z.number().int().min(0).max(1000),
  fps: z.number().min(0).max(1000),
  valid: z.boolean(),
  problem: z.string().max(40).optional(),
});

const SourceSchema = z.enum(['live', 'replay', 'sim']);

const SetSchema = z.object({
  exercise: z.string().max(20),
  reps: z.number().int().min(0).max(500),
  partials: z.number().int().min(0).max(500),
  fastest: z.number().min(0).max(100),
  slowest: z.number().min(0).max(100),
  speedDrop: z.number().min(0).max(1),
  avgDepth: z.number().min(0).max(3),
  flagCounts: z.record(z.string().max(20), z.number().int().min(0)),
  stopSuggestedAt: z.number().int().nullable(),
  holdSeconds: z.number().min(0).max(36000).optional(),
  sagShare: z.number().min(0).max(1).optional(),
  durationMs: z.number().min(0),
  repList: z
    .array(
      z.object({
        n: z.number().int(),
        speed: z.number().min(0).max(100),
        drop: z.number().min(0).max(1),
        depth: z.number().min(0).max(3),
        durationMs: z.number().min(0),
        flags: z.array(z.string().max(20)).max(10),
      }),
    )
    .max(500),
});

/** A small per-person limiter for the crew actions. In memory, so one server, which is all this runs on. */
function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) return false;
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export interface GameDeps {
  db: Db;
  env: Env;
  today: () => string;
  notifier: Notifier;
  byToken: (token: string) => Promise<Athlete | null>;
}

/** The athlete's Legs, Train and Crews routes. The private link is the credential. Points never come in. */
export function mountGame(athlete: Hono<never>, deps: GameDeps): void {
  const { db, env, today, notifier, byToken } = deps;
  const crewLimit = rateLimiter(30, 60_000);

  const bodyOf = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  };

  /** Judge Mode has no camera, and a real reading can't be replaced by a fake one in production. */
  const sourceFor = (a: Athlete, requested: 'live' | 'replay' | 'sim'): PoseSource | null => {
    if (a.workspace === 'demo') return requested === 'live' ? null : requested;
    if (requested !== 'live' && !env.allowSimForReal) return null;
    return requested;
  };

  const withAthlete = (handler: (c: Context, a: Athlete) => Promise<Response> | Response) => async (c: Context) => {
    const a = await byToken(c.req.param('token') ?? '');
    if (!a) return c.json({ error: 'Not found' }, 404);
    return handler(c, a);
  };

  const limited = (handler: (c: Context, a: Athlete) => Promise<Response> | Response) =>
    withAthlete((c, a) => (crewLimit(a.id) ? handler(c, a) : c.json({ error: 'That’s a lot of taps. Give it a minute.' }, 429)));

  athlete.post(
    '/:token/legs',
    withAthlete(async (c, a) => {
      const body = await bodyOf(c, z.object({ jumps: z.array(JumpSchema).min(1).max(6), source: SourceSchema }));
      if (!body) return c.json({ error: 'Check those jumps.' }, 400);
      const source = sourceFor(a, body.source);
      if (!source) return c.json({ error: 'Live checks only.' }, 403);
      // Height is always worked out here from flight time, so a client can't just name a number.
      const jumps = body.jumps.map((j) => {
        const seconds = j.flightMs / 1000;
        return { ...j, heightM: (G * seconds * seconds) / 8, valid: j.valid && j.flightMs >= 150 && j.flightMs <= 1000 };
      });
      await saveLegs(db, a, today(), { kind: 'jumps', jumps, source });
      return c.json({ today: await loadToday(db, a, today()) });
    }),
  );

  athlete.post(
    '/:token/legs/skip',
    withAthlete(async (c, a) => {
      await saveLegs(db, a, today(), { kind: 'skipped', source: a.workspace === 'demo' ? 'demo' : 'live' });
      return c.json({ today: await loadToday(db, a, today()) });
    }),
  );

  athlete.post(
    '/:token/balance',
    withAthlete(async (c, a) => {
      const body = await bodyOf(
        c,
        z.object({
          results: z
            .array(z.object({ side: z.enum(['left', 'right']), swayPct: z.number().min(0).max(200), touches: z.number().int().min(0).max(500), seconds: z.number().min(0).max(120) }))
            .min(1)
            .max(2),
          source: SourceSchema,
        }),
      );
      if (!body) return c.json({ error: 'Check that test.' }, 400);
      const source = sourceFor(a, body.source);
      if (!source) return c.json({ error: 'Live checks only.' }, 403);
      await saveBalance(db, a, today(), body.results, source);
      return c.json({ today: await loadToday(db, a, today()) });
    }),
  );

  athlete.post(
    '/:token/call',
    withAthlete(async (c, a) => {
      const body = await bodyOf(c, z.object({ choice: z.enum(['planned', 'moderate', 'upper', 'easy', 'rest']) }));
      if (!body) return c.json({ error: 'Choose one.' }, 400);
      const view = await chooseToday(db, a, today(), body.choice);
      return view ? c.json({ today: view }) : c.json({ error: 'Check in first.' }, 409);
    }),
  );

  athlete.post(
    '/:token/call/done',
    withAthlete(async (c, a) => {
      if (!(await markDone(db, a, today()))) return c.json({ error: 'Choose today’s call first.' }, 409);
      return c.json({ today: await loadToday(db, a, today()) });
    }),
  );

  athlete.post(
    '/:token/train',
    withAthlete(async (c, a) => {
      const body = await bodyOf(c, z.object({ source: SourceSchema }));
      if (!body) return c.json({ error: 'Bad request.' }, 400);
      const source = sourceFor(a, body.source);
      if (!source) return c.json({ error: 'Live sessions only.' }, 403);
      return c.json({ id: await startSession(db, a, today(), source) }, 201);
    }),
  );

  athlete.post(
    '/:token/train/:id/sets',
    withAthlete(async (c, a) => {
      const body = await bodyOf(c, SetSchema);
      if (!body) return c.json({ error: 'Check that set.' }, 400);
      if (!(await saveSet(db, a.id, c.req.param('id') ?? '', body))) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true });
    }),
  );

  athlete.post(
    '/:token/train/:id/finish',
    withAthlete(async (c, a) => {
      if (!(await finishSession(db, a, c.req.param('id') ?? '', today()))) return c.json({ error: 'Not found' }, 404);
      return c.json({ today: await loadToday(db, a, today()) });
    }),
  );

  athlete.get(
    '/:token/insights',
    withAthlete(async (c, a) => c.json({ insights: await loadInsights(db, a.id) })),
  );

  athlete.post(
    '/:token/crews',
    limited(async (c, a) => {
      const body = await bodyOf(
        c,
        z.object({
          name: z.string().trim().min(2).max(40),
          emblem: z.string().regex(/^emblem_[a-z]+$/),
          colour: z.enum(CREW_COLOURS),
        }),
      );
      if (!body) return c.json({ error: 'A name and an emblem are needed.' }, 400);
      const made = await createCrew(db, a, today(), body);
      return 'error' in made ? c.json(made, 409) : c.json(made, 201);
    }),
  );

  athlete.post(
    '/:token/crews/join',
    limited(async (c, a) => {
      const body = await bodyOf(c, z.object({ code: z.string().trim().min(4).max(20) }));
      if (!body) return c.json({ error: 'Enter the code.' }, 400);
      const joined = await joinCrew(db, a, today(), body.code);
      return 'error' in joined ? c.json(joined, 409) : c.json(joined);
    }),
  );

  athlete.post(
    '/:token/crew/leave',
    limited(async (c, a) => {
      await leaveCrew(db, a.id, today());
      return c.json({ ok: true });
    }),
  );

  athlete.post(
    '/:token/crew/remove',
    limited(async (c, a) => {
      const body = await bodyOf(c, z.object({ athleteId: z.string() }));
      if (!body || !(await removeMember(db, a, body.athleteId, today()))) return c.json({ error: 'Only the crew’s owner can do that.' }, 403);
      return c.json({ ok: true });
    }),
  );

  athlete.post(
    '/:token/crew/nudge',
    limited(async (c, a) => {
      const body = await bodyOf(c, z.object({ athleteId: z.string() }));
      if (!body) return c.json({ error: 'Who should Rollo nudge?' }, 400);
      const sent = await sendNudge(db, a, body.athleteId, today());
      if ('error' in sent) return c.json(sent, 409);
      if (a.workspace === 'real') await notifier.nudge?.(sent.to, a.name);
      return c.json({ ok: true });
    }),
  );

  athlete.post(
    '/:token/crew/sharing',
    limited(async (c, a) => {
      const body = await bodyOf(c, z.object({ showPoints: z.boolean().optional(), showStreak: z.boolean().optional() }));
      if (!body) return c.json({ error: 'Bad request.' }, 400);
      if (Object.keys(body).length) await db.update(crewMembers).set(body).where(eq(crewMembers.athleteId, a.id));
      return c.json({ ok: true });
    }),
  );

  athlete.get(
    '/:token/crew',
    withAthlete(async (c, a) => c.json({ feed: await loadCrewFeed(db, a.id, today()), recap: await loadRecap(db, a.id) })),
  );

  athlete.get(
    '/:token/map',
    withAthlete(async (c, a) => {
      const map = await loadMap(db, a.id, today());
      return map ? c.json(map) : c.json({ error: 'Join a crew first.' }, 404);
    }),
  );

  athlete.get(
    '/:token/camp',
    withAthlete(async (c, a) => c.json(await loadCamp(db, a.id))),
  );

  /** A teammate's buildings, never their readings. */
  athlete.get(
    '/:token/camp/:id',
    withAthlete(async (c, a) => {
      const id = c.req.param('id') ?? '';
      const [me] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, a.id));
      const [them] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, id));
      if (!me || !them || me.crewId !== them.crewId) return c.json({ error: 'Not found' }, 404);
      return c.json(await loadCamp(db, id));
    }),
  );
}
