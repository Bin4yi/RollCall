/** Pure manifest lookups (no Pixi or DOM), so the asset contract can be unit tested. */
export interface ManifestImage {
  category: string;
  transparent?: boolean;
  picked: number;
  files: string[];
  width?: number;
  height?: number;
}

export interface ManifestAnimation {
  kind: string;
  fps: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  sheet?: string;
  sheetJson?: string;
}

export interface Manifest {
  images: Record<string, ManifestImage>;
  animations: Record<string, ManifestAnimation>;
}

export const emptyManifest = (): Manifest => ({ images: {}, animations: {} });

/** File for an image's picked variant. An out-of-range pick falls back to the first file. */
export function pickedFile(manifest: Manifest, id: string): string | null {
  const image = manifest.images[id];
  if (!image?.files.length) return null;
  return image.files[image.picked - 1] ?? image.files[0] ?? null;
}

/** Stable pastel colour per id, so placeholders are easy to tell apart. */
export function placeholderColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 35% 32%)`;
}

const NUMBER_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const NUMBER_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

/** "one hundred and twelve": the Listener counts your heartbeats out loud. */
export function numberToWords(value: number): string {
  const n = Math.max(0, Math.min(999, Math.round(value)));
  if (n < 20) return NUMBER_ONES[n]!;
  if (n < 100) {
    const rest = n % 10;
    return NUMBER_TENS[Math.floor(n / 10)]! + (rest ? `-${NUMBER_ONES[rest]}` : '');
  }
  const rest = n % 100;
  const hundreds = `${NUMBER_ONES[Math.floor(n / 100)]} hundred`;
  return rest ? `${hundreds} and ${numberToWords(rest)}` : hundreds;
}

/** Peak finder for phase-locking the heartbeat sound to the pulse waveform. */
export class PeakDetector {
  private lo = Infinity;
  private hi = -Infinity;
  private armed = false;
  private sinceBeat = 0;

  constructor(private readonly minGapSeconds = 0.33) {}

  /** Returns how many beats occurred in these samples. */
  push(samples: number[], hz: number): number {
    let beats = 0;
    for (const v of samples) {
      this.sinceBeat += 1 / hz;
      // Slow decay makes the range track the waveform, which has no fixed units.
      if (this.hi < this.lo) {
        this.lo = v;
        this.hi = v;
      }
      const decay = 0.002 * (this.hi - this.lo || 1);
      this.lo = Math.min(v, this.lo + decay);
      this.hi = Math.max(v, this.hi - decay);
      const range = this.hi - this.lo;
      if (range <= 0) continue;
      const level = (v - this.lo) / range;
      if (level < 0.3) this.armed = true;
      if (this.armed && level > 0.7 && this.sinceBeat >= this.minGapSeconds) {
        beats++;
        this.armed = false;
        this.sinceBeat = 0;
      }
    }
    return beats;
  }
}
