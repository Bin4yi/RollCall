/**
 * Generates the art with the OpenAI Images API and slices it into sprites.
 * Usage: pnpm assets:forge [--dry-run] [--only id] [--force id]  |  --reslice (no API calls)
 *
 * Runs one call at a time, so the spend guard is strict: the ledger in assets/spend.json records real
 * token usage, and no call starts if it could cross ASSET_MAX_USD. Everything is cached by prompt.
 * API notes: docs/ASSET_NOTES.md
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import { CATALOG, type Sheet } from './catalog';

const ROOT = resolve(import.meta.dirname, '../..');
if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));

const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-sunburst';
const MAX_USD = Number(process.env.ASSET_MAX_USD || 2);
/** Per million tokens, from developers.openai.com/api/docs/pricing and the image guide. */
const RATES = { imageInput: 8, textInput: 5, output: 30 };
/** First-call guesses for the guard. Replaced by what calls really cost. */
const GUESS_USD = { low: 0.05, medium: 0.15, high: 0.4 };

const RAW = resolve(ROOT, 'assets/raw');
const PUBLIC = resolve(ROOT, 'apps/web/public/assets');
const LEDGER = resolve(ROOT, 'assets/spend.json');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

interface Ledger {
  usd: number;
  calls: { id: string; quality: string; usd: number; at: string }[];
}
const ledger: Ledger = existsSync(LEDGER)
  ? (JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger)
  : // The API probe that preceded this tool counts towards the budget too.
    { usd: 0.11, calls: [{ id: 'api-probe', quality: 'low', usd: 0.11, at: '2026-11-06' }] };

const saveLedger = (): void => {
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 1)}\n`);
};

const hash = (sheet: Sheet): string =>
  createHash('sha1')
    .update(`${MODEL}|${sheet.size}|${sheet.quality}|${sheet.transparent}|${sheet.refs}|${sheet.prompt}`)
    .digest('hex')
    .slice(0, 10);
const rawPath = (sheet: Sheet): string => resolve(RAW, `${sheet.id}_${hash(sheet)}.png`);

interface Usage {
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  output_tokens?: number;
}
const costOf = (u: Usage | undefined): number =>
  ((u?.input_tokens_details?.image_tokens ?? 0) * RATES.imageInput +
    (u?.input_tokens_details?.text_tokens ?? 0) * RATES.textInput +
    (u?.output_tokens ?? 0) * RATES.output) /
  1e6;

function estimate(sheet: Sheet): number {
  const seen = ledger.calls.filter((c) => c.quality === sheet.quality && c.id !== 'api-probe');
  const base = seen.length ? Math.max(...seen.map((c) => c.usd)) : GUESS_USD[sheet.quality];
  return base * 1.25;
}

async function generate(client: OpenAI, sheet: Sheet): Promise<void> {
  const common = {
    model: MODEL,
    prompt: sheet.prompt,
    size: sheet.size,
    quality: sheet.quality,
    background: sheet.transparent ? 'transparent' : 'opaque',
    output_format: 'png',
  };
  let response: { data?: { b64_json?: string }[]; usage?: Usage };
  if (sheet.refs.length) {
    const images = await Promise.all(
      sheet.refs.map(async (ref) => {
        const source = CATALOG.find((s) => s.id === ref)!;
        // Reference images are billed by size, so they go in small.
        const data = await sharp(rawPath(source)).resize(768, 768, { fit: 'inside' }).png().toBuffer();
        return toFile(data, `${ref}.png`, { type: 'image/png' });
      }),
    );
    response = (await client.images.edit({ ...common, image: images } as never)) as never;
  } else {
    response = (await client.images.generate(common as never)) as never;
  }
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image in response');
  mkdirSync(RAW, { recursive: true });
  writeFileSync(rawPath(sheet), Buffer.from(b64, 'base64'));
  const usd = costOf(response.usage);
  ledger.usd += usd;
  ledger.calls.push({ id: sheet.id, quality: sheet.quality, usd, at: new Date().toISOString() });
  saveLedger();
  console.log(`  ${sheet.id}: $${usd.toFixed(3)} (total $${ledger.usd.toFixed(3)} of $${MAX_USD})`);
}

/** Largest connected-enough content: trims the cell, keeping transparent padding even. */
async function exportSprite(
  input: Buffer,
  sheet: Sheet,
  id: string,
): Promise<{ file: string; width: number; height: number }> {
  let image = sharp(input);
  if (sheet.transparent) image = sharp(await image.trim({ threshold: 8 }).toBuffer());
  const folder = sheet.id;
  const out = resolve(PUBLIC, folder);
  mkdirSync(out, { recursive: true });
  const fit = { fit: 'inside', withoutEnlargement: true } as const;
  const two = await image.resize(sheet.maxSide, sheet.maxSide, fit).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
  writeFileSync(resolve(out, `${id}@2x.webp`), two);
  const meta = await sharp(two).metadata();
  const half = Math.round(sheet.maxSide / 2);
  await sharp(two).resize(half, half, fit).webp({ quality: 80 }).toFile(resolve(out, `${id}.webp`));
  return { file: `${folder}/${id}`, width: meta.width ?? 0, height: meta.height ?? 0 };
}

interface ManifestEntry {
  file: string;
  width: number;
  height: number;
  alt: string;
  sheet: string;
  prompt: string;
}

async function slice(sheet: Sheet): Promise<Record<string, ManifestEntry>> {
  const out: Record<string, ManifestEntry> = {};
  const raw = rawPath(sheet);
  if (!existsSync(raw) || sheet.referenceOnly) return out;
  const entry = (s: { id: string; alt: string }, e: { file: string; width: number; height: number }) => {
    out[s.id] = { ...e, alt: s.alt, sheet: sheet.id, prompt: sheet.prompt };
  };
  if (!sheet.cols) {
    const sprite = sheet.sprites[0]!;
    entry(sprite, await exportSprite(readFileSync(raw), sheet, sprite.id));
    return out;
  }
  const [w, h] = sheet.size.split('x').map(Number) as [number, number];
  const cw = Math.floor(w / sheet.cols);
  const ch = Math.floor(h / sheet.rows);
  for (const [i, sprite] of sheet.sprites.entries()) {
    const left = (i % sheet.cols) * cw;
    const top = Math.floor(i / sheet.cols) * ch;
    const cell = await sharp(raw).extract({ left, top, width: cw, height: ch }).png().toBuffer();
    entry(sprite, await exportSprite(cell, sheet, sprite.id));
  }
  return out;
}

/** Wave loop: same canvas for every frame, as a sprite sheet + JSON, transparent WebM and GIF. */
async function buildWaveAnimation(): Promise<void> {
  const sheet = CATALOG.find((s) => s.id === 'rollo_wave_frames')!;
  if (!existsSync(rawPath(sheet))) return;
  const size = 320;
  const dir = resolve(PUBLIC, 'anim');
  const temp = resolve(RAW, 'wave_frames');
  mkdirSync(dir, { recursive: true });
  mkdirSync(temp, { recursive: true });
  const composites: sharp.OverlayOptions[] = [];
  const [w, h] = sheet.size.split('x').map(Number) as [number, number];
  const cw = Math.floor(w / sheet.cols);
  const ch = Math.floor(h / sheet.rows);
  for (let i = 0; i < 6; i++) {
    const frame = await sharp(rawPath(sheet))
      .extract({ left: (i % 3) * cw, top: Math.floor(i / 3) * ch, width: cw, height: ch })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    writeFileSync(resolve(temp, `f${i}.png`), frame);
    composites.push({ input: frame, left: i * size, top: 0 });
  }
  await sharp({ create: { width: size * 6, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .webp({ quality: 82 })
    .toFile(resolve(dir, 'rollo_wave_sheet.webp'));
  writeFileSync(
    resolve(dir, 'rollo_wave_sheet.json'),
    `${JSON.stringify({ fps: 8, frameWidth: size, frameHeight: size, frames: 6 }, null, 1)}\n`,
  );
  if (!ffmpeg) return;
  const input = ['-y', '-framerate', '8', '-stream_loop', '3', '-i', resolve(temp, 'f%d.png')];
  spawnSync(ffmpeg, [...input, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '34', resolve(dir, 'rollo_wave.webm')]);
  spawnSync(ffmpeg, [...input, '-filter_complex', '[0]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse', resolve(dir, 'rollo_wave.gif')]);
}

function writeOutputs(manifest: Record<string, ManifestEntry>): void {
  const ordered = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    resolve(ROOT, 'assets/manifest.json'),
    `${JSON.stringify({ model: MODEL, spentUsd: Math.round(ledger.usd * 1000) / 1000, images: ordered }, null, 1)}\n`,
  );
  const typed = Object.entries(ordered).map(
    ([id, e]) =>
      `  ${JSON.stringify(id)}: { file: ${JSON.stringify(e.file)}, width: ${e.width}, height: ${e.height}, alt: ${JSON.stringify(e.alt)} },`,
  );
  writeFileSync(
    resolve(ROOT, 'apps/web/src/assets.gen.ts'),
    `// Generated by tools/asset-forge. Do not edit.\nexport const ASSETS = {\n${typed.join('\n')}\n} as const;\n`,
  );
  const cards = Object.entries(ordered)
    .map(
      ([id, e]) =>
        `<figure><img loading="lazy" src="../apps/web/public/assets/${e.file}@2x.webp" alt="${e.alt}"><figcaption>${id}</figcaption></figure>`,
    )
    .join('\n');
  writeFileSync(
    resolve(ROOT, 'assets/gallery.html'),
    `<!doctype html><meta charset="utf-8"><title>Roll Call art</title><style>body{background:#fff6e9;font:14px system-ui;color:#1b1a33}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;padding:16px}img{width:100%;height:160px;object-fit:contain}figure{margin:0}</style><h1>Roll Call art: $${ledger.usd.toFixed(2)} spent</h1><main>${cards}</main>`,
  );
}

async function main(): Promise<void> {
  const only = flag('--only');
  const force = flag('--force');
  const todo = CATALOG.filter((s) => (!only || s.id === only) && (s.id === force || !existsSync(rawPath(s))));
  const planned = todo.reduce((sum, s) => sum + estimate(s), 0);
  console.log(`${todo.length} sheets to generate, about $${planned.toFixed(2)}. Spent $${ledger.usd.toFixed(3)} of $${MAX_USD}.`);
  if (args.includes('--dry-run')) return;

  if (!args.includes('--reslice') && todo.length) {
    if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in .env');
    const client = new OpenAI({ timeout: 400_000, maxRetries: 0 });
    for (const sheet of todo) {
      if (sheet.refs.some((r) => !existsSync(rawPath(CATALOG.find((s) => s.id === r)!)))) {
        console.log(`  ${sheet.id}: skipped, reference missing`);
        continue;
      }
      const next = estimate(sheet);
      if (ledger.usd + next > MAX_USD) {
        console.log(`  ${sheet.id}: skipped, $${next.toFixed(2)} could cross the $${MAX_USD} budget`);
        continue;
      }
      console.log(`Generating ${sheet.id} (${sheet.quality})`);
      try {
        await generate(client, sheet);
      } catch (err) {
        // Don't retry automatically: a failed call may still be billed, and the budget is strict.
        const message = (err as Error).message.slice(0, 300);
        console.error(`  ${sheet.id} failed: ${message}`);
        writeFileSync(resolve(ROOT, 'assets/failures.log'), `${new Date().toISOString()} ${sheet.id} ${message}\n`, { flag: 'a' });
      }
    }
  }

  rmSync(PUBLIC, { recursive: true, force: true });
  const manifest: Record<string, ManifestEntry> = {};
  for (const sheet of CATALOG) Object.assign(manifest, await slice(sheet));
  await buildWaveAnimation();
  writeOutputs(manifest);
  console.log(`${Object.keys(manifest).length} sprites. Spent $${ledger.usd.toFixed(3)} of $${MAX_USD}.`);
}

await main();
