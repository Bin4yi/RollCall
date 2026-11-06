import type { RunLog, RunSample } from '@hush/engine';

export interface EncounterStat {
  start: number;
  end: number;
  survived: boolean;
  peakSuspicion: number;
  /** Seconds until pulse or breathing was back near baseline; null if it never was in this run. */
  recoverySeconds: number | null;
}

export interface ReportStats {
  peakPulseRise: number | null;
  encounters: EncounterStat[];
  encountersSurvived: number;
  averageRecoverySeconds: number | null;
  longestSteadySeconds: number;
  stillnessPercent: number;
  encounterStillnessPercent: number;
  calmSharePercent: number;
  score: number;
  scoreParts: { label: string; points: number; max: number }[];
}

/** Shown in tooltips: every number on the report says exactly how it was worked out. */
export const STAT_DEFINITIONS: Record<string, string> = {
  peakPulseRise:
    'Highest smoothed pulse estimate during the run, minus your baseline from the Security Desk.',
  recovery:
    'Average seconds after an encounter until pulse was within 5 bpm of baseline, or breathing within 10% of baseline.',
  steady: 'Longest unbroken stretch of breathing slower than your baseline with regular timing.',
  stillness: 'Share of the run with head movement close to what you showed while calibrating.',
  survived: 'Encounters that ended with the Listener walking away.',
  score:
    'A game score out of 100, not a health measure. Encounters 40, stillness 20, steady breathing 20, recovery 20.',
};

const RECOVERY_PULSE_BPM = 5;
const RECOVERY_BREATH_SHARE = 0.1;
/** Motion term at or below this counts as still (1 = moving at 4× calibration jitter). */
const STILL_MOTION = 0.6;
const STEADY_TARGET_SECONDS = 60;
const RECOVERY_BEST_SECONDS = 10;
const RECOVERY_WORST_SECONDS = 60;
const QUIET_NOISE = 0.25;

function encounters(log: RunLog): EncounterStat[] {
  const out: EncounterStat[] = [];
  let open: { start: number } | null = null;
  for (const { t, event } of log.events) {
    if (event.kind === 'encounter_start') open = { start: t };
    else if (open && (event.kind === 'encounter_survived' || event.kind === 'caught')) {
      out.push({
        start: open.start,
        end: t,
        survived: event.kind === 'encounter_survived',
        peakSuspicion: event.kind === 'encounter_survived' ? event.peakSuspicion : 1,
        recoverySeconds: event.kind === 'caught' ? null : recovery(log, t),
      });
      open = null;
    }
  }
  return out;
}

function recovery(log: RunLog, from: number): number | null {
  const base = log.baseline;
  if (!base) return null;
  for (const s of log.samples) {
    if (s.t < from) continue;
    if (s.searching) return null; // The next encounter arrived first.
    const pulseBack = s.pulse !== null && s.pulse <= base.hr + RECOVERY_PULSE_BPM;
    const breathBack = s.breath !== null && s.breath <= base.br * (1 + RECOVERY_BREATH_SHARE);
    if (pulseBack || breathBack) return s.t - from;
  }
  return null;
}

function longestStreak(samples: RunSample[]): number {
  let best = 0;
  let started: number | null = null;
  for (const s of samples) {
    if (s.calm) {
      started ??= s.t;
      best = Math.max(best, s.t - started);
    } else {
      started = null;
    }
  }
  return best;
}

const share = (samples: RunSample[], test: (s: RunSample) => boolean): number =>
  samples.length ? (100 * samples.filter(test).length) / samples.length : 0;

export function computeStats(log: RunLog): ReportStats {
  // Samples with a weak signal say nothing about the player, so they don't count for or against.
  const trusted = log.samples.filter((s) => !s.weak);
  const pulses = trusted.flatMap((s) => (s.pulse === null ? [] : [s.pulse]));
  const peakPulseRise =
    log.baseline && pulses.length ? Math.max(0, Math.max(...pulses) - log.baseline.hr) : null;

  const list = encounters(log);
  const survived = list.filter((e) => e.survived).length;
  const recoveries = list.flatMap((e) => (e.recoverySeconds === null ? [] : [e.recoverySeconds]));
  const averageRecovery = recoveries.length
    ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length
    : null;
  const steady = longestStreak(log.samples);
  const stillness = share(trusted, (s) => s.motion <= STILL_MOTION);
  const encounterStillness = share(
    trusted.filter((s) => s.searching),
    (s) => s.motion <= STILL_MOTION,
  );
  const calmShare = share(trusted, (s) => s.noise <= QUIET_NOISE);

  const recoveryScore =
    averageRecovery === null
      ? 0
      : 1 -
        Math.min(
          1,
          Math.max(0, averageRecovery - RECOVERY_BEST_SECONDS) /
            (RECOVERY_WORST_SECONDS - RECOVERY_BEST_SECONDS),
        );
  const scoreParts = [
    {
      label: 'Encounters survived',
      points: list.length ? (40 * survived) / list.length : 0,
      max: 40,
    },
    { label: 'Stillness', points: (20 * stillness) / 100, max: 20 },
    {
      label: 'Steady breathing',
      points: 20 * Math.min(1, steady / STEADY_TARGET_SECONDS),
      max: 20,
    },
    { label: 'Recovery', points: 20 * recoveryScore, max: 20 },
  ].map((p) => ({ ...p, points: Math.round(p.points) }));

  return {
    peakPulseRise,
    encounters: list,
    encountersSurvived: survived,
    averageRecoverySeconds: averageRecovery,
    longestSteadySeconds: steady,
    stillnessPercent: stillness,
    encounterStillnessPercent: encounterStillness,
    calmSharePercent: calmShare,
    score: scoreParts.reduce((a, p) => a + p.points, 0),
    scoreParts,
  };
}

const NEAR_CATCH = 0.7;

export function earnedBadges(log: RunLog, stats: ReportStats): string[] {
  const earned: string[] = [];
  const base = log.baseline;
  const survivedList = stats.encounters.filter((e) => e.survived);

  const heldPulse =
    !!base &&
    survivedList.some((e) => {
      const during = log.samples.filter((s) => s.t >= e.start && s.t <= e.end && s.pulse !== null);
      return during.length > 0 && during.every((s) => (s.pulse as number) <= base.hr + 5);
    });
  if (heldPulse) earned.push('ice_veins');
  if (stats.longestSteadySeconds >= STEADY_TARGET_SECONDS) earned.push('ghost_breath');
  if (stats.encounters.length > 0 && stats.encounterStillnessPercent >= 95) earned.push('statue');
  if (log.outcome === 'escaped') earned.push('first_light');
  if (survivedList.some((e) => e.peakSuspicion >= NEAR_CATCH)) earned.push('close_call');
  if (log.tapes >= 3) earned.push('tape_collector');
  if (survivedList.some((e) => e.recoverySeconds !== null && e.recoverySeconds <= 15)) {
    earned.push('sigh_of_relief');
  }
  if (stats.calmSharePercent >= 75 && log.samples.length > 0) earned.push('lull_friend');
  return earned;
}

export interface TimelineMarker {
  t: number;
  label: string;
  description: string;
}

const ROOM_NAMES: Record<string, string> = {
  desk: 'the security desk',
  corridor: 'the corridor',
  control: 'the control room',
  archive: 'the tape archive',
  boiler: 'the boiler room',
};

/** The events worth a marker on the report's chart. */
export function timelineMarkers(log: RunLog): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  for (const { t, event } of log.events) {
    const room = 'room' in event ? (ROOM_NAMES[event.room] ?? event.room) : '';
    switch (event.kind) {
      case 'encounter_start':
        out.push({ t, label: 'Entered', description: `The Listener came into ${room}.` });
        break;
      case 'leaned_in':
        out.push({
          t,
          label: 'Leaned in',
          description: 'It leaned in close. It had almost heard you.',
        });
        break;
      case 'encounter_survived':
        out.push({ t, label: 'Left', description: `It walked away from ${room}.` });
        break;
      case 'caught':
        out.push({ t, label: 'Heard', description: `It heard you in ${room}.` });
        break;
      case 'finale_start':
        out.push({
          t,
          label: 'Finale',
          description: 'You reached the acoustic lock on the blast door.',
        });
        break;
      case 'escaped':
        out.push({ t, label: 'Escaped', description: 'The lock opened on your breathing. Dawn.' });
        break;
    }
  }
  return out;
}

/** Medical and diagnostic words that must never reach the player, whoever wrote the text. */
const BANNED = [
  'anxiety',
  'anxious',
  'panic',
  'stress',
  'disorder',
  'diagnos',
  'vagal',
  'nervous system',
  'apnea',
  'arrhythmia',
  'tachycardia',
  'bradycardia',
  'hypertension',
  'blood pressure',
  'symptom',
  'condition',
  'treatment',
  'therapy',
  'medical',
  'health',
  'disease',
];

export function isCleanNarration(text: string): boolean {
  const lower = text.toLowerCase();
  return !BANNED.some((word) => lower.includes(word));
}

/** Deterministic fallback when no local LLM is running. Numbers only, no judgement of the body. */
export function templateNarration(log: RunLog, stats: ReportStats): string {
  const first =
    log.outcome === 'escaped'
      ? 'Subject reached the blast door and left the station at dawn.'
      : 'Subject was heard before reaching the blast door.';
  const pulse =
    stats.peakPulseRise === null
      ? 'Pulse could not be read reliably on this run.'
      : `Pulse peaked ${Math.round(stats.peakPulseRise)} bpm above the Security Desk reading.`;
  const breath =
    stats.longestSteadySeconds >= 5
      ? `Longest steady breathing lasted ${Math.round(stats.longestSteadySeconds)} seconds.`
      : 'Breathing stayed close to its resting pace.';
  return `${first} ${pulse} ${breath}`;
}

/** Facts for an optional local LLM. Only numbers go in, never video or anything identifying. */
export function narrationPrompt(log: RunLog, stats: ReportStats): string {
  return [
    'Write 2-3 short sentences in the voice of a dry 1987 incident report about a person hiding in a horror game.',
    'Use only these numbers. Do not give advice or interpret the numbers as anything about health.',
    `Outcome: ${log.outcome}.`,
    `Encounters survived: ${stats.encountersSurvived} of ${stats.encounters.length}.`,
    `Peak pulse rise: ${stats.peakPulseRise === null ? 'unknown' : Math.round(stats.peakPulseRise)} bpm.`,
    `Longest steady breathing: ${Math.round(stats.longestSteadySeconds)} seconds.`,
    `Still for ${Math.round(stats.stillnessPercent)}% of the run.`,
  ].join('\n');
}
