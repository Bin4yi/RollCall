/**
 * Generates clearly labelled SYNTHETIC sessions into data/sessions/synthetic/. They stand in for
 * real webcam recordings in tests and Judge Mode until those exist, and are never presented as
 * real data. Usage: pnpm sessions:gen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BodySynth, Recorder, type BodyState } from '../packages/signals/src/index';

const WARMUP_SECONDS = 32;

type Script = (body: BodyState, seconds: number) => void;

const hold = (body: BodyState): void => {
  body.pulseBpm = 70;
  body.breathBpm = 14;
};

const sessions: Record<string, { seconds: number; seed: number; script: Script }> = {
  calm_60s: { seconds: 60, seed: 11, script: hold },
  post_exercise_60s: {
    seconds: 60,
    seed: 12,
    script: (b, s) => {
      b.pulseBpm = 115 - s * 0.25;
      b.breathBpm = 30 - s * 0.1;
      b.breathJitter = 0.3;
      b.headMotion = 0.012;
    },
  },
  flinch_whisper_60s: {
    seconds: 60,
    seed: 13,
    script: (b, s) => {
      hold(b);
      b.talking = (s >= 10 && s < 13) || (s >= 34 && s < 36);
      const flinching = (s >= 20 && s < 20.6) || (s >= 45 && s < 45.6);
      b.fear = flinching ? 0.8 : 0;
      b.headMotion = flinching ? 0.05 : 0.002;
    },
  },
  low_light_30s: {
    seconds: 30,
    seed: 14,
    script: (b) => {
      hold(b);
      b.signalQuality = 0.15;
      b.qualityReason = 'Too dark. Add light in front of your face.';
    },
  },
  slow_breathing_60s: {
    seconds: 60,
    seed: 15,
    script: (b, s) => {
      b.pulseBpm = 66;
      b.breathBpm = s < 20 ? 14 : 6;
      b.breathJitter = 0.03;
    },
  },
  // Judge Mode: a varied fifteen-minute body, so a watcher sees the numbers rise and fall.
  judge_tour_900s: {
    seconds: 900,
    seed: 16,
    script: (b, s) => {
      const cycle = s % 150;
      const tense = s > 60 && cycle > 90 && cycle < 110;
      b.pulseBpm = tense ? 92 : 68 + 4 * Math.sin(s / 40);
      b.breathBpm = tense ? 22 : cycle >= 110 ? 7 : 12;
      b.breathJitter = tense ? 0.22 : 0.04;
      b.headMotion = 0.003;
    },
  },
};

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data/sessions/synthetic');
mkdirSync(outDir, { recursive: true });
for (const [name, { seconds, seed, script }] of Object.entries(sessions)) {
  const synth = new BodySynth(seed);
  const recorder = new Recorder();
  // Like the real recorder, capture only starts once the SDK's windows have filled.
  for (let i = 0; i < WARMUP_SECONDS * 10; i++) synth.step('replay');
  for (let i = 0; i < seconds * 10; i++) {
    script(synth.body, i / 10);
    const frame = synth.step('replay');
    recorder.add({ ...frame, t: frame.t - WARMUP_SECONDS * 1000 });
  }
  writeFileSync(resolve(outDir, `${name}.jsonl`), recorder.toJsonl());
  console.log(`${name}: ${recorder.count} frames`);
}
