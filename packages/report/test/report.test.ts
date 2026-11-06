import { describe, expect, it } from 'vitest';
import {
  autopilot,
  Run,
  type EngineConfig,
  type LoggedEvent,
  type RunLog,
  type RunSample,
} from '@hush/engine';
import { BodySynth } from '@hush/signals';
import configJson from '../../../config/difficulty.json';
import badgeConfig from '../../../config/badges.json';
import {
  computeStats,
  earnedBadges,
  isCleanNarration,
  narrationPrompt,
  STAT_DEFINITIONS,
  templateNarration,
  timelineMarkers,
} from '../src';

const sample = (t: number, over: Partial<RunSample> = {}): RunSample => ({
  t,
  pulse: 70,
  breath: 14,
  noise: 0.1,
  suspicion: 0,
  motion: 0.1,
  calm: false,
  weak: false,
  searching: false,
  ...over,
});

const makeLog = (
  samples: RunSample[],
  events: LoggedEvent[],
  over: Partial<RunLog> = {},
): RunLog => ({
  seed: 1,
  difficulty: 'standard',
  gentle: false,
  baseline: { hr: 70, br: 14, breathAmplitude: 2, jitter: 0.02, measured: true },
  outcome: 'escaped',
  durationSeconds: samples.at(-1)?.t ?? 0,
  samples,
  events,
  tapes: 3,
  ...over,
});

const encounter = (start: number, end: number, peak = 0.2): LoggedEvent[] => [
  { t: start, event: { kind: 'encounter_start', room: 'desk', seconds: end - start } },
  { t: end, event: { kind: 'encounter_survived', room: 'desk', peakSuspicion: peak } },
];

describe('computeStats', () => {
  it('peak pulse rise is relative to baseline', () => {
    const log = makeLog([sample(0), sample(1, { pulse: 88 }), sample(2)], []);
    expect(computeStats(log).peakPulseRise).toBe(18);
  });

  it('ignores weak-signal samples for and against the player', () => {
    const log = makeLog([sample(0), sample(1, { pulse: 180, weak: true, motion: 2 })], []);
    const stats = computeStats(log);
    expect(stats.peakPulseRise).toBe(0);
    expect(stats.stillnessPercent).toBe(100);
  });

  it('pulse rise is null rather than invented when never measured', () => {
    expect(computeStats(makeLog([sample(0, { pulse: null })], [])).peakPulseRise).toBeNull();
    expect(computeStats(makeLog([sample(0)], [], { baseline: null })).peakPulseRise).toBeNull();
  });

  it('recovery: seconds until pulse OR breathing is back near baseline', () => {
    const during = [sample(10, { searching: true, pulse: 95, breath: 25 })];
    const after = [
      sample(20, { pulse: 95, breath: 25 }),
      sample(30, { pulse: 80, breath: 15 }), // breathing within 10%
    ];
    const stats = computeStats(makeLog([...during, ...after], encounter(10, 20)));
    expect(stats.encounters[0]?.recoverySeconds).toBe(10);
    expect(stats.averageRecoverySeconds).toBe(10);
  });

  it('recovery is null when the next encounter comes first or it never recovers', () => {
    const next = [
      sample(20, { pulse: 95, breath: 25 }),
      sample(25, { searching: true, pulse: 95, breath: 25 }),
    ];
    expect(
      computeStats(makeLog(next, encounter(10, 20))).encounters[0]?.recoverySeconds,
    ).toBeNull();
    expect(computeStats(makeLog(next, encounter(10, 20))).averageRecoverySeconds).toBeNull();
  });

  it('finds the longest steady breathing streak', () => {
    const samples = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => sample(t, { calm: t < 3 || t > 4 }));
    expect(computeStats(makeLog(samples, [])).longestSteadySeconds).toBe(2);
  });

  it('a caught encounter has no recovery and counts against survival', () => {
    const events: LoggedEvent[] = [
      { t: 10, event: { kind: 'encounter_start', room: 'desk', seconds: 20 } },
      { t: 15, event: { kind: 'caught', room: 'desk' } },
    ];
    const stats = computeStats(makeLog([sample(10), sample(15)], events, { outcome: 'caught' }));
    expect(stats.encounters).toMatchObject([
      { survived: false, peakSuspicion: 1, recoverySeconds: null },
    ]);
    expect(stats.encountersSurvived).toBe(0);
  });
});

describe('Calm Under Fire score', () => {
  it('reaches 100 on a perfect run and stays in range', () => {
    const samples = Array.from({ length: 200 }, (_, i) => sample(i, { calm: true }));
    const stats = computeStats(makeLog(samples, encounter(50, 70)));
    expect(stats.score).toBe(100);
    expect(stats.scoreParts.map((p) => p.max)).toEqual([40, 20, 20, 20]);
  });

  it('is low on a bad run', () => {
    const samples = Array.from({ length: 50 }, (_, i) =>
      sample(i, { motion: 2, pulse: 120, breath: 30 }),
    );
    const events: LoggedEvent[] = [
      { t: 10, event: { kind: 'encounter_start', room: 'desk', seconds: 20 } },
      { t: 15, event: { kind: 'caught', room: 'desk' } },
    ];
    expect(computeStats(makeLog(samples, events, { outcome: 'caught' })).score).toBe(0);
  });

  it('copes with an empty run', () => {
    const stats = computeStats(makeLog([], []));
    expect(stats.score).toBe(0);
    expect(Number.isFinite(stats.stillnessPercent)).toBe(true);
    expect(earnedBadges(makeLog([], [], { tapes: 0, outcome: 'caught' }), stats)).toEqual([]);
  });

  it('every number has a written definition, and the score denies being a health measure', () => {
    for (const key of ['peakPulseRise', 'recovery', 'steady', 'stillness', 'survived', 'score']) {
      expect(STAT_DEFINITIONS[key]).toBeTruthy();
    }
    expect(STAT_DEFINITIONS.score).toContain('not a health measure');
  });
});

describe('badges', () => {
  const ids = (log: RunLog) => earnedBadges(log, computeStats(log));

  it('every badge id exists in the config', () => {
    const known = new Set(badgeConfig.badges.map((b) => b.id));
    const samples = Array.from({ length: 200 }, (_, i) =>
      sample(i, { calm: true, searching: i >= 50 && i < 70 }),
    );
    const log = makeLog(samples, encounter(50, 70, 0.8));
    const earned = ids(log);
    expect(earned.length).toBe(8);
    for (const id of earned) expect(known.has(id)).toBe(true);
  });

  it('first light and tape collector need the real achievement', () => {
    const none = ids(
      makeLog([sample(0, { motion: 2, noise: 1 })], [], { outcome: 'caught', tapes: 2 }),
    );
    expect(none).toEqual([]);
  });

  it('ice veins fails if pulse rose during the encounter', () => {
    const samples = [sample(50, { pulse: 80 }), sample(60, { pulse: 80 })];
    expect(ids(makeLog(samples, encounter(50, 70)))).not.toContain('ice_veins');
  });

  it('close call needs a near-catch', () => {
    const samples = [sample(50), sample(70)];
    expect(ids(makeLog(samples, encounter(50, 70, 0.3)))).not.toContain('close_call');
    expect(ids(makeLog(samples, encounter(50, 70, 0.8)))).toContain('close_call');
  });
});

describe('timeline markers', () => {
  it('describes key moments in order', () => {
    const log = makeLog(
      [],
      [
        ...encounter(10, 30),
        { t: 40, event: { kind: 'finale_start' } },
        { t: 50, event: { kind: 'escaped' } },
      ],
    );
    const markers = timelineMarkers(log);
    expect(markers.map((m) => m.label)).toEqual(['Entered', 'Left', 'Finale', 'Escaped']);
    expect(markers[0]?.description).toContain('security desk');
  });
});

describe('narration', () => {
  it('filter catches medical language in any case', () => {
    expect(isCleanNarration('Subject showed signs of ANXIETY.')).toBe(false);
    expect(isCleanNarration('A panic response.')).toBe(false);
    expect(isCleanNarration('Good for your health')).toBe(false);
    expect(isCleanNarration('Pulse rose 18 bpm. Breathing slowed.')).toBe(true);
  });

  it('templates are always clean, on every outcome', () => {
    const cases = [
      makeLog([sample(0)], []),
      makeLog([], [], { outcome: 'caught', baseline: null }),
      makeLog(
        Array.from({ length: 30 }, (_, i) => sample(i, { calm: true })),
        [],
      ),
    ];
    for (const log of cases) {
      const text = templateNarration(log, computeStats(log));
      expect(text.length).toBeGreaterThan(20);
      expect(isCleanNarration(text)).toBe(true);
    }
  });

  it('prompt holds numbers only, without session or video data', () => {
    const log = makeLog([sample(0)], []);
    const prompt = narrationPrompt(log, computeStats(log));
    expect(prompt).toContain('Peak pulse rise');
    expect(prompt).not.toMatch(/video|frame|image/i);
  });
});

describe('integration with a real run', () => {
  it('turns an engine run into a report', () => {
    const config = configJson as unknown as EngineConfig;
    const run = new Run(config, { difficulty: 'standard', seed: 2 });
    const synth = new BodySynth(2);
    for (let i = 0; i < 9000 && !run.finished; i++) {
      synth.body.breathBpm = run.phase === 'finale' ? 7 : 14;
      run.ingest(synth.step('sim'));
      autopilot(run);
      run.tick(0.1);
    }
    const log = run.toLog();
    const stats = computeStats(log);
    expect(log.outcome).toBe('escaped');
    expect(stats.encounters.length).toBeGreaterThanOrEqual(2);
    expect(stats.encountersSurvived).toBe(stats.encounters.length);
    expect(stats.score).toBeGreaterThan(50);
    const badges = earnedBadges(log, stats);
    expect(badges).toContain('first_light');
    expect(badges).toContain('tape_collector');
    expect(timelineMarkers(log).at(-1)?.label).toBe('Escaped');
  });
});
