import { CheckinSession } from '@rollcall/readiness';
import { ReplaySource, SignalBus } from '@rollcall/signals';
import { describe, expect, it } from 'vitest';
import { loadSessionFile } from '../src/vitals';

/** Plays a recorded session through the check-in exactly as the server does, without the clock. */
function play(name: string, loops = 3) {
  const frames = loadSessionFile(name);
  const session = new CheckinSession();
  const bus = new SignalBus();
  bus.subscribe((f) => session.ingest(f));
  const source = new ReplaySource(name, frames, true);
  source.start(bus);
  const span = frames.at(-1)!.t;
  const seen = new Set<string>();
  for (let t = 0; t < span * loops && session.progress().phase !== 'done'; t += 100) {
    source.advance(100);
    const pause = session.progress().pause;
    if (pause) seen.add(pause);
  }
  return { session, seen, result: session.result() };
}

describe('reference sessions', () => {
  it('calm_seated_90s reads every metric, with confidence', () => {
    const { session, result } = play('calm_seated_90s');
    expect(session.progress().phase).toBe('done');
    expect(result.pulse?.value).toBeGreaterThan(40);
    expect(result.pulse?.value).toBeLessThan(110);
    expect(result.pulse?.conf).toBeGreaterThanOrEqual(0.4);
    expect(result.breath?.value).toBeGreaterThan(5);
    expect(result.rmssd?.value).toBeGreaterThan(0);
    expect(result.stress?.value).toBeGreaterThan(0);
  });

  it('after_coffee_90s reads a higher pulse and lower HRV than calm', () => {
    const calm = play('calm_seated_90s').result;
    const coffee = play('after_coffee_90s').result;
    expect(coffee.pulse!.value).toBeGreaterThan(calm.pulse!.value);
    expect(coffee.rmssd!.value).toBeLessThan(calm.rmssd!.value);
  });

  it('poor_light_60s never finishes and invents nothing', () => {
    const { session, result, seen } = play('poor_light_60s');
    expect(session.progress().phase).toBe('framing');
    expect(session.progress().hint?.pose).toBe('lamp');
    expect(seen).toContain('framing');
    expect(result.pulse).toBeUndefined();
  });

  it('talking_60s pauses for talking, then still completes', () => {
    const { session, seen } = play('talking_60s');
    expect(seen).toContain('talking');
    expect(session.progress().phase).toBe('done');
  });

  it('leaning_away_60s pauses when the face is lost, then still completes', () => {
    const { session, seen } = play('leaning_away_60s');
    expect(seen).toContain('no-face');
    expect(session.progress().phase).toBe('done');
  });

  it('replaying gives identical readings every time', () => {
    expect(play('calm_seated_90s').result).toEqual(play('calm_seated_90s').result);
  });

  it('refuses a session name that could escape the folder', () => {
    expect(() => loadSessionFile('../../.env')).toThrow();
  });
});
