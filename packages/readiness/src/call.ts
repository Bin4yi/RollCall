import { READINESS } from './config';
import { median, mad, type Status } from './model';

/** Today's call: the heart line, the legs line, and what Rollo suggests. The person chooses. */

export const LEGS = {
  /** Valid Legs checks before jump height counts for anything. */
  learning: READINESS.jumpLearning,
  /** How far below usual, in robust spreads, counts as clearly down. */
  clearlyDown: 1.2,
  /** Rough day-to-day and method error, shown beside the number. */
  typicalErrorPct: 5,
} as const;

export type LegsKind = 'none' | 'skipped' | 'learning' | 'usual' | 'up' | 'down' | 'clearly-down';

export interface LegsState {
  kind: LegsKind;
  /** Change against usual, as a signed whole percentage. */
  pct: number | null;
  have: number;
  need: number;
}

/** Past values are valid best-of-three jump heights in the fortnight before today. */
export function legsState(past: readonly number[], today: number | null, skipped = false): LegsState {
  const have = past.length;
  const need = LEGS.learning;
  if (skipped) return { kind: 'skipped', pct: null, have, need };
  if (today === null) return { kind: 'none', pct: null, have, need };
  if (have < need) return { kind: 'learning', pct: null, have: have + 1, need };
  const usual = median(past);
  const spread = 1.4826 * Math.max(mad(past), READINESS.madFloor.jump);
  const z = (usual - today) / spread;
  const pct = Math.round(((today - usual) / usual) * 100);
  if (z >= LEGS.clearlyDown) return { kind: 'clearly-down', pct, have, need };
  if (z >= 0.6) return { kind: 'down', pct, have, need };
  if (z <= -1) return { kind: 'up', pct, have, need };
  return { kind: 'usual', pct, have, need };
}

export function legsLine(legs: LegsState): string {
  switch (legs.kind) {
    case 'none':
      return 'Legs: not checked today';
    case 'skipped':
      return 'Legs: skipped today';
    case 'learning':
      return `Legs: learning your usual (${legs.have} of ${legs.need})`;
    case 'usual':
      return 'Legs: close to your usual';
    case 'up':
      return `Legs: ${legs.pct}% above usual`;
    case 'down':
    case 'clearly-down':
      return `Legs: ${Math.abs(legs.pct ?? 0)}% below usual`;
  }
}

const HEART_WORD: Record<Status, string> = {
  ready: 'Ready',
  watch: 'Watch',
  'check-in': 'Check in',
  waiting: 'Not checked in',
  learning: 'Learning your usual',
};

export const heartLine = (status: Status): string => `Heart: ${HEART_WORD[status]}`;

const LEG_WORDS = /run|track|interval|tempo|squat|lunge|\bleg|hill|ride|spin|bike|brick|football|small-sided|team training|jog|erg|row/i;

/** Whether a planned session leans on the legs, from its title and the person's sport. */
export const planUsesLegs = (title: string, sport = ''): boolean =>
  LEG_WORDS.test(title) || (/running|cycling|football/.test(sport) && !/rest|mobility|upper/i.test(title));

export type Intensity = 'hard' | 'moderate' | 'easy' | 'rest';
export type Choice = 'planned' | 'moderate' | 'upper' | 'easy' | 'rest';

export interface CallOption {
  choice: Choice;
  label: string;
  intensity: Intensity;
  suggested: boolean;
}

export interface TodaysCall {
  heart: string;
  legs: string;
  suggestion: Choice;
  /** One plain sentence on why. */
  why: string;
  options: CallOption[];
}

const ORDER: Intensity[] = ['rest', 'easy', 'moderate', 'hard'];
const below = (a: Intensity, b: Intensity): boolean => ORDER.indexOf(a) < ORDER.indexOf(b);

/** Heart and legs together. Suggests, never decides: every option stays open. */
export function todaysCall(
  heart: Status,
  legs: LegsState,
  plan: { title: string; intensity: Intensity },
  sport = '',
): TodaysCall {
  const legSession = planUsesLegs(plan.title, sport);
  const legsDown = legs.kind === 'clearly-down';
  let suggestion: Choice = 'planned';
  let why = 'You’re close to your usual. Train as planned.';

  if (plan.intensity === 'rest') {
    why = 'Today’s a rest day. Enjoy it.';
  } else if (heart === 'check-in') {
    suggestion = plan.intensity === 'easy' ? 'planned' : 'easy';
    why = 'Your morning reading is well off your usual, so something easy makes sense today.';
  } else if (heart === 'watch') {
    if (below('moderate', plan.intensity)) {
      suggestion = legsDown && legSession ? 'upper' : 'moderate';
      why = 'Your morning reading is a little off your usual, so keep it moderate.';
    } else {
      why = 'Your morning reading is a little off your usual, and today’s session is already gentle.';
    }
  } else if (heart === 'ready' && legsDown && legSession) {
    if (plan.intensity === 'hard') {
      suggestion = 'upper';
      why = 'Your heart looks ready but your legs are clearly down. An easy upper-body day keeps you moving without loading them.';
    } else if (plan.intensity === 'moderate') {
      suggestion = 'easy';
      why = 'Your legs are clearly down, so ease off today’s session a little.';
    } else {
      why = 'Your legs are down, and today’s session is already easy.';
    }
  } else if (heart === 'learning') {
    why = 'I’m still learning your usual, so train as planned.';
  }

  const options: CallOption[] = [
    { choice: 'planned', label: `As planned: ${plan.title}`, intensity: plan.intensity, suggested: suggestion === 'planned' },
  ];
  if (below('moderate', plan.intensity)) {
    options.push({ choice: 'moderate', label: 'Keep it moderate', intensity: 'moderate', suggested: suggestion === 'moderate' });
  }
  if (legSession && plan.intensity !== 'rest') {
    options.push({ choice: 'upper', label: 'Swap to easy upper body', intensity: 'easy', suggested: suggestion === 'upper' });
  }
  if (below('easy', plan.intensity)) {
    options.push({ choice: 'easy', label: 'Something easy', intensity: 'easy', suggested: suggestion === 'easy' });
  }
  if (plan.intensity !== 'rest') {
    options.push({ choice: 'rest', label: 'Rest today', intensity: 'rest', suggested: false });
  }
  return { heart: heartLine(heart), legs: legsLine(legs), suggestion, why, options };
}

/**
 * The crew game's "listened to your body": hard on a Ready day, or easier on a day that was off.
 * It judges the response to the person's own readings, never the readings themselves.
 */
export function isSmartCall(
  heart: Status,
  legs: LegsState,
  plan: { title: string; intensity: Intensity },
  chosen: Intensity,
  sport = '',
): boolean {
  if (heart === 'check-in') return chosen === 'easy' || chosen === 'rest';
  if (heart === 'watch') return chosen === 'easy' || chosen === 'rest' || (chosen === 'moderate' && plan.intensity === 'hard');
  if (heart !== 'ready') return false;
  if (legs.kind === 'clearly-down' && planUsesLegs(plan.title, sport)) return below(chosen, plan.intensity);
  return chosen === 'hard';
}
