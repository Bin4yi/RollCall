import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Only portable column types, so moving to Postgres is a change of driver and dialect import. */

/** Real coach data and Judge Mode's seeded data never mix. */
export type Workspace = 'real' | 'demo';
export type Intensity = 'hard' | 'moderate' | 'easy' | 'rest';
export type CoachAction = 'keep' | 'easy' | 'rest' | 'custom';
export type CoachStyle = 'warm' | 'direct' | 'funny';

export const settings = sqliteTable('settings', {
  workspace: text('workspace').primaryKey().$type<Workspace>(),
  style: text('style').notNull().default('warm').$type<CoachStyle>(),
});

export const athletes = sqliteTable(
  'athletes',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace').notNull().$type<Workspace>(),
    name: text('name').notNull(),
    sport: text('sport').notNull(),
    squad: text('squad').notNull().default(''),
    avatar: text('avatar'),
    token: text('token').notNull(),
    showNumbers: integer('show_numbers', { mode: 'boolean' }).notNull().default(false),
    email: text('email'),
    notes: text('notes').notNull().default(''),
    consentAt: text('consent_at'),
  },
  (t) => [uniqueIndex('athletes_token').on(t.token)],
);

export const checkins = sqliteTable(
  'checkins',
  {
    id: text('id').primaryKey(),
    athleteId: text('athlete_id').notNull(),
    date: text('date').notNull(),
    kind: text('kind').notNull().default('morning').$type<'morning' | 'settle'>(),
    source: text('source').notNull().$type<'live' | 'replay' | 'sim' | 'demo'>(),
    pulse: real('pulse'),
    pulseConf: real('pulse_conf'),
    breath: real('breath'),
    breathConf: real('breath_conf'),
    rmssd: real('rmssd'),
    sdnn: real('sdnn'),
    meanNn: real('mean_nn'),
    stress: real('stress'),
    hrvConf: real('hrv_conf'),
    pulseOutOfRange: integer('pulse_out_of_range', { mode: 'boolean' }).notNull().default(false),
    sleep: real('sleep'),
    feel: integer('feel'),
    /** Settle checks: minutes since finishing, and what the session was. */
    minutesAfter: integer('minutes_after'),
    sessionIntensity: text('session_intensity').$type<Intensity>(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('checkins_one_per_day').on(t.athleteId, t.date, t.kind)],
);

export const plans = sqliteTable(
  'plans',
  {
    athleteId: text('athlete_id').notNull(),
    date: text('date').notNull(),
    title: text('title').notNull(),
    intensity: text('intensity').notNull().$type<Intensity>(),
    /** What the plan was before the coach changed it, if they did. */
    originalTitle: text('original_title'),
  },
  (t) => [uniqueIndex('plans_one_per_day').on(t.athleteId, t.date)],
);

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  athleteId: text('athlete_id').notNull(),
  date: text('date').notNull(),
  action: text('action').notNull().$type<CoachAction>(),
  body: text('body').notNull(),
  sentAt: text('sent_at').notNull(),
  readAt: text('read_at'),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  athleteId: text('athlete_id').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
});

/**
 * Applied on every start. Hand-written so the app needs no build step or migration tool at runtime,
 * and additive only: IF NOT EXISTS keeps existing data.
 */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS settings (workspace TEXT PRIMARY KEY, style TEXT NOT NULL DEFAULT 'warm')`,
  `CREATE TABLE IF NOT EXISTS athletes (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT NOT NULL, sport TEXT NOT NULL, squad TEXT NOT NULL DEFAULT '', avatar TEXT, token TEXT NOT NULL, show_numbers INTEGER NOT NULL DEFAULT 0, email TEXT, notes TEXT NOT NULL DEFAULT '', consent_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS athletes_token ON athletes (token)`,
  `CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'morning', source TEXT NOT NULL, pulse REAL, pulse_conf REAL, breath REAL, breath_conf REAL, rmssd REAL, sdnn REAL, mean_nn REAL, stress REAL, hrv_conf REAL, pulse_out_of_range INTEGER NOT NULL DEFAULT 0, sleep REAL, feel INTEGER, minutes_after INTEGER, session_intensity TEXT, created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS checkins_one_per_day ON checkins (athlete_id, date, kind)`,
  `CREATE TABLE IF NOT EXISTS plans (athlete_id TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, intensity TEXT NOT NULL, original_title TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS plans_one_per_day ON plans (athlete_id, date)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, date TEXT NOT NULL, action TEXT NOT NULL, body TEXT NOT NULL, sent_at TEXT NOT NULL, read_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL)`,
];
