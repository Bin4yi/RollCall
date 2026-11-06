/**
 * Builds a fake camera file for testing the real MediaPipe path: a generated photo of a fictional person,
 * moved up and down to imitate three jumps. It's a photo sliding about, so it proves the pipeline runs,
 * not that jumps are measured well. Written to an ignored folder and never shipped.
 * Usage: pnpm exec tsx tools/seed/make-fake-camera.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(ROOT, 'tools/asset-forge/package.json'));
const sharp = require('sharp') as typeof import('sharp');
const ffmpeg = require('ffmpeg-static') as unknown as string;

const raw = readdirSync(resolve(ROOT, 'assets/raw')).find((f) => f.startsWith('test_person_'));
if (!raw) throw new Error('No test_person image: run pnpm assets:forge');

const W = 480;
const H = 720;
const FPS = 30;
const out = resolve(ROOT, 'assets/raw/fake-camera');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const person = await sharp(resolve(ROOT, 'assets/raw', raw)).resize(W, H, { fit: 'cover' }).png().toBuffer();
const background = await sharp(person).extract({ left: 0, top: 0, width: 8, height: 8 }).resize(W, H).png().toBuffer();

// Metres to pixels: the person takes up about half the frame, roughly 0.85 m of leg in 130 px.
const pxPerM = 130 / 0.85;
const flight = 0.5;
const heightAt = (s: number): number => 0.5 * 9.81 * s * (flight - s) * pxPerM;

const seconds = 16;
let n = 0;
for (let i = 0; i < seconds * FPS; i++) {
  const t = i / FPS;
  // A jump every 5 seconds, after 2 seconds of standing still.
  const since = (t - 2) % 5;
  const lift = t >= 2 && since < flight ? Math.round(heightAt(since)) : 0;
  const frame = await sharp(background)
    .composite([{ input: lift ? await sharp(person).extract({ left: 0, top: lift, width: W, height: H - lift }).toBuffer() : person, left: 0, top: 0 }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  const png = await sharp(frame.data, { raw: frame.info }).png({ compressionLevel: 1 }).toBuffer();
  writeFileSync(resolve(out, `f${String(n++).padStart(4, '0')}.png`), png);
}
const result = spawnSync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', resolve(out, 'f%04d.png'), '-pix_fmt', 'yuv420p', resolve(ROOT, 'assets/raw/fake-person.y4m')]);
if (result.status !== 0) throw new Error(result.stderr.toString().slice(-500));
rmSync(out, { recursive: true, force: true });
console.log('Wrote assets/raw/fake-person.y4m');
