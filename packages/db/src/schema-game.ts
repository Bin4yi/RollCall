import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Intensity, Workspace } from './schema';

/** Legs check, Train mode and Crews. Pose frames never reach any of these: only derived numbers do. */

export type PoseSource = 'live' | 'replay' | 'sim' | 'demo';

/** One row per person per day: what happened with the legs. */
export const legsDays = sqliteTable(
  'legs_days',
  {
    athleteId: text('athlete_id').notNull(),
    date: text('date').notNull(),
    kind: text('kind').notNull().$type<'jumps' | 'balance' | 'skipped'>(),
    /** Best valid jump height, an estimate in metres. Null if no jump was valid. */
    bestM: real('best_m'),
    source: text('source').notNull().$type<PoseSource>(),
    fps: real('fps'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('legs_days_one').on(t.athleteId, t.date)],
);

export const jumps = sqliteTable('jumps', {
  id: text('id').primaryKey(),
  athleteId: text('athlete_id').notNull(),
  date: text('date').notNull(),
  n: integer('n').notNull(),
  flightMs: real('flight_ms').notNull(),
  heightM: real('height_m').notNull(),
  hipRiseM: real('hip_rise_m').notNull(),
  kneeAtTakeoff: real('knee_at_takeoff').notNull(),
  kneeAtLanding: real('knee_at_landing').notNull(),
  airFrames: integer('air_frames').notNull(),
  fps: real('fps').notNull(),
  valid: integer('valid', { mode: 'boolean' }).notNull(),
  problem: text('problem'),
});

export const balanceTests = sqliteTable('balance_tests', {
  id: text('id').primaryKey(),
  athleteId: text('athlete_id').notNull(),
  date: text('date').notNull(),
  side: text('side').notNull().$type<'left' | 'right'>(),
  swayPct: real('sway_pct').notNull(),
  touches: integer('touches').notNull(),
  seconds: real('seconds').notNull(),
  source: text('source').notNull().$type<PoseSource>(),
});

/** What Rollo suggested and what the person chose. `listened` is worked out on the server. */
export const dailyCalls = sqliteTable(
  'daily_calls',
  {
    athleteId: text('athlete_id').notNull(),
    date: text('date').notNull(),
    heart: text('heart').notNull(),
    legs: text('legs').notNull(),
    suggestion: text('suggestion').notNull(),
    choice: text('choice').notNull(),
    intensity: text('intensity').notNull().$type<Intensity>(),
    plannedIntensity: text('planned_intensity').notNull().$type<Intensity>(),
    listened: integer('listened', { mode: 'boolean' }).notNull(),
    chosenAt: text('chosen_at').notNull(),
    doneAt: text('done_at'),
  },
  (t) => [uniqueIndex('daily_calls_one').on(t.athleteId, t.date)],
);

export const trainSessions = sqliteTable('train_sessions', {
  id: text('id').primaryKey(),
  athleteId: text('athlete_id').notNull(),
  date: text('date').notNull(),
  title: text('title').notNull(),
  intensity: text('intensity').notNull().$type<Intensity>(),
  /** The morning's status, so later insights can compare days. */
  morningStatus: text('morning_status').notNull(),
  legsKind: text('legs_kind').notNull(),
  source: text('source').notNull().$type<PoseSource>(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

export const sets = sqliteTable('sets', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  n: integer('n').notNull(),
  exercise: text('exercise').notNull(),
  reps: integer('reps').notNull(),
  partials: integer('partials').notNull(),
  fastest: real('fastest').notNull(),
  slowest: real('slowest').notNull(),
  speedDrop: real('speed_drop').notNull(),
  avgDepth: real('avg_depth').notNull(),
  flags: text('flags').notNull(),
  stopSuggestedAt: integer('stop_suggested_at'),
  holdSeconds: real('hold_seconds'),
  sagShare: real('sag_share'),
  durationMs: real('duration_ms').notNull(),
});

export const reps = sqliteTable('reps', {
  id: text('id').primaryKey(),
  setId: text('set_id').notNull(),
  n: integer('n').notNull(),
  speed: real('speed').notNull(),
  drop: real('drop').notNull(),
  depth: real('depth').notNull(),
  durationMs: real('duration_ms').notNull(),
  flags: text('flags').notNull(),
});

export const leagues = sqliteTable('leagues', {
  id: text('id').primaryKey(),
  workspace: text('workspace').notNull().$type<Workspace>(),
  tier: integer('tier').notNull(),
});

export const seasons = sqliteTable('seasons', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  status: text('status').notNull().$type<'open' | 'closed'>(),
  /** Per-crew recap cards, written when the season closes. */
  recap: text('recap'),
});

export const crews = sqliteTable('crews', {
  id: text('id').primaryKey(),
  workspace: text('workspace').notNull().$type<Workspace>(),
  leagueId: text('league_id').notNull(),
  name: text('name').notNull(),
  emblem: text('emblem').notNull(),
  colour: text('colour').notNull(),
  ownerId: text('owner_id').notNull(),
  homeQ: integer('home_q').notNull(),
  homeR: integer('home_r').notNull(),
  createdAt: text('created_at').notNull(),
});

export const crewMembers = sqliteTable(
  'crew_members',
  {
    crewId: text('crew_id').notNull(),
    athleteId: text('athlete_id').notNull(),
    joinedAt: text('joined_at').notNull(),
    showPoints: integer('show_points', { mode: 'boolean' }).notNull().default(true),
    showStreak: integer('show_streak', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [uniqueIndex('crew_members_one_crew').on(t.athleteId)],
);

export const crewInvites = sqliteTable('crew_invites', {
  code: text('code').primaryKey(),
  crewId: text('crew_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const mapTiles = sqliteTable(
  'map_tiles',
  {
    leagueId: text('league_id').notNull(),
    q: integer('q').notNull(),
    r: integer('r').notNull(),
    kind: text('kind').notNull(),
  },
  (t) => [uniqueIndex('map_tiles_one').on(t.leagueId, t.q, t.r)],
);

/** The map at the end of each day, per season. Today's row set is rewritten as points arrive. */
export const tileClaims = sqliteTable(
  'tile_claims',
  {
    seasonId: text('season_id').notNull(),
    date: text('date').notNull(),
    q: integer('q').notNull(),
    r: integer('r').notNull(),
    crewId: text('crew_id').notNull(),
    light: real('light').notNull(),
    /** Set on the day a tile changed hands, for the animation and the feed. */
    takenFrom: text('taken_from'),
    claimedToday: integer('claimed_today', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('tile_claims_one').on(t.seasonId, t.date, t.q, t.r)],
);

/** Append-only. Every entry has a reason and is worked out on the server from stored rows. */
export const pointsLedger = sqliteTable(
  'points_ledger',
  {
    id: text('id').primaryKey(),
    athleteId: text('athlete_id').notNull(),
    date: text('date').notNull(),
    reason: text('reason').notNull(),
    points: integer('points').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('points_ledger_once').on(t.athleteId, t.date, t.reason)],
);

export const camps = sqliteTable('camps', {
  athleteId: text('athlete_id').primaryKey(),
  /** Buildings earned. Only ever goes up. */
  stage: integer('stage').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const nudges = sqliteTable(
  'nudges',
  {
    id: text('id').primaryKey(),
    fromId: text('from_id').notNull(),
    toId: text('to_id').notNull(),
    date: text('date').notNull(),
    seenAt: text('seen_at'),
  },
  (t) => [uniqueIndex('nudges_once_a_day').on(t.toId, t.date)],
);

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  athleteId: text('athlete_id'),
  action: text('action').notNull(),
  detail: text('detail').notNull().default(''),
});

export const GAME_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS legs_days (athlete_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, best_m REAL, source TEXT NOT NULL, fps REAL, created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS legs_days_one ON legs_days (athlete_id, date)`,
  `CREATE TABLE IF NOT EXISTS jumps (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, date TEXT NOT NULL, n INTEGER NOT NULL, flight_ms REAL NOT NULL, height_m REAL NOT NULL, hip_rise_m REAL NOT NULL, knee_at_takeoff REAL NOT NULL, knee_at_landing REAL NOT NULL, air_frames INTEGER NOT NULL, fps REAL NOT NULL, valid INTEGER NOT NULL, problem TEXT)`,
  `CREATE TABLE IF NOT EXISTS balance_tests (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, date TEXT NOT NULL, side TEXT NOT NULL, sway_pct REAL NOT NULL, touches INTEGER NOT NULL, seconds REAL NOT NULL, source TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS daily_calls (athlete_id TEXT NOT NULL, date TEXT NOT NULL, heart TEXT NOT NULL, legs TEXT NOT NULL, suggestion TEXT NOT NULL, choice TEXT NOT NULL, intensity TEXT NOT NULL, planned_intensity TEXT NOT NULL, listened INTEGER NOT NULL, chosen_at TEXT NOT NULL, done_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS daily_calls_one ON daily_calls (athlete_id, date)`,
  `CREATE TABLE IF NOT EXISTS train_sessions (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, intensity TEXT NOT NULL, morning_status TEXT NOT NULL, legs_kind TEXT NOT NULL, source TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS sets (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, n INTEGER NOT NULL, exercise TEXT NOT NULL, reps INTEGER NOT NULL, partials INTEGER NOT NULL, fastest REAL NOT NULL, slowest REAL NOT NULL, speed_drop REAL NOT NULL, avg_depth REAL NOT NULL, flags TEXT NOT NULL, stop_suggested_at INTEGER, hold_seconds REAL, sag_share REAL, duration_ms REAL NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reps (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, n INTEGER NOT NULL, speed REAL NOT NULL, "drop" REAL NOT NULL, depth REAL NOT NULL, duration_ms REAL NOT NULL, flags TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leagues (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, tier INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS seasons (id TEXT PRIMARY KEY, league_id TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL, status TEXT NOT NULL, recap TEXT)`,
  `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, league_id TEXT NOT NULL, name TEXT NOT NULL, emblem TEXT NOT NULL, colour TEXT NOT NULL, owner_id TEXT NOT NULL, home_q INTEGER NOT NULL, home_r INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS crew_members (crew_id TEXT NOT NULL, athlete_id TEXT NOT NULL, joined_at TEXT NOT NULL, show_points INTEGER NOT NULL DEFAULT 1, show_streak INTEGER NOT NULL DEFAULT 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crew_members_one_crew ON crew_members (athlete_id)`,
  `CREATE TABLE IF NOT EXISTS crew_invites (code TEXT PRIMARY KEY, crew_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS map_tiles (league_id TEXT NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, kind TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS map_tiles_one ON map_tiles (league_id, q, r)`,
  `CREATE TABLE IF NOT EXISTS tile_claims (season_id TEXT NOT NULL, date TEXT NOT NULL, q INTEGER NOT NULL, r INTEGER NOT NULL, crew_id TEXT NOT NULL, light REAL NOT NULL, taken_from TEXT, claimed_today INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tile_claims_one ON tile_claims (season_id, date, q, r)`,
  `CREATE TABLE IF NOT EXISTS points_ledger (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL, date TEXT NOT NULL, reason TEXT NOT NULL, points INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS points_ledger_once ON points_ledger (athlete_id, date, reason)`,
  `CREATE TABLE IF NOT EXISTS camps (athlete_id TEXT PRIMARY KEY, stage INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nudges (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, date TEXT NOT NULL, seen_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS nudges_once_a_day ON nudges (to_id, date)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, at TEXT NOT NULL, athlete_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`,
];
