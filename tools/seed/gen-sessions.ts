/**
 * Clearly labelled SYNTHETIC check-in sessions in data/sessions/synthetic/. They stand in for real
 * recordings in tests and Judge Mode, are never presented as real, and any real file with the same
 * name in data/sessions/ takes priority. Usage: pnpm sessions:gen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BodySynth, Recorder, type BodyState } from '../../packages/signals/src/index';

type Script = (body: BodyState, seconds: number) => void;

const SESSIONS: Record<string, { seconds: number; seed: number; script: Script }> = {
  calm_seated_90s: { seconds: 90, seed: 11, script: () => undefined },
  // Matches Amara's seeded usual, so the Judge Mode morning lands as Heart: Ready.
  amara_morning_90s: {
    seconds: 90,
    seed: 16,
    script: (b) => {
      b.pulseBpm = 52;
      b.rmssd = 68;
      b.baevsky = 62;
      b.breathBpm = 13;
    },
  },
  after_coffee_90s: {
    seconds: 90,
    seed: 12,
    script: (b) => {
      b.pulseBpm = 80;
      b.rmssd = 38;
      b.baevsky = 130;
      b.breathBpm = 16;
    },
  },
  poor_light_60s: {
    seconds: 60,
    seed: 13,
    script: (b) => {
      b.signalQuality = 0.2;
      b.qualityCode = 5;
      b.qualityReason = 'Increase light on face.';
    },
  },
  talking_60s: {
    seconds: 60,
    seed: 14,
    script: (b, t) => {
      b.talking = (t > 10 && t < 22) || (t > 35 && t < 45);
    },
  },
  leaning_away_60s: {
    seconds: 60,
    seed: 15,
    script: (b, t) => {
      const away = (t > 12 && t < 20) || (t > 40 && t < 50);
      b.facePresent = !away;
    },
  },
};

const out = resolve(import.meta.dirname, '../../data/sessions/synthetic');
mkdirSync(out, { recursive: true });
for (const [name, { seconds, seed, script }] of Object.entries(SESSIONS)) {
  const synth = new BodySynth(seed);
  const recorder = new Recorder();
  for (let i = 0; i < seconds * 10; i++) {
    script(synth.body, i / 10);
    recorder.add(synth.step('replay'));
  }
  writeFileSync(resolve(out, `${name}.jsonl`), recorder.toJsonl());
  console.log(`${name}: ${recorder.count} frames`);
}
