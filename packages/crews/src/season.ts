/** Seasons and leagues: one week, most lit territory wins, promotion and relegation at the end. */
export const LEAGUE_TIERS = ['Dawn', 'Morning', 'Midday', 'Golden Hour'] as const;
export type LeagueTier = (typeof LEAGUE_TIERS)[number];

export const SEASON_DAYS = 7;
/** Below this many crews a league has no promotion or relegation. */
export const MIN_CREWS_TO_MOVE = 3;

export interface SeasonEntry {
  crewId: string;
  tiles: number;
  points: number;
}

export interface Ranked extends SeasonEntry {
  rank: number;
  move: 'up' | 'down' | 'stay';
}

/** Most tiles wins, then most points, then a stable order. */
export function rankSeason(entries: readonly SeasonEntry[], tier: number): Ranked[] {
  const sorted = [...entries].sort((a, b) => b.tiles - a.tiles || b.points - a.points || a.crewId.localeCompare(b.crewId));
  const moves = sorted.length >= MIN_CREWS_TO_MOVE;
  return sorted.map((e, i) => {
    let move: Ranked['move'] = 'stay';
    if (moves && i === 0 && tier < LEAGUE_TIERS.length - 1) move = 'up';
    if (moves && i === sorted.length - 1 && tier > 0) move = 'down';
    return { ...e, rank: i + 1, move };
  });
}

/** The Monday-to-Sunday week holding `date`. */
export function seasonWeek(date: string): { start: string; end: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - offset);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + SEASON_DAYS - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export interface Recap {
  crewName: string;
  league: string;
  rank: number;
  crews: number;
  tiles: number;
  bestStreak: number;
  /** Most smart calls this season. Decisions, never performance. */
  mvp: { name: string; smartCalls: number } | null;
  move: Ranked['move'];
  seasonStart: string;
  seasonEnd: string;
}
