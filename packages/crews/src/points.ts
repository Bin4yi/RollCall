/**
 * Points come from decisions, never from vitals or performance. Nobody is ranked on pulse, HRV, jump
 * height, reps, weight or speed, so everyone starts equal. Inputs here are all yes-or-no facts on
 * purpose: this function can't see a reading even if it wanted to.
 */
export const POINTS = {
  heart: 1,
  legs: 1,
  listened: 3,
  followedThrough: 2,
  settle: 1,
  /** Everything above in one day. No way to farm past it. */
  dailyCap: 8,
} as const;

export type PointReason = 'heart' | 'legs' | 'listened' | 'followed-through' | 'settle';

export const POINT_WORDS: Record<PointReason, string> = {
  heart: 'Real heart check-in',
  legs: 'Legs or balance check',
  listened: 'Listened to your body',
  'followed-through': 'Did what you chose',
  settle: 'Settle check after training',
};

export interface DayFacts {
  /** A live reading with a face present and good confidence for the whole window. */
  realHeartCheckin: boolean;
  legsOrBalance: boolean;
  /** Hard on a Ready day, or easier on a day that was off. */
  listened: boolean;
  /** Logged the session they picked. */
  followedThrough: boolean;
  settle: boolean;
}

export interface PointEntry {
  reason: PointReason;
  points: number;
}

/** What a day's facts are worth. Going hard on a Check in day simply earns no "listened" points. */
export function scoreDay(facts: DayFacts): PointEntry[] {
  const out: PointEntry[] = [];
  if (facts.realHeartCheckin) out.push({ reason: 'heart', points: POINTS.heart });
  if (facts.legsOrBalance) out.push({ reason: 'legs', points: POINTS.legs });
  if (facts.listened) out.push({ reason: 'listened', points: POINTS.listened });
  if (facts.followedThrough) out.push({ reason: 'followed-through', points: POINTS.followedThrough });
  if (facts.settle) out.push({ reason: 'settle', points: POINTS.settle });
  let room: number = POINTS.dailyCap;
  return out
    .map((e) => {
      const points = Math.min(e.points, room);
      room -= points;
      return { ...e, points };
    })
    .filter((e) => e.points > 0);
}

/** Share of a crew that must check in for the day to count towards the crew streak. */
export const CREW_STREAK_SHARE = 0.75;

/** Days in a row, ending today or yesterday, when at least 75% of the crew checked in. */
export function crewStreak(checkedInByDate: ReadonlyMap<string, number>, members: number, today: string): number {
  if (members === 0) return 0;
  const hit = (date: string): boolean => (checkedInByDate.get(date) ?? 0) / members >= CREW_STREAK_SHARE;
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!hit(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (hit(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export const CREW_SIZE = { min: 3, max: 15 } as const;
