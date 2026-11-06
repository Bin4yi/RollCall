/**
 * Golden replay tests from §17. They run on real recordings when present in data/sessions/, and
 * otherwise on the labelled synthetic stand-ins in data/sessions/synthetic/.
 */
import { describe, expect, it } from 'vitest';
import type { VitalsFrame } from '@hush/signals';
import {
  AcousticLock,
  autopilot,
  Calibration,
  Listener,
  NoiseModel,
  Run,
  type NoiseBreakdown,
} from '../src';
import { config, DT, loadSession } from './helpers';

function calibrate() {
  const cal = new Calibration(config);
  for (const f of loadSession('calm_60s').frames) {
    cal.ingest(f);
    cal.tick(DT);
    if (cal.baseline) return cal.baseline;
  }
  throw new Error('calm_60s did not produce a baseline');
}
const baseline = calibrate();

function play(frames: VitalsFrame[]): { model: NoiseModel; trail: NoiseBreakdown[] } {
  const model = new NoiseModel(config, baseline);
  const trail: NoiseBreakdown[] = [];
  for (const f of frames) {
    model.ingest(f);
    trail.push(model.tick(DT));
  }
  return { model, trail };
}

function scriptedEncounter(frames: VitalsFrame[], difficulty: 'standard'): 'survived' | 'caught' {
  const d = config.difficulties[difficulty];
  const model = new NoiseModel(config, baseline);
  const listener = new Listener(config, 1);
  listener.wake();
  listener.forceSearch('desk', 25);
  for (const f of frames) {
    model.ingest(f);
    const { noise, listenerPaused } = model.tick(DT);
    const events = listener.tick({
      dt: DT,
      noise,
      playerRoom: 'desk',
      playerHidden: true,
      paused: listenerPaused,
      searchThreshold: d.searchThreshold,
      alertThreshold: d.alertThreshold,
      suspicionGain: d.suspicionGain,
      mayEngage: false,
      mustEngage: false,
      searchSeconds: 25,
      gainMultiplier: 1,
    });
    for (const e of events) {
      if (e.kind === 'caught') return 'caught';
      if (e.kind === 'encounter_survived') return 'survived';
    }
  }
  return 'survived';
}

describe('Judge Mode', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'the bundled tour can always be finished, since a viewer cannot affect it (seed %i)',
    (seed) => {
      const { frames } = loadSession('judge_tour_900s');
      const run = new Run(config, { difficulty: 'standard', seed });
      for (const frame of frames) {
        run.ingest(frame);
        autopilot(run);
        run.tick(DT);
        if (run.finished) break;
      }
      expect(run.phase).toBe('escaped');
      // It should still show something happening.
      expect(run.toLog().samples.some((s) => s.noise > 0.3)).toBe(true);
    },
  );
});

describe('golden sessions', () => {
  it('calm_60s: never caught in a scripted encounter', () => {
    expect(scriptedEncounter(loadSession('calm_60s').frames, 'standard')).toBe('survived');
  });

  it('post_exercise_60s: high noise, caught at Standard', () => {
    const { frames } = loadSession('post_exercise_60s');
    const { trail } = play(frames);
    expect(Math.max(...trail.map((t) => t.noise))).toBeGreaterThan(0.7);
    expect(scriptedEncounter(frames, 'standard')).toBe('caught');
  });

  it('flinch_whisper_60s: impulses land at the right timestamps (±1 s)', () => {
    const { frames, synthetic } = loadSession('flinch_whisper_60s');
    const { trail } = play(frames);
    const onsets = (pick: (t: NoiseBreakdown) => number) => {
      const out: number[] = [];
      trail.forEach((t, i) => {
        if (pick(t) > 0 && pick(trail[i - 1] ?? t) === 0) out.push(frames[i]!.t / 1000);
      });
      return out;
    };
    const near = (found: number[], want: number) => found.some((s) => Math.abs(s - want) <= 1);
    const talk = onsets((t) => t.talkImp);
    const flinch = onsets((t) => t.flinchImp);
    expect(talk.length).toBeGreaterThanOrEqual(2);
    expect(flinch.length).toBeGreaterThanOrEqual(2);
    if (synthetic) {
      // Real recordings have their own timing, so exact moments only apply to the known script.
      expect(near(talk, 10) && near(talk, 34)).toBe(true);
      expect(near(flinch, 20) && near(flinch, 45)).toBe(true);
    }
  });

  it('low_light_30s: SIGNAL WEAK shown, noise never rises because of low confidence', () => {
    const { trail } = play(loadSession('low_light_30s').frames);
    expect(trail.filter((t) => t.signalWeak).length).toBeGreaterThan(trail.length * 0.8);
    expect(Math.max(...trail.map((t) => t.noise))).toBeLessThan(0.05);
  });

  it('slow_breathing_60s: calm bonus active and finale lock opens', () => {
    const { frames } = loadSession('slow_breathing_60s');
    const model = new NoiseModel(config, baseline);
    const lock = new AcousticLock(config, model.breath, baseline.br);
    let calmTicks = 0;
    for (const f of frames) {
      model.ingest(f);
      if (model.tick(DT).calm) calmTicks++;
      lock.update();
    }
    expect(calmTicks).toBeGreaterThan(0);
    expect(lock.open).toBe(true);
  });
});
