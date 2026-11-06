import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BodySynth, parseSession, type BodyState, type VitalsFrame } from '@hush/signals';
import configJson from '../../../config/difficulty.json';
import type { EngineConfig } from '../src';

export const config = configJson as unknown as EngineConfig;
export const DT = 0.1;

export const synthFrames = (
  seconds: number,
  script: (b: BodyState, s: number) => void = () => {},
  seed = 3,
): VitalsFrame[] => {
  const synth = new BodySynth(seed);
  const frames: VitalsFrame[] = [];
  for (let i = 0; i < seconds * 10; i++) {
    script(synth.body, i / 10);
    frames.push(synth.step('sim'));
  }
  return frames;
};

/** Yields one frame per call, so a script can react to the state of the game as it plays. */
export function liveSynth(script: (b: BodyState, s: number) => void, seed = 3): () => VitalsFrame {
  const synth = new BodySynth(seed);
  let i = 0;
  return () => {
    script(synth.body, i++ / 10);
    return synth.step('sim');
  };
}

/** Real recordings take priority over synthetic stand-ins of the same name. */
export function loadSession(name: string): { frames: VitalsFrame[]; synthetic: boolean } {
  const root = resolve(import.meta.dirname, '../../../data/sessions');
  const real = resolve(root, `${name}.jsonl`);
  const synthetic = !existsSync(real);
  const path = synthetic ? resolve(root, 'synthetic', `${name}.jsonl`) : real;
  return { frames: parseSession(readFileSync(path, 'utf8')).frames, synthetic };
}
