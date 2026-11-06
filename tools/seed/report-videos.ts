/**
 * Scores landmarks from AI-generated clips with the same logic the app runs. It checks tracking, counting
 * and rejections. It can't check accuracy: generated video doesn't follow real physics or timing.
 * Usage: pnpm videos:report
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BalanceTest,
  exerciseById,
  framingHint,
  HoldTimer,
  L,
  LegsCheck,
  parsePoseJsonl,
  PoseSmoother,
  pt,
  RepCounter,
  type PoseFrame,
} from '../../packages/pose/src/index';

const DIR = resolve(import.meta.dirname, '../../data/pose-videos/landmarks');
if (!existsSync(DIR)) throw new Error('No landmarks yet: run the extract step first');

type Kind = { jumps: string } | { reps: string; want: string } | { hold: true } | { balance: true } | { framing: true };

const PLAN: [RegExp, Kind][] = [
  [/^01_/, { jumps: 'valid jumps' }],
  [/^02_/, { jumps: 'knees-tucked' }],
  [/^03_/, { jumps: 'hands-off-hips' }],
  [/^04_/, { reps: 'squat', want: '6 reps' }],
  [/^05_/, { reps: 'squat', want: '8 reps, fatigue stop' }],
  [/^06_/, { reps: 'squat', want: 'partials or depth cue' }],
  [/^07_/, { reps: 'squat', want: 'knees-caving' }],
  [/^08_/, { reps: 'goblet', want: '6 reps' }],
  [/^09_/, { reps: 'pushup', want: '6 reps, maybe fatigue stop' }],
  [/^10_/, { reps: 'pushup', want: '5 reps, hips-sagging' }],
  [/^11_/, { reps: 'lunge', want: '6 reps' }],
  [/^12_/, { reps: 'bridge', want: '6 reps' }],
  [/^13_/, { reps: 'press', want: '6 reps' }],
  [/^14_/, { framing: true }],
  [/^15_/, { hold: true }],
  [/^16_/, { balance: true }],
  [/squats/i, { reps: 'squat', want: 'reps' }],
];

const r2 = (v: number): number => Math.round(v * 100) / 100;

function smoothAll(frames: PoseFrame[]): PoseFrame[] {
  const s = new PoseSmoother();
  return frames.map((f) => s.next(f));
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.pose.jsonl')).sort()) {
  const name = file.replace('.pose.jsonl', '');
  const { frames: raw } = parsePoseJsonl(readFileSync(resolve(DIR, file), 'utf8'));
  const frames = smoothAll(raw);
  const kind = PLAN.find(([re]) => re.test(name))?.[1];
  const seen = raw.filter((f) => pt(f, L.lHip) || pt(f, L.rHip)).length / raw.length;
  const feet = raw.filter((f) => pt(f, L.lAnkle) && pt(f, L.rAnkle)).length / raw.length;
  console.log(`\n${name}\n  body seen ${Math.round(seen * 100)}%, both ankles ${Math.round(feet * 100)}%`);
  if (!kind) continue;
  if ('jumps' in kind) {
    const c = new LegsCheck();
    frames.forEach((f) => c.push(f));
    console.log(`  want: ${kind.jumps}`);
    console.log(`  got:  ${c.jumps.length} jumps: ${c.jumps.map((j) => `${Math.round(j.flightMs)}ms ${r2(j.heightM)}m hip ${r2(j.hipRiseM)}m knee ${Math.round(j.kneeAtTakeoff)}→${Math.round(j.kneeAtLanding)} ${j.problem ?? 'valid'}`).join(' | ') || 'none'}`);
  } else if ('reps' in kind) {
    const e = exerciseById(kind.reps)!;
    const c = new RepCounter(e);
    frames.forEach((f) => c.push(f));
    const s = c.summary();
    console.log(`  want: ${kind.want}`);
    console.log(`  got:  ${s.reps} reps, ${s.partials} partials, depth ${r2(s.avgDepth)}, speed drop ${Math.round(s.speedDrop * 100)}%, stop at ${s.stopSuggestedAt ?? '-'}, flags ${JSON.stringify(s.flagCounts)}`);
  } else if ('hold' in kind) {
    const h = new HoldTimer(exerciseById('plank')!);
    frames.forEach((f) => h.push(f));
    const s = h.summary();
    console.log(`  want: hold time, sag near the end\n  got:  held ${r2(s.holdSeconds)} s, sag share ${r2(s.sagShare)}`);
  } else if ('balance' in kind) {
    for (const side of ['left', 'right'] as const) {
      const b = new BalanceTest(side);
      frames.forEach((f) => b.push(f));
      const r = b.result();
      console.log(`  ${side} leg: started ${b.started}, ${r2(r.seconds)} s, sway ${r2(r.swayPct)}%, touches ${r.touches}`);
    }
  } else {
    const codes = new Map<string, number>();
    for (const f of frames) {
      const c = framingHint(f, 'front').code;
      codes.set(c, (codes.get(c) ?? 0) + 1);
    }
    console.log(`  want: mostly "feet"\n  got:  ${JSON.stringify([...codes])}`);
  }
}
