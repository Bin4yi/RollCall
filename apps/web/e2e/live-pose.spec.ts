import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

/**
 * Real MediaPipe on a real image. Needs the fixtures from tools/seed/make-fake-camera.ts and network access
 * for the runtime and model, so it's skipped elsewhere. A sliding photo proves the pipeline runs and that
 * real landmark noise doesn't upset the logic. It says nothing about measuring a real person's jumps.
 */
const RAW = resolve(import.meta.dirname, '../../../assets/raw');
const FAKE = resolve(RAW, 'fake-person.y4m');
const PHOTO = existsSync(RAW) ? readdirSync(RAW).find((f) => f.startsWith('test_person_')) : undefined;

test.skip(!existsSync(FAKE) || !PHOTO, 'No fixture: run tools/seed/make-fake-camera.ts');
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${FAKE}`],
  },
});

test('live path: camera to real model to saved numbers, and nothing else leaves the page', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One viewport is enough for this');
  test.setTimeout(240_000);
  const sent: string[] = [];
  page.on('requestfinished', (r) => {
    if (r.method() !== 'GET' && !new URL(r.url()).host.startsWith('localhost')) sent.push(r.url());
  });
  await page.goto('/');
  await page.request.post('/api/coach/login', { data: { passphrase: 'e2e-pass' } });
  const res = await page.request.post('/api/coach/athletes', { data: { name: `Live Pose ${Date.now()}`, sport: 'running' } });
  const { link } = (await res.json()) as { link: string };
  await page.request.post(`/api${link}/consent`);

  await page.goto(`${link}/legs`);
  await page.getByTestId('legs-start').click();
  await expect(page.getByText(/stays on this phone/)).toBeVisible();
  // It only asks a person to stand still once the model has found a whole body.
  await expect(page.getByTestId('pose-status')).toContainText(/Hands on hips|Quick dip/, { timeout: 120_000 });
  await page.screenshot({ path: 'test-results/screens/live-pose.png' });
  await expect(page.getByTestId('legs-result')).toBeVisible({ timeout: 150_000 });
  const data = (await page.request.get(`/api${link}/export`).then((r) => r.json())) as { jumps: { fps: number; valid: boolean; problem: string | null }[] };
  // This machine renders in software at a few frames a second, so "too few frames" is the honest answer.
  expect(data.jumps.length).toBeGreaterThan(0);
  console.log(`[live path] ${data.jumps.length} jumps, ${data.jumps.at(-1)?.fps.toFixed(1)} fps, ${data.jumps.map((j) => j.problem ?? 'valid').join(', ')}`);
  expect(sent).toEqual([]);
});

test('real model, virtual 30 fps clock: real landmark noise still reads a 0.5 s flight', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One viewport is enough for this');
  test.setTimeout(400_000);
  const photo = await sharp(resolve(RAW, PHOTO!)).resize(480, 720).jpeg({ quality: 85 }).toBuffer();
  await page.goto('/');
  const posePath = `/@fs/${resolve(import.meta.dirname, '../../../packages/pose/src/index.ts').replaceAll('\\', '/')}`;
  const result = await page.evaluate(
    async ({ b64, posePath }) => {
      const { FilesetResolver, PoseLandmarker } = await import(/* @vite-ignore */ '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs' as string);
      const pose = await import(/* @vite-ignore */ posePath);
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm');
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 720;
      const g = canvas.getContext('2d')!;
      const check = new pose.LegsCheck();
      const smoother = new pose.PoseSmoother();
      const px = 130 / 0.85;
      const flight = 0.5;
      const fps = 30;
      let lost = 0;
      const seconds = 7;
      for (let i = 0; i < seconds * fps; i++) {
        const t = i / fps;
        const since = (t - 1.5) % 2.5;
        const lift = t >= 1.5 && since < flight ? 0.5 * 9.81 * since * (flight - since) * px : 0;
        g.fillStyle = '#bbb';
        g.fillRect(0, 0, 480, 720);
        g.drawImage(img, 0, -lift);
        const found = landmarker.detectForVideo(canvas, t * 1000 + 1);
        const person = found.landmarks[0];
        const lm: unknown[] = [];
        if (person) for (const id of Object.values(pose.L) as number[]) lm[id] = { x: person[id].x, y: person[id].y, v: person[id].visibility ?? 0 };
        else lost++;
        check.push(smoother.next({ t: t * 1000, aspect: 480 / 720, lm }));
      }
      landmarker.close();
      return { lost, jumps: check.jumps };
    },
    { b64: photo.toString('base64'), posePath },
  );
  console.log('[virtual clock]', JSON.stringify(result));
  expect(result.lost).toBe(0);
  expect(result.jumps.length).toBeGreaterThanOrEqual(2);
  for (const j of result.jumps as { flightMs: number }[]) {
    expect(Math.abs(j.flightMs - 500) / 500).toBeLessThan(0.15);
  }
});
