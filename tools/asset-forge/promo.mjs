// Composes the DEV banner, YouTube thumbnail and README images: generated art plus words in the real brand font.
// Usage: node tools/asset-forge/promo.mjs   (needs assets/raw/promo_wide_*.png and, for the phones, a screen recording folder)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const web = createRequire(resolve(ROOT, 'apps/web/package.json'));
const { chromium } = web('@playwright/test');
const sharp = web('sharp');
const BRAND = resolve(ROOT, 'apps/web/public/brand');
const SHOTS = resolve(ROOT, 'docs/screens');
mkdirSync(SHOTS, { recursive: true });

const b64 = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const rawArt = readdirSync(resolve(ROOT, 'assets/raw')).find((f) => f.startsWith('promo_wide_'));
const artPng = await sharp(resolve(ROOT, 'assets/raw', rawArt)).jpeg({ quality: 92 }).toBuffer();
const ART = `data:image/jpeg;base64,${artPng.toString('base64')}`;
const LOGO = b64(resolve(ROOT, 'apps/web/public/assets/logo/logo_wordmark@2x.webp'), 'image/webp');
const FONT = b64(resolve(ROOT, 'apps/web/node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'), 'font/woff2');
const INTER = b64(resolve(ROOT, 'apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'), 'font/woff2');

const base = `@font-face{font-family:B;src:url(${FONT});font-weight:200 800}@font-face{font-family:I;src:url(${INTER});font-weight:100 900}
*{margin:0;padding:0;box-sizing:border-box}body{background:#FFF6E9;overflow:hidden;position:relative}
.art{position:absolute}.h{font-family:B;font-weight:800;letter-spacing:-.025em;color:#2B2A6B;line-height:.98}
.chip{display:inline-block;font-family:I;font-weight:700;background:#2B2A6B;color:#FFF6E9;border-radius:14px}
.sub{font-family:I;font-weight:650;color:#1B1A33}`;

const PAGES = [
  {
    file: 'dev-cover',
    w: 1000,
    h: 420,
    html: `<img class="art" src="${ART}" style="width:1000px;left:0;top:-222px" />
      <div style="position:absolute;left:26px;top:26px;width:468px;height:368px;padding:20px 26px;background:#FFF6E9;border:3px solid #2B2A6B;border-radius:22px;box-shadow:6px 6px 0 #2B2A6B">
        <img src="${LOGO}" style="height:76px;margin-left:-4px" />
        <h1 class="h" style="font-size:58px;margin-top:8px">Should I train<br/>hard today?</h1>
        <p class="sub" style="font-size:22px;margin-top:14px">75 seconds. Just a phone camera.</p>
        <p class="chip" style="font-size:16.5px;padding:8px 13px;margin-top:14px">Built with the Presage SmartSpectra SDK</p>
      </div>`,
  },
  {
    file: 'youtube-thumb',
    w: 1280,
    h: 720,
    html: `<img class="art" src="${ART}" style="width:1280px;left:0;top:-133px" />
      <div style="position:absolute;left:54px;top:50px;width:800px">
        <h1 class="h" style="font-size:106px">Just a phone.<br/>75 seconds.</h1>
        <p class="sub" style="font-size:34px;margin-top:20px;font-weight:700">Should you train hard today?</p>
        <p class="chip" style="font-size:27px;padding:12px 20px;margin-top:22px">Presage SmartSpectra SDK</p>
      </div>`,
  },
];

// Frames from real recordings of the app, when they're on this machine.
const REC = resolve(ROOT, 'video/walkthrough/assets/screens');
const ffmpeg = resolve(ROOT, 'video/walkthrough/bin/ffmpeg.exe');
const frame = (src, at, out) => {
  const seek = at < 0 ? ['-sseof', String(at)] : ['-ss', String(at)];
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...seek, '-i', resolve(REC, `${src}.mp4`), '-frames:v', '1', out]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
};
if (existsSync(REC)) {
  const dir = resolve(tmpdir(), `rc-promo-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const phones = [
    ['s02_heart', 9, 'Sit still for 75 seconds'],
    ['s05_call', -1, 'Today’s call'],
    ['s06b_set', 5.5, 'Train mode'],
    ['s07b_map', -0.6, 'Crews and the Dawn Map'],
  ];
  const cards = phones
    .map(([src, at, label], i) => {
      const out = join(dir, `${i}.png`);
      frame(src, at, out);
      return `<figure style="width:300px"><div style="background:#1B1A33;border-radius:42px;padding:10px;box-shadow:8px 8px 0 #2B2A6B"><img src="${b64(out, 'image/png')}" style="display:block;width:100%;border-radius:32px" /></div><figcaption class="h" style="font-size:27px;text-align:center;margin-top:18px;line-height:1.1">${label}</figcaption></figure>`;
    })
    .join('');
  PAGES.push({ file: 'readme-phones', w: 1400, h: 760, dir: SHOTS, html: `<div style="display:flex;justify-content:space-between;padding:34px 44px">${cards}</div>` });
  frame('s10_board', 2, resolve(SHOTS, 'board-full.png'));
  frame('s01_landing', 1.5, resolve(SHOTS, 'landing-full.png'));
  await sharp(resolve(SHOTS, 'board-full.png')).resize(1200).jpeg({ quality: 84 }).toFile(resolve(SHOTS, 'coach-board.jpg'));
  await sharp(resolve(SHOTS, 'landing-full.png')).resize(1200).jpeg({ quality: 84 }).toFile(resolve(SHOTS, 'landing.jpg'));
  rmSync(resolve(SHOTS, 'board-full.png'));
  rmSync(resolve(SHOTS, 'landing-full.png'));
}

const browser = await chromium.launch();
for (const p of PAGES) {
  const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: p.file === 'dev-cover' ? 2 : 1 });
  await page.setContent(`<!doctype html><style>${base}</style><body style="width:${p.w}px;height:${p.h}px">${p.html}</body>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const png = await page.screenshot();
  const target = resolve(p.dir ?? BRAND, `${p.file}.${p.dir ? 'jpg' : 'png'}`);
  if (p.dir) await sharp(png).jpeg({ quality: 86 }).toFile(target);
  else await sharp(png).png({ palette: true, quality: 92, compressionLevel: 9 }).toFile(target);
  console.log(p.file, Math.round(statSync(target).size / 1024), 'KB');
  await page.close();
}
await browser.close();
