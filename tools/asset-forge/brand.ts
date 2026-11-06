/**
 * Composes icons and share images from the generated art. Makes no API calls and costs nothing.
 * Usage: pnpm --filter @rollcall/asset-forge brand
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

const ROOT = resolve(import.meta.dirname, '../..');
const ART = resolve(ROOT, 'apps/web/public/assets');
const OUT = resolve(ROOT, 'apps/web/public/brand');
mkdirSync(OUT, { recursive: true });

const INDIGO = '#2B2A6B';

const dawn = (w: number, h: number): Buffer =>
  Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INDIGO}"/><stop offset=".55" stop-color="#FF6B5B"/><stop offset="1" stop-color="#FFB37A"/>
    </linearGradient></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>`);

/** Rollo's head, cropped from his "good" sprite. */
async function rolloHead(size: number): Promise<Buffer> {
  const source = sharp(resolve(ART, 'rollo_feel/feel_4@2x.webp'));
  const { width = 480, height = 480 } = await source.metadata();
  const cropH = Math.round(height * 0.6);
  return sharp(await source.extract({ left: 0, top: 0, width, height: cropH }).png().toBuffer())
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function icon(size: number, padding: number, file: string): Promise<Buffer> {
  const head = await rolloHead(Math.round(size * (1 - padding * 2)));
  const out = await sharp(dawn(size, size))
    .composite([{ input: head, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(resolve(OUT, file), out);
  return out;
}

/** An .ico is a small directory wrapping PNG data, which every current browser reads. */
function ico(png: Buffer, size: number): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head.writeUInt8(size, 6);
  head.writeUInt8(size, 7);
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

async function logo(width: number): Promise<Buffer> {
  return sharp(resolve(ART, 'logo/logo_wordmark@2x.webp')).resize({ width }).png().toBuffer();
}

/** The hero scene behind a logo plate and optional words. */
async function card(width: number, height: number, file: string, words?: string): Promise<void> {
  const hero = await sharp(resolve(ART, 'hero/hero@2x.webp'))
    .resize(width, height, { fit: 'cover', position: 'bottom' })
    .png()
    .toBuffer();
  const plateW = Math.round(Math.min(width * 0.62, height * 1.25));
  const mark = await logo(plateW);
  const meta = await sharp(mark).metadata();
  const layers: OverlayOptions[] = [
    { input: mark, left: Math.round((width - plateW) / 2), top: Math.round(height * 0.04) },
  ];
  if (words) {
    const fontSize = Math.round(height * 0.05);
    const text = Buffer.from(`<svg width="${width}" height="${fontSize * 2}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="${fontSize * 1.4}" text-anchor="middle" font-family="Trebuchet MS, Verdana, sans-serif" font-weight="700" font-size="${fontSize}" fill="${INDIGO}">${words}</text></svg>`);
    layers.push({ input: text, left: 0, top: Math.round(height * 0.04) + (meta.height ?? 0) - fontSize });
  }
  await sharp(hero).composite(layers).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(resolve(OUT, file));
}

for (const size of [1024, 512, 192, 180]) await icon(size, 0.08, `icon-${size}.png`);
await icon(512, 0.18, 'icon-maskable.png');
await icon(16, 0.02, 'icon-16.png');
writeFileSync(resolve(OUT, 'favicon.ico'), ico(await icon(32, 0.02, 'icon-32.png'), 32));

await card(1200, 630, 'og.png', 'Heart and legs, checked by sunrise.');
await card(1000, 420, 'dev-cover.png', 'Heart and legs, checked by sunrise.');
await card(1280, 720, 'youtube-thumb.png', 'The fitness competition where resting can win.');
await card(1080, 1620, 'poster.png', 'Heart and legs, checked by sunrise.');

console.log('Brand kit written to', OUT);
