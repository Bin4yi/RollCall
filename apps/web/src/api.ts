export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      headers: init.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Can’t reach Roll Call. Check your connection.', 0);
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(body?.error ?? 'Something went wrong.', res.status);
  return body as T;
}

export interface CallOption {
  choice: string;
  label: string;
  intensity: string;
  suggested: boolean;
}

export interface TodayView {
  heartStatus: string | null;
  legs: { kind: string; pct: number | null; have: number; need: number };
  legsDone: boolean;
  legsKind: string | null;
  call: { heart: string; legs: string; suggestion: string; why: string; options: CallOption[] } | null;
  chosen: { choice: string; intensity: string; done: boolean; listened: boolean; suggestion: string } | null;
  gentleCard: boolean;
  nudged: boolean;
  plan: { title: string; intensity: string };
}

export interface CampView {
  name: string;
  stage: number;
  buildings: { id: string; name: string }[];
  next: { name: string; left: number } | null;
}

export interface CrewFeed {
  crew: { id: string; name: string; emblem: string; colour: string; code: string; ownerIsYou: boolean; league: string };
  members: { id: string; name: string; avatar: string | null; checkedIn: boolean; isYou: boolean; points?: number; streak?: number; canNudge: boolean }[];
  checkedIn: number;
  total: number;
  crewStreak: number;
  needsMore: number;
  mine: { today: { reason: string; words: string; points: number }[]; season: number; showPoints: boolean; showStreak: boolean };
}

export interface MapView {
  league: string;
  season: { start: string; end: string; daysLeft: number };
  tiles: { q: number; r: number; kind: string; crewId: string | null; light: number; contested: boolean; claimedToday: boolean; takenFrom: string | null }[];
  crews: { id: string; name: string; emblem: string; colour: string; tiles: number; home: { q: number; r: number }; isYours: boolean; rank: number }[];
  lastTaken: { crewId: string; fromCrewId: string; q: number; r: number } | null;
}

export interface Recap {
  crewName: string;
  league: string;
  rank: number;
  crews: number;
  tiles: number;
  bestStreak: number;
  mvp: { name: string; smartCalls: number } | null;
  move: 'up' | 'down' | 'stay';
  seasonStart: string;
  seasonEnd: string;
}

export interface AthleteHome {
  today: TodayView;
  insights: { id: string; text: string; examples: string }[];
  camp: CampView | null;
  crew: { name: string; emblem: string; checkedIn: number; total: number; streak: number; todayPoints: number } | null;
  name: string;
  avatar: string | null;
  sport: string;
  demo: boolean;
  consented: boolean;
  streak: number;
  checkedIn: boolean;
  answered: boolean;
  settleDone: boolean;
  plan: { title: string; intensity: string } | null;
  numbers: { pulse: number | null; breath: number | null; rmssd: number | null; stress: number | null } | null;
  messages: { id: string; date: string; body: string; read: boolean }[];
}

export interface BoardRow {
  id: string;
  name: string;
  sport: string;
  squad: string;
  avatar: string | null;
  status: 'ready' | 'watch' | 'check-in' | 'waiting' | 'learning';
  reasons: string[];
  plan: { title: string; intensity: string; changed: boolean } | null;
  checkedIn: boolean;
  daysAway: number | null;
  learning: { have: number; need: number } | null;
  gentleNudge: boolean;
  decided: boolean;
  source: string | null;
}

export interface Board {
  date: string;
  rows: BoardRow[];
  summary: string;
  counts: { total: number; checkedIn: number; toLook: number; ready: number };
}

export interface DetailPoint {
  date: string;
  pulse: number | null;
  breath: number | null;
  rmssd: number | null;
  stress: number | null;
  sleep: number | null;
  feel: number | null;
  status: BoardRow['status'] | null;
  intensity: string | null;
  jump: number | null;
}

export type UsualRange = { low: number; high: number; median: number };

export interface Detail {
  athlete: { id: string; name: string; sport: string; squad: string; avatar: string | null; showNumbers: boolean; notes: string; link: string; workspace: string };
  today: BoardRow | null;
  points: DetailPoint[];
  usual: Partial<Record<'pulse' | 'breath' | 'rmssd' | 'stress' | 'sleep' | 'feel' | 'jump', UsualRange>>;
  sessions: { date: string; title: string; intensity: string; nextDay: BoardRow['status'] | null }[];
  settle: { intensity: string; count: number; pulseAboveUsual: number | null; minutesAfter: number | null }[];
  messages: { id: string; date: string; body: string; action: string; readAt: string | null }[];
}

export interface AppConfig {
  liveAvailable: boolean;
  allowSim: boolean;
  vapidPublicKey: string | null;
  coachLoginEnabled: boolean;
  recorder: boolean;
}
