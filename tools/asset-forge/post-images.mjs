// Feature images for the DEV post and README, from real recordings of the app and the pose-tracked clips.
// Usage: node tools/asset-forge/post-images.mjs   (needs video/walkthrough/assets on this machine)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const web = createRequire(resolve(ROOT, 'apps/web/package.json'));
const { chromium } = web('@playwright/test');
const sharp = web('sharp');
const ASSETS = resolve(ROOT, 'video/walkthrough/assets');
const ffmpeg = resolve(ROOT, 'video/walkthrough/bin/ffmpeg.exe');
const OUT = resolve(ROOT, 'docs/screens');
const TMP = resolve(tmpdir(), `rc-post-${process.pid}`);
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
const FONT = readFileSync(resolve(ROOT, 'apps/web/node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2')).toString('base64');

let n = 0;
const grab = (dir, src, at) => {
  const file = join(TMP, `${n++}.png`);
  const seek = at < 0 ? ['-sseof', String(at)] : ['-ss', String(at)];
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...seek, '-i', resolve(ASSETS, dir, `${src}.mp4`), '-frames:v', '1', file]);
  if (r.status !== 0) throw new Error(`${src}: ${r.stderr}`);
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
};

const phone = (src, at, label) => `<figure style="width:330px"><div style="background:#1B1A33;border-radius:44px;padding:11px;box-shadow:8px 8px 0 #2B2A6B"><img src="${grab('screens', src, at)}" style="display:block;width:100%;border-radius:34px"/></div><figcaption>${label}</figcaption></figure>`;
const wide = (dir, src, at, label, w = 640) => `<figure style="width:${w}px"><div style="border:4px solid #2B2A6B;border-radius:22px;overflow:hidden;box-shadow:8px 8px 0 #2B2A6B"><img src="${grab(dir, src, at)}" style="display:block;width:100%"/></div><figcaption>${label}</figcaption></figure>`;

const IMAGES = {
  'post-heart': `${phone('s02_heart', 9, 'The sun rises as it reads')}${phone('s14_talking', -1, 'Talking pauses the clock')}${phone('s15_light', -1, 'Poor light gets a hint')}`,
  'post-legs': `${wide('footage', 'jump_good', 3.6, 'A clean jump counts')}${wide('footage', 'jump_hands', 4.8, 'Arms swing: Rollo asks for another')}`,
  'post-call': `${phone('s05_call', 1.5, 'Heart and legs, with a suggestion')}${phone('s05_call', -1, 'You choose')}${phone('s09_insights', -1, 'Patterns from your own days')}`,
  'post-train': `${wide('footage', 'squat', 4.9, 'Reps from the joint angle')}${wide('footage', 'pushup', 9.7, 'Rep speed drops: that’s the set')}`,
  'post-crews': `${phone('s07a_points', -1, 'Points for smart choices')}${phone('s07b_map', -0.6, 'The Dawn Map')}${phone('s08_feed', -1, 'Your camp never shrinks')}`,
  'post-usual': wide('screens', 's16_usual', -1, 'Every reading against your own two weeks', 1240),
  'post-send': wide('screens', 's11_send', 2.6, 'AI drafts, the coach edits, nothing goes until Send', 1240),
};

const browser = await chromium.launch();
for (const [name, html] of Object.entries(IMAGES)) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 400 } });
  await page.setContent(`<!doctype html><style>@font-face{font-family:B;src:url(data:font/woff2;base64,${FONT});font-weight:200 800}
    *{margin:0;box-sizing:border-box}body{background:#FFF6E9;width:1400px}#w{display:flex;justify-content:center;gap:56px;padding:40px 48px 30px}
    figcaption{font:800 28px/1.15 B;color:#2B2A6B;text-align:center;margin-top:20px}</style><div id="w">${html}</div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const png = await page.locator('#w').screenshot();
  const target = resolve(OUT, `${name}.jpg`);
  await sharp(png).jpeg({ quality: 85 }).toFile(target);
  console.log(name, Math.round(statSync(target).size / 1024), 'KB');
  await page.close();
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });
