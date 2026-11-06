import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { BODY, toPoseJsonl, type Lm, type PoseFrame } from '@rollcall/pose';
import { test } from '@playwright/test';

/**
 * Not a test: a tool that runs the real pose model over clips in data/pose-videos/ and saves landmarks.
 * Off unless asked for. Usage: EXTRACT_POSES=1 pnpm --filter @rollcall/web exec playwright test e2e/extract-poses.spec.ts --project=desktop
 * Then score them: pnpm videos:report
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const CLIPS = resolve(ROOT, 'data/pose-videos');
const OUT = resolve(CLIPS, 'landmarks');
const require = createRequire(resolve(ROOT, 'tools/asset-forge/package.json'));
const ffmpeg = require('ffmpeg-static') as unknown as string;

test.skip(!process.env.EXTRACT_POSES || !existsSync(CLIPS), 'Set EXTRACT_POSES=1 to run');

test('extract landmarks from every clip', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Once is enough');
  test.setTimeout(1_500_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
    const { FilesetResolver, PoseLandmarker } = await import(/* @vite-ignore */ path);
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm');
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    let clock = 0;
    (window as never as { detect: (b64: string, fresh: boolean) => Promise<unknown> }).detect = async (b64, _fresh) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      await img.decode();
      clock += 1000 / 24;
      const person = landmarker.detectForVideo(img, clock).landmarks[0];
      return person ? person.map((p: { x: number; y: number; visibility?: number }) => [p.x, p.y, p.visibility ?? 0]) : null;
    };
  });

  for (const file of readdirSync(CLIPS).filter((f) => f.endsWith('.mp4'))) {
    const name = basename(file, '.mp4');
    const target = resolve(OUT, `${name}.pose.jsonl`);
    if (existsSync(target)) continue;
    const dir = mkdtempSync(join(tmpdir(), 'clip-'));
    const done = spawnSync(ffmpeg, ['-y', '-i', resolve(CLIPS, file), '-vf', 'scale=640:-2', '-q:v', '3', join(dir, 'f%05d.jpg')]);
    if (done.status !== 0) throw new Error(done.stderr.toString().slice(-400));
    const frames: PoseFrame[] = [];
    const list = readdirSync(dir).sort();
    for (const [i, jpg] of list.entries()) {
      const b64 = readFileSync(join(dir, jpg)).toString('base64');
      const found = await page.evaluate(([data]) => (window as never as { detect: (b: string, f: boolean) => Promise<number[][] | null> }).detect(data!, false), [b64]);
      const lm: (Lm | undefined)[] = [];
      if (found) for (const id of BODY) lm[id] = { x: found[id]![0]!, y: found[id]![1]!, v: found[id]![2]! };
      frames.push({ t: (i * 1000) / 24, aspect: 16 / 9, lm });
    }
    writeFileSync(target, toPoseJsonl({ pose: 1, label: name, synthetic: true, aspect: 16 / 9, fps: 24 }, frames));
    rmSync(dir, { recursive: true, force: true });
    console.log(`[extract] ${name}: ${frames.length} frames`);
  }
});
